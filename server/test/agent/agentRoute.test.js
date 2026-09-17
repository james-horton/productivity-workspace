'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const express = require('express');
const { AgentRuntimeError } = require('../../lib/agent/runtime');
const { createAgentRouter, defaultToolCapabilityResolver } = require('../../routes/agent');

function sampleRun(overrides = {}) {
  return {
    id: 'run-1',
    threadId: 'run-1',
    request: 'Inspect the workspace',
    provider: 'openai',
    model: 'gpt-5.6-sol',
    approvalMode: 'manual',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    cwd: process.cwd(),
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    error: null,
    ...overrides
  };
}

function createFakeRuntime(overrides = {}) {
  const listeners = new Set();
  const run = sampleRun();
  let markSubscribed;
  const subscribed = new Promise(resolve => { markSubscribed = resolve; });
  return {
    enabled: true,
    subscribed,
    async startRun(input) { return { ...run, ...input }; },
    async listRuns() { return [run]; },
    async getRun() { return run; },
    async getEvents() { return []; },
    subscribe(runId, listener) {
      listeners.add(listener);
      markSubscribed();
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    async approve() { return { ...run, status: 'running' }; },
    async stop() { return { run: { ...run, status: 'cancelled' }, changed: true }; },
    ...overrides
  };
}

async function listen(runtime, routerOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter({
    runtime,
    config: {
      agent: { localOnly: true, requestMaxLength: 1000, maxEventsPerRun: 100 },
      openrouter: {}
    },
    toolCapabilityResolver: async () => true,
    keepAliveMs: 60_000,
    ...routerOptions
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/agent`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

test('POST runs returns 202 with the exact provider/model snapshot', async t => {
  let received;
  const runtime = createFakeRuntime({
    async startRun(input) {
      received = input;
      return sampleRun({ provider: input.provider, model: input.model, request: input.request });
    }
  });
  const server = await listen(runtime);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: 'Do the work',
      provider: 'openrouter',
      model: 'vendor/exact-model',
      modelKey: 'openrouter:vendor/exact-model'
    })
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(body.run.modelSnapshot, {
    provider: 'openrouter',
    model: 'vendor/exact-model'
  });
  assert.equal(received.supportsToolCalling, true);
  assert.equal(received.model, 'vendor/exact-model');
});

test('POST runs preserves the requested YOLO approval mode', async t => {
  let received;
  const runtime = createFakeRuntime({
    async startRun(input) {
      received = input;
      return sampleRun({ approvalMode: input.approvalMode });
    }
  });
  const server = await listen(runtime);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: 'Run autonomously',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      approvalMode: 'yolo'
    })
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(received.approvalMode, 'yolo');
  assert.equal(body.run.approvalMode, 'yolo');
});

test('POST runs rejects YOLO when it is disabled by configuration', async t => {
  const runtime = createFakeRuntime();
  const server = await listen(runtime, {
    config: {
      agent: { localOnly: true, allowYolo: false, requestMaxLength: 1000, maxEventsPerRun: 100 },
      openrouter: {}
    }
  });
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: 'Run autonomously',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      approvalMode: 'yolo'
    })
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'YOLO_DISABLED');
});

test('OpenAI capability validation accepts the model picker key without fallback', async () => {
  const config = { openai: { apiKey: 'configured' } };
  await assert.doesNotReject(defaultToolCapabilityResolver({
    provider: 'openai',
    model: 'gpt-5.6-sol',
    modelKey: 'openai:gpt-5'
  }, { config }));
  await assert.rejects(defaultToolCapabilityResolver({
    provider: 'openai',
    model: 'gpt-5.6-sol',
    modelKey: 'openai:gpt-6-astra'
  }, { config }), error => error.field === 'modelKey');
});

test('route errors retain active-run conflict and stale-approval codes', async t => {
  const runtime = createFakeRuntime({
    async startRun() {
      throw new AgentRuntimeError('ACTIVE_RUN_EXISTS', 'Another run is active.', 409);
    },
    async approve() {
      throw new AgentRuntimeError('STALE_APPROVAL', 'Approval is stale.', 409);
    }
  });
  const server = await listen(runtime);
  t.after(server.close);

  const start = await fetch(`${server.baseUrl}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: 'work', provider: 'openai', model: 'gpt-5.6-sol' })
  });
  assert.equal(start.status, 409);
  assert.equal((await start.json()).error.code, 'ACTIVE_RUN_EXISTS');

  const approval = await fetch(`${server.baseUrl}/runs/run-1/approval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: 'old', decisions: [{ type: 'approve' }] })
  });
  assert.equal(approval.status, 409);
  assert.equal((await approval.json()).error.code, 'STALE_APPROVAL');
});

test('Stop returns the runtime idempotency result', async t => {
  let calls = 0;
  const runtime = createFakeRuntime({
    async stop() {
      calls += 1;
      return {
        run: sampleRun({ status: 'cancelled', completedAt: '2026-01-01T00:01:00.000Z' }),
        changed: calls === 1
      };
    }
  });
  const server = await listen(runtime);
  t.after(server.close);

  const first = await fetch(`${server.baseUrl}/runs/run-1/stop`, { method: 'POST' });
  const second = await fetch(`${server.baseUrl}/runs/run-1/stop`, { method: 'POST' });
  assert.equal((await first.json()).changed, true);
  assert.equal((await second.json()).changed, false);
});

test('SSE replays monotonically and does not lose an event published during replay', async t => {
  let releaseReplay;
  const replayReady = new Promise(resolve => { releaseReplay = resolve; });
  const runtime = createFakeRuntime({
    async getEvents() {
      await replayReady;
      return [
        { id: 2, runId: 'run-1', type: 'agent_message', payload: { text: 'two' } }
      ];
    }
  });
  const server = await listen(runtime);
  t.after(server.close);

  const responsePromise = fetch(`${server.baseUrl}/runs/run-1/events`, {
    headers: { 'Last-Event-ID': '1' }
  });
  await runtime.subscribed;
  runtime.emit({ id: 3, runId: 'run-1', type: 'agent_message', payload: { text: 'three' } });
  releaseReplay();

  const response = await responsePromise;
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('id: 3\n')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  const ids = [...text.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]));
  assert.deepEqual(ids, [2, 3]);
  assert.equal(new Set(ids).size, ids.length);
});

test('SSE pages through the complete durable backlog', async t => {
  const durable = [1, 2, 3, 4, 5].map(id => ({
    id,
    runId: 'run-1',
    type: 'agent_message',
    payload: { text: String(id) }
  }));
  const runtime = createFakeRuntime({
    async getEvents(runId, { afterEventId, limit }) {
      return durable.filter(event => event.id > afterEventId).slice(0, limit);
    }
  });
  const server = await listen(runtime, {
    config: { agent: { localOnly: true, maxEventsPerRun: 2 } }
  });
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/runs/run-1/events?after=0`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  while (!body.includes('id: 5\n')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    body += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  const ids = [...body.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]));
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});
