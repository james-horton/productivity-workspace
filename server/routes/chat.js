const express = require('express');
const router = express.Router();

const { openaiChat } = require('../lib/providers/openai');
const { openrouterChat, openrouterImage } = require('../lib/providers/openrouter');
const { isOpenRouterImageModel } = require('./models');
const { config } = require('../config');
// Mode specifications: reasoning + default search + disclaimers
const MODE_SPECS = {
  doctor: {
    model: 'gpt-5.6-sol',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is not medical advice. For urgent or serious symptoms, contact a licensed clinician or emergency services.'
  },
  therapist: {
    model: 'gpt-5.6-sol',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: 'This is supportive conversation, not a substitute for professional mental health care. If in crisis, contact local emergency services or a crisis hotline.'
  },
  web: {
    model: 'gpt-5.6-terra',
    reasoning: 'low',
    defaultSearch: true,
    disclaimer: null
  },
  basic: {
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  },
  excuse: {
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  },
  grammar: {
    model: 'gpt-5.6-luna',
    reasoning: 'none',
    defaultSearch: false,
    disclaimer: null
  },
  eli5: {
    model: 'gpt-5.6-sol',
    reasoning: 'low',
    defaultSearch: false,
    disclaimer: null
  },
  debate_lord: {
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    defaultSearch: false,
    disclaimer: null
  },
  big_brain: {
    model: 'gpt-5.6-sol',
    reasoning: 'xhigh',
    reasoningMode: 'pro',
    defaultSearch: false,
    disclaimer: 'High-reasoning mode. No web search and no code interpreter is available.',
    maxInputTokens: 4000,
    maxOutputTokens: 4000
  },
  coder: {
    model: 'gpt-5.6-sol',
    reasoning: 'high',
    defaultSearch: false,
    disclaimer: ''
  },
  image: {
    model: 'gpt-5.6-sol',
    reasoning: 'low',
    defaultSearch: false,
    disclaimer: null
  }
};

// Reasoning levels the client is allowed to override on a per-request basis.
// Only honored when mode === 'basic'; every other mode keeps its fixed MODE_SPECS reasoning.
const VALID_BASIC_REASONING = new Set(['none', 'low', 'medium', 'high', 'xhigh']);
const SELECTABLE_OPENAI_MODELS = new Set(['gpt-5.6-sol', 'gpt-6-astra']);

function coerceArray(val) {
  return Array.isArray(val) ? val : [];
}

function badAttachment() {
  const error = new Error('Invalid attachment. Use images, PDFs, or text files (up to 4 MB each, 8 MB total).');
  error.status = 400;
  throw error;
}

function sanitizeAttachments(raw, mode) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > (mode === 'image' ? 1 : 3)) badAttachment();
  let total = 0;
  return raw.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 180 ||
        typeof file.type !== 'string' || typeof file.dataUrl !== 'string') badAttachment();
    const type = file.type;
    if (!(type === 'application/pdf' || /^image\/(?:png|jpeg|webp|gif)$/.test(type) || /^text\/[a-z0-9.+-]+$/.test(type)) ||
        (mode === 'image' && !type.startsWith('image/'))) badAttachment();
    const prefix = `data:${type};base64,`;
    const encoded = file.dataUrl.startsWith(prefix) ? file.dataUrl.slice(prefix.length) : '';
    if (!encoded || encoded.length > Math.ceil(4 * 1024 * 1024 / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) badAttachment();
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length > 4 * 1024 * 1024 || (total += buffer.length) > 8 * 1024 * 1024) badAttachment();
    if (type === 'application/pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') badAttachment();
    if (type === 'image/png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') badAttachment();
    if (type === 'image/jpeg' && buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') badAttachment();
    if (type === 'image/gif' && !/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) badAttachment();
    if (type === 'image/webp' && !(buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')) badAttachment();
    return { name: file.name.replace(/[\r\n<>]/g, '_'), type, dataUrl: file.dataUrl, buffer };
  });
}

function sanitizeMessages(messages) {
  // Keep only role/content and trim strings
  return coerceArray(messages)
    .map(m => ({
      role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, 8000) : ''
    }))
    .filter(m => m.content);
}

function buildSystemPrompt(mode) {
  switch (mode) {
    case 'doctor':
      return [
        'You are a careful, evidence-informed medical assistant.',
        'Ask relevant clarifying questions if needed. Provide possible considerations and next steps.',
        'Be concise and clear. Avoid alarmist language.',
        'Respond in complete sentences like a natural conversation, and do not use lists.'
      ].join(' ');
    case 'therapist':
      return [
        'You are a supportive, empathetic, non-judgmental counselor.',
        'Reflect feelings, ask gentle questions, and offer practical next steps.',
        'Emphasize self-care and resources.'
      ].join(' ');
    case 'web':
      return [
        'You can use provided web results to answer.',
        'Cite specific sources by domain (e.g., source: example.com) when referencing facts.',
        'Be concise and avoid speculation.'
      ].join(' ');
    case 'basic':
      return [
        'You answer questions. Keep answers short and practical.',
        'Respond in complete sentences like a natural conversation, and do not use lists.'
      ].join(' ');
    case 'excuse':
      return 'Generate a believable excuse tailored to the problem.';
    case 'grammar':
      return [
        'You are a grammar, spelling, capitalization, and punctuation corrector.',
        'Return only the corrected text. Do not add explanations, notes, or extra content.',
        'Preserve the original meaning, tone, formatting, markdown, and line breaks.',
        'If the input is already correct, output it unchanged.'
      ].join(' ');
    case 'eli5':
      return [
        'Explain the user input like I am five years old.',
        'Use simple words and short sentences. Avoid jargon; if you must use it, define it simply.',
        'Prefer concrete examples or analogies.',
        'Keep it brief: one or two short paragraphs.',
        'End with a single-sentence summary that begins with "In short:".'
      ].join(' ');
    case 'debate_lord':
      return [
        'You are Debate Lord — a concise, strategic debate coach and sparring partner.',
        'Before anything else, ensure you know all three: mode ("train" or "debate"), side ("for" or "against"), and the topic.',
        'If any are missing, ask only for what is missing in a single, crisp question. Do not provide arguments until all three are known.',
        'TRAINING MODE: teach in bite-size steps. For each step: 1–2 supporting arguments with brief justification or evidence; 1–2 likely counters; and crisp rebuttals. Optionally add a tactic or phrasing.',
        'Keep it short (about 120–180 words). End with a one-line prompt to continue (e.g., "Want another tactic?").',
        'DEBATE MODE: short-form sparring. Reply in 2–5 sentences max; be direct and confident. Attack weaknesses and defend your side; occasionally ask a sharp probing question.',
        'General: be factual and avoid fabricating sources; do not browse unless explicitly asked.'
      ].join(' ');
    case 'big_brain':
      return [
        'You are a meticulous, high-reasoning assistant.',
        'Reason carefully internally. Provide a concise, well-structured final answer.'
      ].join(' ');
    case 'coder':
      return [
        'You are a senior coding assistant. Return only JSON with the following schema:',
        '{ "format": "coder_blocks_v1", "blocks": [ { "type": "paragraph", "text": "..." }, { "type": "code", "language": "<language>", "filename": "<optional>", "code": "<code-without-backticks>" } ] }',
        'Rules:',
        '- Output strictly valid JSON. No Markdown fences or backticks. No surrounding prose.',
        '- Prefer multiple small code blocks over one huge block.',
        '- Use language keys compatible with highlight.js common languages (e.g., javascript, typescript, python, bash, json, html, css, markdown, java, csharp, go, rust, php, ruby, kotlin, swift, sql, yaml, dockerfile).',
        '- If you include a filename, keep it simple (e.g., "index.html").',
        '- Keep paragraphs brief and technical.',
        'Do not browse the web or include URLs unless asked.'
      ].join(' ');
    case 'image':
      return 'Generate an image from the user prompt.';
    default:
      return 'You are a helpful assistant.';
  }
}

async function callPreferredModels({ reasoning, reasoningMode, messages, prefer, model, fallbackModel, webSearch, maxTokens }) {
  // prefer is an array of provider ids in order; default to OpenAI only
  const attempts = Array.isArray(prefer) && prefer.length ? prefer : ['openai'];

  let lastErr;
  for (const provider of attempts) {
    try {
      if (provider === 'openai') {
        const out = await openaiChat({
          messages,
          reasoningLevel: reasoning,
          reasoningMode,
          temperature: config.openai.defaultTemperature,
          maxTokens: (Number.isFinite(maxTokens) ? maxTokens : config.openai.defaultMaxTokens),
          model: fallbackModel || model,
          webSearch
        });
        return { ...out, provider: 'openai' };
      }
      if (provider === 'openrouter') {
        const out = await openrouterChat({
          messages,
          reasoningLevel: reasoning === 'none' ? 'minimal' : reasoning,
          temperature: config.openrouter.defaultTemperature,
          maxTokens: (Number.isFinite(maxTokens) ? maxTokens : config.openrouter.defaultMaxTokens),
          model,
          webSearch
        });
        return { ...out, provider: 'openrouter' };
      }
    } catch (err) {
      // If key missing (we throw 400 with message), try next provider; otherwise rethrow
      if (err && (err.status === 400) && /key missing/i.test(err.message)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('No provider available');
}

router.post('/', async (req, res, next) => {
  try {
    const {
      mode = 'basic',
      messages: rawMessages,
      provider, // 'openai' or 'openrouter' (preferred)
      model, // optional specific model id for provider
      webSearch, // boolean: if true, enable the selected provider's native web search
      reasoning // optional client-supplied reasoning effort; only honored for mode === 'basic'
    } = req.body || {};

    const spec = MODE_SPECS[mode] || MODE_SPECS.basic;

    // Resolve effective reasoning: client may override only for Basic Info mode; otherwise the
    // per-mode fixed reasoning from MODE_SPECS is used. Invalid values fall back to spec.reasoning.
    const effectiveReasoning = (mode === 'basic' && VALID_BASIC_REASONING.has(reasoning))
      ? reasoning
      : spec.reasoning;

    // Build conversation
    const userMessages = sanitizeMessages(rawMessages);
    const latestRawUser = coerceArray(rawMessages).slice().reverse().find(message => message?.role === 'user');
    const attachments = sanitizeAttachments(latestRawUser?.attachments, mode);
    const textFiles = attachments.filter(file => file.type.startsWith('text/'));
    if (textFiles.length) {
      for (const file of textFiles) {
        if (file.buffer.length > 100_000) badAttachment();
      }
      const latest = userMessages.slice().reverse().find(message => message.role === 'user');
      if (latest) latest.content += textFiles.map(file => `\n\nAttached file (${file.name}):\n${file.buffer.toString('utf8')}`).join('');
    }
    const mediaAttachments = attachments.filter(file => !file.type.startsWith('text/'))
      .map(({ name, type, dataUrl }) => ({ name, type, dataUrl }));
    if (mediaAttachments.length) {
      const latest = userMessages.slice().reverse().find(message => message.role === 'user');
      if (latest) latest.attachments = mediaAttachments;
    }
    let latestUserContent = '';
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const um = userMessages[i];
      if (um && um.role === 'user' && typeof um.content === 'string') { latestUserContent = um.content; break; }
    }

    const sys = buildSystemPrompt(mode);
    const systemMsg = { role: 'system', content: sys };

    // Decide how to handle web search:
    // If explicit webSearch provided, honor it; otherwise fall back to mode default.
    const effectiveWebSearch = (typeof webSearch === 'boolean') 
      ? webSearch 
      : !!(MODE_SPECS[mode] && MODE_SPECS[mode].defaultSearch);

    // Provider preference: honor the requested provider, with OpenAI fallback/default.
    const requestedProvider = provider === 'openrouter' || provider === 'openai' ? provider : 'openai';
    const prefer = requestedProvider === 'openrouter' ? ['openrouter', 'openai'] : ['openai'];
    const requestedModel = typeof model === 'string' && model.trim() ? model.trim() : '';
    const selectedModel = requestedProvider === 'openrouter'
      ? (requestedModel || config.openrouter.defaultModel || undefined)
      : (SELECTABLE_OPENAI_MODELS.has(requestedModel) ? requestedModel : spec.model);
    if (mode === 'image') {
      const prompt = latestUserContent.trim();
      if (!prompt) return res.status(400).json({ error: { message: 'Enter an image prompt.' } });
      const referenceMessage = coerceArray(rawMessages).slice().reverse().find(message => message?.image);
      const referenceImage = mediaAttachments[0]?.dataUrl || referenceMessage?.image?.dataUrl;
      if (!mediaAttachments.length && referenceMessage && (typeof referenceImage !== 'string' || referenceImage.length > 30_000_040 ||
          !/^data:image\/(?:png|jpeg|webp|gif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(referenceImage))) {
        return res.status(400).json({ error: { message: 'The previous image is not a supported image reference.' } });
      }
      if (requestedProvider === 'openai' && requestedModel && !SELECTABLE_OPENAI_MODELS.has(requestedModel)) {
        return res.status(400).json({ error: { message: 'The selected OpenAI model is not available for image generation.' } });
      }
      let generated;
      if (requestedProvider === 'openrouter') {
        if (!await isOpenRouterImageModel(selectedModel)) {
          return res.status(400).json({ error: { message: 'The selected model does not support image generation. Select an image-output model.' } });
        }
        if (referenceImage && !await isOpenRouterImageModel(selectedModel, true)) {
          return res.status(400).json({ error: { message: 'The selected model cannot edit images. Select a model that supports image input and output.' } });
        }
        generated = await openrouterImage({ model: selectedModel, prompt, referenceImage });
      } else {
        generated = await openaiChat({ messages: [{ role: 'user', content: prompt }], model: selectedModel, reasoningLevel: 'low', imageGeneration: true, referenceImage });
      }
      const base64 = generated.image;
      const mediaType = generated.mediaType || 'image/png';
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType) ||
          typeof base64 !== 'string' || !base64 || base64.length > 30_000_000 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
        const err = new Error('The selected model did not return a supported image.');
        err.status = 502;
        throw err;
      }
      return res.json({
        message: { role: 'assistant', content: generated.text || 'Generated image.', image: { dataUrl: `data:${mediaType};base64,${base64}` } },
        modelUsed: generated.modelUsed,
        providerUsed: requestedProvider,
        disclaimer: null,
        sources: []
      });
    }
    const usingAstra = requestedProvider === 'openai' && selectedModel === 'gpt-6-astra';
    const finalMessages = [systemMsg, ...userMessages];

    // Call provider with optional model override and provider-native web search.
    const response = await callPreferredModels({
        reasoning: usingAstra && effectiveReasoning === 'none' ? 'low' : effectiveReasoning,
        reasoningMode: spec.reasoningMode,
        messages: finalMessages,
        prefer,
        model: selectedModel,
        fallbackModel: requestedProvider === 'openrouter' ? spec.model : selectedModel,
        webSearch: effectiveWebSearch,
        maxTokens: (spec && spec.maxOutputTokens) ? spec.maxOutputTokens : undefined
      });

    // Ensure Coder mode returns strict JSON for client-side rendering
    let assistantContent = response.text || '';
    if (mode === 'coder') {
      try {
        let t = String(assistantContent || '').trim();
        // Strip common triple-fence wrappers if model ignored instructions
        if (/^```/m.test(t)) {
          t = t.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/```$/, '');
        }
        const parsed = JSON.parse(t);
        // Basic shape guard for our UI renderer
        if (parsed && parsed.format === 'coder_blocks_v1' && Array.isArray(parsed.blocks)) {
          assistantContent = JSON.stringify(parsed);
        } else {
          throw new Error('Invalid coder_blocks_v1 shape');
        }
      } catch {
        // Fallback: wrap raw output into a minimal valid schema
        const fallback = {
          format: 'coder_blocks_v1',
          blocks: [
            { type: 'paragraph', text: 'Output could not be parsed as JSON; showing raw content as text.' },
            { type: 'code', language: 'text', filename: null, code: String(assistantContent || '') }
          ]
        };
        assistantContent = JSON.stringify(fallback);
      }
    }

    const payload = {
      message: { role: 'assistant', content: assistantContent },
      modelUsed: response.modelUsed,
      providerUsed: response.provider,
      disclaimer: spec.disclaimer || null,
      sources: []
    };

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
