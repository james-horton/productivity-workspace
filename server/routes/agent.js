'use strict';

const express = require('express');

const {
  AgentRequestError,
  localOnly,
  validateApprovalRequest,
  validateStartRequest
} = require('../lib/agent/requestValidation');
const { AgentRuntimeError } = require('../lib/agent/runtime');

const OPENAI_TOOL_MODELS = new Map([
  ['gpt-5.6-sol', 'openai:gpt-5'],
  ['gpt-6-astra', 'openai:gpt-6-astra']
]);
const CAPABILITY_CACHE_MS = 10 * 60 * 1000;
const capabilityCache = new Map();

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseNonNegativeInteger(value, field, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AgentRequestError(`${field} must be a non-negative integer.`, { field });
  }
  return parsed;
}

function parseBoundedLimit(value, fallback = 50, maximum = 100) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new AgentRequestError(`limit must be an integer from 1 through ${maximum}.`, { field: 'limit' });
  }
  return parsed;
}

function capabilityError(provider, model) {
  return new AgentRuntimeError(
    'UNSUPPORTED_TOOL_CAPABILITY',
    `The selected model ${provider}:${model} is not known to support tool calling. Refresh the model list or choose a tool-capable model.`,
    400
  );
}

async function defaultToolCapabilityResolver(selection, options = {}) {
  const { provider, model, modelKey } = selection;
  const validModelKeys = provider === 'openai'
    ? new Set([OPENAI_TOOL_MODELS.get(model), `${provider}:${model}`])
    : new Set([`${provider}:${model}`]);
  if (modelKey !== undefined && !validModelKeys.has(modelKey)) {
    throw new AgentRequestError('modelKey does not match the selected provider and model.', {
      field: 'modelKey'
    });
  }
  if (provider === 'openai') {
    if (!(options.config && options.config.openai && options.config.openai.apiKey)) {
      throw new AgentRuntimeError('MISSING_PROVIDER_KEY', 'OpenAI API key missing.', 400);
    }
    if (!OPENAI_TOOL_MODELS.has(model)) throw capabilityError(provider, model);
    return true;
  }

  const config = options.config || {};
  const providerConfig = config.openrouter || {};
  if (!providerConfig.apiKey) {
    throw new AgentRuntimeError('MISSING_PROVIDER_KEY', 'OpenRouter API key missing.', 400);
  }
  const cached = capabilityCache.get(model);
  if (cached && Date.now() - cached.at < CAPABILITY_CACHE_MS) {
    if (!cached.supported) throw capabilityError(provider, model);
    return true;
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new AgentRuntimeError('MODEL_DISCOVERY_UNAVAILABLE', 'OpenRouter model discovery is unavailable.', 503);
  }
  const url = providerConfig.modelsUserUrl || providerConfig.modelsUrl;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${providerConfig.apiKey}` },
      signal: AbortSignal.timeout(Math.min(Number(providerConfig.timeoutMs) || 120000, 30000))
    });
  } catch (error) {
    throw new AgentRuntimeError(
      'MODEL_DISCOVERY_FAILED',
      `Unable to verify OpenRouter tool support: ${error.message}`,
      502
    );
  }
  if (!response.ok) {
    throw new AgentRuntimeError(
      'MODEL_DISCOVERY_FAILED',
      `Unable to verify OpenRouter tool support (HTTP ${response.status}).`,
      502
    );
  }
  const payload = await response.json();
  const models = payload && Array.isArray(payload.data) ? payload.data : [];
  const match = models.find(item => item && item.id === model);
  const parameters = match && (match.supported_parameters || match.supportedParameters);
  const supported = Array.isArray(parameters) && parameters.includes('tools');
  capabilityCache.set(model, { at: Date.now(), supported });
  if (!supported) throw capabilityError(provider, model);
  return true;
}

function publicRun(run) {
  return {
    id: run.id,
    threadId: run.threadId,
    request: run.request,
    provider: run.provider,
    model: run.model,
    modelSnapshot: { provider: run.provider, model: run.model },
    shell: run.shell,
    cwd: run.cwd,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    approval: run.approval || null
  };
}

function writeSseEvent(res, event) {
  const id = Number(event.id);
  res.write(`id: ${id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function createAgentRouter(options = {}) {
  const runtime = options.runtime;
  if (!runtime) throw new TypeError('createAgentRouter requires an Agent runtime');
  const config = options.config || {};
  const agentConfig = options.agentConfig || config.agent || {};
  const capabilityResolver = options.toolCapabilityResolver || defaultToolCapabilityResolver;
  const keepAliveMs = Number.isSafeInteger(options.keepAliveMs) && options.keepAliveMs > 0
    ? options.keepAliveMs
    : 15000;
  const router = express.Router();

  if (agentConfig.localOnly !== false) router.use(localOnly);

  router.post('/runs', route(async (req, res) => {
    if (runtime.enabled === false) {
      throw new AgentRuntimeError('AGENT_DISABLED', 'The Agent runtime is disabled.', 503);
    }
    const input = validateStartRequest(req.body, {
      requestMaxLength: agentConfig.requestMaxLength,
      commandMaxLength: agentConfig.commandMaxLength
    });
    await capabilityResolver(input, { config, fetch: options.fetch });
    const runRecord = await runtime.startRun({ ...input, supportsToolCalling: true });
    res.status(202).json({ run: publicRun(runRecord) });
  }));

  router.get('/runs', route(async (req, res) => {
    const limit = parseBoundedLimit(req.query.limit, 50, 100);
    const runs = await runtime.listRuns({ limit });
    res.json({ runs: runs.map(publicRun) });
  }));

  router.get('/runs/:runId', route(async (req, res) => {
    const runRecord = await runtime.getRun(req.params.runId);
    res.json({ run: publicRun(runRecord) });
  }));

  router.get('/runs/:runId/events', route(async (req, res) => {
    await runtime.getRun(req.params.runId);
    const headerValue = req.get('Last-Event-ID');
    let cursor = parseNonNegativeInteger(
      headerValue === undefined ? req.query.after : headerValue,
      headerValue === undefined ? 'after' : 'Last-Event-ID'
    );
    let replaying = true;
    let closed = false;
    const pending = new Map();

    const deliver = event => {
      if (closed || !event || !Number.isSafeInteger(Number(event.id))) return;
      const eventId = Number(event.id);
      if (eventId <= cursor) return;
      if (replaying) {
        pending.set(eventId, event);
        return;
      }
      writeSseEvent(res, event);
      cursor = eventId;
    };
    const unsubscribe = runtime.subscribe(req.params.runId, deliver);

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write('retry: 2000\n\n');

    try {
      const replayLimit = Math.max(1, Math.min(1000, Number(agentConfig.maxEventsPerRun) || 1000));
      let replayCursor = cursor;
      let replay;
      do {
        replay = await runtime.getEvents(req.params.runId, {
          afterEventId: replayCursor,
          limit: replayLimit
        });
        for (const event of replay) deliver(event);
        if (replay.length) replayCursor = Number(replay[replay.length - 1].id);
      } while (replay.length === replayLimit);
      replaying = false;
      for (const event of [...pending.values()].sort((left, right) => Number(left.id) - Number(right.id))) {
        deliver(event);
      }
      pending.clear();
    } catch (error) {
      unsubscribe();
      throw error;
    }

    const keepalive = setInterval(() => {
      if (!closed) res.write(`: keepalive ${Date.now()}\n\n`);
    }, keepAliveMs);
    if (typeof keepalive.unref === 'function') keepalive.unref();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      unsubscribe();
    };
    req.once('close', close);
    res.once('close', close);
  }));

  router.post('/runs/:runId/approval', route(async (req, res) => {
    const input = validateApprovalRequest(req.body, {
      commandMaxLength: agentConfig.commandMaxLength,
      maxDecisions: agentConfig.maxActionsPerApproval
    });
    const runRecord = await runtime.approve(req.params.runId, input);
    res.status(202).json({ run: publicRun(runRecord) });
  }));

  router.post('/runs/:runId/stop', route(async (req, res) => {
    const result = await runtime.stop(req.params.runId);
    res.json({ run: publicRun(result.run), changed: result.changed });
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.status || error.statusCode) || 500;
    const message = status >= 500 && !error.message
      ? 'Internal Server Error'
      : (error.message || 'Internal Server Error');
    res.status(status).json({
      error: {
        code: error.code || 'AGENT_INTERNAL_ERROR',
        message,
        ...(error.field ? { field: error.field } : {}),
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    });
  });

  return router;
}

module.exports = createAgentRouter;
module.exports.createAgentRouter = createAgentRouter;
module.exports.defaultToolCapabilityResolver = defaultToolCapabilityResolver;
module.exports.parseNonNegativeInteger = parseNonNegativeInteger;
module.exports.publicRun = publicRun;
module.exports.writeSseEvent = writeSseEvent;
