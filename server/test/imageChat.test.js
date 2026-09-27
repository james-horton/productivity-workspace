'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const axios = require('axios');
const { config } = require('../config');
const chatRouter = require('../routes/chat');
const modelsRouter = require('../routes/models');

test('image mode uses the selected image model and returns a downloadable raster image', async t => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalOpenRouterKey = config.openrouter.apiKey;
  const originalOpenAIKey = config.openai.apiKey;
  config.openrouter.apiKey = 'test-openrouter';
  config.openai.apiKey = 'test-openai';
  const calls = [];
  axios.get = async () => ({ data: { data: [
    { id: 'vendor/image', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } },
    { id: 'vendor/generate-only', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
    { id: 'vendor/text', architecture: { input_modalities: ['text'], output_modalities: ['text'] } }
  ] } });
  axios.post = async (url, payload) => {
    calls.push({ url: String(url), payload });
    if (String(url).endsWith('/images')) return { data: { data: [{ b64_json: 'aGVsbG8=', media_type: 'image/webp' }] } };
    return { data: { output: [{ type: 'image_generation_call', result: 'aGVsbG8=' }] } };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    config.openrouter.apiKey = originalOpenRouterKey;
    config.openai.apiKey = originalOpenAIKey;
  });

  const app = express();
  app.use('/api/chat', express.json({ limit: '32mb' }));
  app.use(express.json());
  app.use('/api/models', modelsRouter);
  app.use('/api/chat', chatRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { message: err.message } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const models = await (await fetch(`${base}/api/models`)).json();
  assert.equal(models.models.find(model => model.model === 'vendor/image').supportsImageGeneration, true);
  assert.equal(models.models.find(model => model.model === 'vendor/image').supportsImageInput, true);
  assert.equal(models.models.find(model => model.model === 'vendor/text').supportsImageGeneration, false);

  const send = (provider, model, prompt = 'A red fox in a forest', referenceImage) => fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'image', provider, model, messages: [
      { role: 'assistant', content: 'A previous image was generated.', ...(referenceImage ? { image: { dataUrl: referenceImage } } : {}) },
      { role: 'user', content: prompt }
    ] })
  });

  const unsupported = await send('openrouter', 'vendor/text');
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json()).error.message, /does not support image generation/);
  assert.equal(calls.length, 0);
  const invalidOpenAI = await send('openai', 'not-a-selected-model');
  assert.equal(invalidOpenAI.status, 400);
  assert.equal(calls.length, 0);

  const routerResponse = await send('openrouter', 'vendor/image');
  assert.equal(routerResponse.status, 200);
  const routerBody = await routerResponse.json();
  assert.equal(routerBody.message.image.dataUrl, 'data:image/webp;base64,aGVsbG8=');
  assert.equal(routerBody.modelUsed, 'vendor/image');
  assert.equal(calls[0].payload.prompt, 'A red fox in a forest');
  assert.equal(calls[0].payload.model, 'vendor/image');

  const editResponse = await send('openrouter', 'vendor/image', 'Make the fox blue', routerBody.message.image.dataUrl);
  assert.equal(editResponse.status, 200);
  assert.equal(calls[1].payload.prompt, 'Make the fox blue');
  assert.deepEqual(calls[1].payload.input_references, [{ type: 'image_url', image_url: { url: routerBody.message.image.dataUrl } }]);
  const notEditable = await send('openrouter', 'vendor/generate-only', 'Make the fox blue', routerBody.message.image.dataUrl);
  assert.equal(notEditable.status, 400);
  assert.match((await notEditable.json()).error.message, /cannot edit images/);
  assert.equal(calls.length, 2);

  const openAIResponse = await send('openai', 'gpt-6-astra');
  assert.equal(openAIResponse.status, 200);
  assert.equal((await openAIResponse.json()).message.image.dataUrl, 'data:image/png;base64,aGVsbG8=');
  assert.equal(calls[2].payload.model, 'gpt-6-astra');
  assert.deepEqual(calls[2].payload.tools, [{ type: 'image_generation' }]);
  assert.equal(calls[2].payload.input, 'User: A red fox in a forest');

  const openAIEdit = await send('openai', 'gpt-6-astra', 'Add a little hat', routerBody.message.image.dataUrl);
  assert.equal(openAIEdit.status, 200);
  assert.deepEqual(calls[3].payload.tools, [{ type: 'image_generation', action: 'edit' }]);
  assert.deepEqual(calls[3].payload.input, [{ role: 'user', content: [
    { type: 'input_text', text: 'Add a little hat' },
    { type: 'input_image', image_url: routerBody.message.image.dataUrl }
  ] }]);

  const invalidReference = await send('openrouter', 'vendor/image', 'Change the color', 'https://example.com/untrusted.png');
  assert.equal(invalidReference.status, 400);
  assert.equal(calls.length, 4);

  const largeImage = `data:image/png;base64,${'AAAA'.repeat(275_000)}`;
  const largeEdit = await send('openrouter', 'vendor/image', 'Make it brighter', largeImage);
  assert.equal(largeEdit.status, 200);
  assert.equal(calls[4].payload.input_references[0].image_url.url.length, largeImage.length);

  const uploadedImage = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
  const attachedEdit = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'image', provider: 'openai', model: 'gpt-6-astra', messages: [
      { role: 'assistant', content: 'Previous image', image: { dataUrl: routerBody.message.image.dataUrl } },
      { role: 'user', content: 'Turn this green', attachments: [{ name: 'photo.png', type: 'image/png', dataUrl: uploadedImage }] }
    ] })
  });
  assert.equal(attachedEdit.status, 200);
  assert.equal(calls[5].payload.input[0].content[1].image_url, uploadedImage);

  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n').toString('base64')}`;
  const textFile = `data:text/plain;base64,${Buffer.from('Some useful notes').toString('base64')}`;
  const attachments = [
    { name: 'photo.png', type: 'image/png', dataUrl: uploadedImage },
    { name: 'reference.pdf', type: 'application/pdf', dataUrl: pdf },
    { name: 'notes.txt', type: 'text/plain', dataUrl: textFile }
  ];
  const sendFiles = (provider, files) => fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'basic', provider, model: provider === 'openrouter' ? 'vendor/text' : 'gpt-6-astra',
      messages: [{ role: 'user', content: 'Summarize these', attachments: files }] })
  });
  assert.equal((await sendFiles('openai', attachments)).status, 200);
  assert.match(calls[6].payload.input[0].content[0].text, /Some useful notes/);
  assert.deepEqual(calls[6].payload.input[0].content.slice(1), [
    { type: 'input_image', image_url: uploadedImage },
    { type: 'input_file', filename: 'reference.pdf', file_data: pdf }
  ]);
  assert.equal((await sendFiles('openrouter', attachments)).status, 200);
  assert.match(calls[7].payload.messages[1].content[0].text, /Some useful notes/);
  assert.deepEqual(calls[7].payload.messages[1].content.slice(1), [
    { type: 'image_url', image_url: { url: uploadedImage } },
    { type: 'file', file: { filename: 'reference.pdf', file_data: pdf } }
  ]);
  const invalid = await sendFiles('openai', [{ name: 'photo.png', type: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 8);
});
