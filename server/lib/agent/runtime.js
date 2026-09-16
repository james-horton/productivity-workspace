'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SYSTEM_PROMPT = [
  'Work autonomously on the user request in the local workspace.',
  'Inspect the workspace before changing it, verify your work, and never claim a change without checking it.',
  'Use execute_shell for all workspace actions and prefer one command at a time.',
  'Every execute_shell call pauses for human approval, and rejection means the command did not run.',
  'Keep user-facing updates concise and never reveal hidden reasoning.'
].join(' ');

const ACTIVE_STATUSES = new Set(['running', 'awaiting_approval']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_ALLOWED_DECISIONS = Object.freeze(['approve', 'edit', 'reject']);

class AgentRuntimeError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    if (details !== undefined) this.details = details;
  }
}

function dependencyError(name, cause) {
  return new AgentRuntimeError(
    'AGENT_DEPENDENCY_UNAVAILABLE',
    `Unable to load Agent dependency ${name}: ${cause.message}`,
    500
  );
}

function loadDependencies() {
  try {
    const langchain = require('langchain');
    const langgraph = require('@langchain/langgraph');
    const sqlite = require('@langchain/langgraph-checkpoint-sqlite');
    const zod = require('zod');
    return {
      createAgent: langchain.createAgent,
      humanInTheLoopMiddleware: langchain.humanInTheLoopMiddleware,
      tool: langchain.tool,
      Command: langgraph.Command,
      SqliteSaver: sqlite.SqliteSaver,
      z: zod.z || zod
    };
  } catch (error) {
    throw dependencyError('LangChain/LangGraph', error);
  }
}

function shellName() {
  return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utf8Prefix(value, byteLimit) {
  if (byteLimit <= 0) return '';
  const buffer = Buffer.from(String(value));
  if (buffer.length <= byteLimit) return String(value);
  return buffer.subarray(0, byteLimit).toString('utf8').replace(/\uFFFD$/, '');
}

function asErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'Agent run failed');
}

function configuredSecrets(config) {
  return [
    config?.openai?.apiKey,
    config?.openrouter?.apiKey,
    config?.tavily?.apiKey
  ].filter(value => typeof value === 'string' && value).sort((a, b) => b.length - a.length);
}

function sanitizeEventPayload(value, secrets, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeEventPayload(item, secrets, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sanitizeEventPayload(item, secrets, seen)
  ]));
}

function normalizeStoreError(error) {
  if (error instanceof AgentRuntimeError) return error;
  const mappings = {
    ACTIVE_RUN_EXISTS: [409, 'ACTIVE_RUN_EXISTS'],
    RUN_NOT_FOUND: [404, 'RUN_NOT_FOUND'],
    STALE_APPROVAL: [409, 'STALE_APPROVAL'],
    APPROVAL_ALREADY_DECIDED: [409, 'STALE_APPROVAL'],
    DECISION_NOT_ALLOWED: [400, 'DECISION_NOT_ALLOWED'],
    INVALID_STATUS_TRANSITION: [409, 'INVALID_RUN_STATUS'],
    STALE_RUN: [409, 'STALE_RUN']
  };
  const mapping = mappings[error && error.code];
  if (!mapping) return error;
  return new AgentRuntimeError(mapping[1], error.message, mapping[0], error.details);
}

function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(block => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    const type = String(block.type || '').toLowerCase();
    if (!['text', 'output_text'].includes(type)) return '';
    return typeof block.text === 'string'
      ? block.text
      : (typeof block.content === 'string' ? block.content : '');
  }).join('');
}

function isAssistantMessage(message) {
  if (!message || typeof message !== 'object') return false;
  const type = typeof message._getType === 'function' ? message._getType() : message.type;
  return type === 'ai' || type === 'assistant' || message.role === 'assistant';
}

function extractInterrupts(value, found = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value.__interrupt__)) found.push(...value.__interrupt__);
  if (Array.isArray(value)) {
    for (const item of value) extractInterrupts(item, found, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (key !== '__interrupt__') extractInterrupts(item, found, seen);
    }
  }
  return found;
}

function collectToolCalls(value, found = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  for (const key of ['tool_calls', 'toolCalls']) {
    const calls = value[key];
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      if (!call || typeof call !== 'object' || typeof call.name !== 'string' ||
          !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) continue;
      if (call.id && found.some(item => item.id === call.id)) continue;
      found.push({ id: call.id || null, name: call.name, args: call.args });
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, found, seen);
  } else {
    for (const item of Object.values(value)) collectToolCalls(item, found, seen);
  }
  return found;
}

function normalizeInterrupt(interrupts, defaultCwd, observedToolCalls = []) {
  const actions = [];
  for (const interrupt of interrupts) {
    const value = interrupt?.payload || interrupt?.value || interrupt;
    const requests = Array.isArray(value && value.actionRequests) ? value.actionRequests : [];
    const configs = Array.isArray(value && value.reviewConfigs) ? value.reviewConfigs : [];
    requests.forEach((request, index) => {
      if (!request || request.name !== 'execute_shell') return;
      const args = request.args && typeof request.args === 'object' ? request.args : {};
      const review = configs[index] || configs.find(item => item && item.actionName === request.name) || {};
      actions.push({
        name: 'execute_shell',
        args: {
          command: String(args.command || ''),
          cwd: typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd : defaultCwd
        },
        toolCallId: request.id || request.toolCallId || request.tool_call_id || null,
        allowedDecisions: Array.isArray(review.allowedDecisions) && review.allowedDecisions.length
          ? review.allowedDecisions.filter(value => DEFAULT_ALLOWED_DECISIONS.includes(value))
          : [...DEFAULT_ALLOWED_DECISIONS]
      });
    });
  }
  const unusedCalls = [...observedToolCalls];
  actions.forEach(action => {
    if (action.toolCallId) return;
    let matchIndex = unusedCalls.findIndex(call => (
      call.name === action.name &&
      call.args.command === action.args.command &&
      (!call.args.cwd || call.args.cwd === action.args.cwd)
    ));
    if (matchIndex === -1) matchIndex = unusedCalls.findIndex(call => call.name === action.name);
    if (matchIndex !== -1) {
      action.toolCallId = unusedCalls[matchIndex].id;
      unusedCalls.splice(matchIndex, 1);
    }
  });
  return actions;
}

function normalizeApproval(approval) {
  if (!approval) return null;
  const storedActions = approval.originalArgs && Array.isArray(approval.originalArgs.actions)
    ? approval.originalArgs.actions
    : [{
        name: approval.actionName,
        args: approval.originalArgs,
        toolCallId: approval.toolCallId,
        allowedDecisions: approval.allowedDecisions
      }];
  return {
    approvalId: approval.id,
    runId: approval.runId,
    shell: approval.shell,
    createdAt: approval.createdAt,
    actions: storedActions
  };
}

class AgentRuntime {
  constructor(options = {}) {
    this.appConfig = options.config || {};
    this.config = options.agentConfig || this.appConfig.agent || {};
    this.enabled = this.config.enabled !== false;
    this.projectRoot = path.resolve(options.projectRoot || this.config.projectRoot || path.resolve(__dirname, '..', '..', '..'));
    this.dependencies = options.dependencies || null;
    this.store = options.store || null;
    this.checkpointer = options.checkpointer || null;
    this.createModel = options.createModel || null;
    this.executeShell = options.executeShell || null;
    this.createStore = options.createStore || null;
    this.logger = options.logger || console;
    this.workers = new Map();
    this.listeners = new Map();
    this.mutationTail = Promise.resolve();
    this.initialized = false;
    this.closing = false;
  }

  async initialize() {
    if (this.initialized) return this;
    this.initialized = true;
    if (!this.enabled) return this;

    try {
      const dependencies = this.#deps();
      if (!this.store) {
        const { AgentStore } = require('./store');
        const factory = this.createStore || (input => new AgentStore(input));
        this.store = factory({
          dbPath: this.config.dbPath || path.join(this.projectRoot, 'agent.sqlite'),
          recoverOrphans: false,
          maxEventsPerRun: positiveInteger(this.config.maxEventsPerRun, 2000)
        });
      }
      if (!this.checkpointer) {
        this.checkpointer = new dependencies.SqliteSaver(
          typeof this.store.getDatabase === 'function' ? this.store.getDatabase() : this.store.db
        );
      }
      if (typeof this.checkpointer.setup === 'function') this.checkpointer.setup();
      if (typeof this.store.setCheckpointer === 'function') this.store.setCheckpointer(this.checkpointer);
      if (typeof this.store.recoverOrphanedRuns === 'function') this.store.recoverOrphanedRuns();
      await this.#cleanupRetention();
    } catch (error) {
      this.initialized = false;
      throw normalizeStoreError(error);
    }
    return this;
  }

  #deps() {
    if (!this.dependencies) this.dependencies = loadDependencies();
    return this.dependencies;
  }

  #assertAvailable() {
    if (!this.enabled) {
      throw new AgentRuntimeError('AGENT_DISABLED', 'The Agent runtime is disabled.', 503);
    }
    if (!this.initialized || !this.store) {
      throw new AgentRuntimeError('AGENT_NOT_READY', 'The Agent runtime is not initialized.', 503);
    }
    if (this.closing) {
      throw new AgentRuntimeError('AGENT_SHUTTING_DOWN', 'The Agent runtime is shutting down.', 503);
    }
  }

  async #cleanupRetention() {
    if (typeof this.store?.cleanupRetention !== 'function') return;
    await this.store.cleanupRetention({
      maxRuns: positiveInteger(this.config.maxRuns, 100),
      maxEventsPerRun: positiveInteger(this.config.maxEventsPerRun, 2000),
      maxAgeDays: positiveInteger(this.config.retentionDays, 30),
      checkpointer: this.checkpointer
    });
  }

  #mutate(operation) {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.catch(() => {});
    return result;
  }

  #append(runId, type, payload) {
    const event = this.store.appendEvent(
      runId,
      type,
      sanitizeEventPayload(payload, configuredSecrets(this.appConfig))
    );
    const publish = persisted => {
      const listeners = this.listeners.get(runId);
      if (listeners) {
        for (const listener of [...listeners]) {
          try { listener(persisted); } catch {}
        }
      }
      return persisted;
    };
    return event && typeof event.then === 'function' ? event.then(publish) : publish(event);
  }

  subscribe(runId, listener) {
    this.#assertAvailable();
    let listeners = this.listeners.get(runId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(runId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  async startRun(input) {
    this.#assertAvailable();
    if (input.supportsToolCalling !== true) {
      throw new AgentRuntimeError(
        'UNSUPPORTED_TOOL_CAPABILITY',
        `The selected model ${input.provider}:${input.model} is not known to support tool calling. Refresh the model list or choose a tool-capable model.`,
        400
      );
    }

    return this.#mutate(async () => {
      try {
        await this.#cleanupRetention();
        const run = await this.store.createRun({
          id: crypto.randomUUID(),
          request: input.request,
          provider: input.provider,
          model: input.model,
          shell: shellName(),
          cwd: this.projectRoot
        });
        await this.#append(run.id, 'run_started', {
          request: run.request,
          provider: run.provider,
          model: run.model,
          shell: run.shell,
          cwd: run.cwd
        });
        this.#enqueue(run.id, { kind: 'start' });
        return run;
      } catch (error) {
        throw normalizeStoreError(error);
      }
    });
  }

  async listRuns(options = {}) {
    this.#assertAvailable();
    return this.store.listRuns({ limit: positiveInteger(options.limit, 50) });
  }

  async getRun(runId) {
    this.#assertAvailable();
    const run = await this.store.getRun(runId);
    if (!run) throw new AgentRuntimeError('RUN_NOT_FOUND', `Agent run ${runId} was not found.`, 404);
    const approval = run.status === 'awaiting_approval'
      ? await this.store.getActiveApproval(runId)
      : null;
    return { ...run, approval: normalizeApproval(approval) };
  }

  async getEvents(runId, options = {}) {
    await this.getRun(runId);
    return this.store.getEvents(runId, {
      afterEventId: Number(options.afterEventId) || 0,
      limit: positiveInteger(options.limit, positiveInteger(this.config.maxEventsPerRun, 2000))
    });
  }

  async approve(runId, input) {
    this.#assertAvailable();
    return this.#mutate(async () => {
      try {
        const run = await this.store.getRun(runId);
        if (!run) throw new AgentRuntimeError('RUN_NOT_FOUND', `Agent run ${runId} was not found.`, 404);
        if (run.status !== 'awaiting_approval' || run.activeApprovalId !== input.approvalId) {
          throw new AgentRuntimeError('STALE_APPROVAL', `Approval ${input.approvalId} is no longer active.`, 409);
        }
        const approval = await this.store.getActiveApproval(runId);
        const normalized = normalizeApproval(approval);
        const actions = normalized ? normalized.actions : [];
        if (input.decisions.length !== actions.length) {
          throw new AgentRuntimeError(
            'APPROVAL_DECISION_COUNT_MISMATCH',
            `Expected ${actions.length} approval decision(s), received ${input.decisions.length}.`,
            400
          );
        }

        input.decisions.forEach((decision, index) => {
          const allowed = actions[index].allowedDecisions || DEFAULT_ALLOWED_DECISIONS;
          if (!allowed.includes(decision.type)) {
            throw new AgentRuntimeError(
              'DECISION_NOT_ALLOWED',
              `${decision.type} is not allowed for action ${index + 1}.`,
              400
            );
          }
          if (decision.type === 'edit' && decision.editedAction.name !== 'execute_shell') {
            throw new AgentRuntimeError('INVALID_EDITED_ACTION', 'Only execute_shell actions may be edited.', 400);
          }
        });

        const representative = input.decisions.some(item => item.type === 'edit')
          ? 'edit'
          : (input.decisions.some(item => item.type === 'reject') ? 'reject' : 'approve');
        const persistenceInput = {
          decision: representative,
          feedback: input.decisions.map(item => item.feedback || '').filter(Boolean).join('\n') || null,
          editedArgs: representative === 'edit' ? { decisions: input.decisions } : null
        };
        const decisionResult = await this.store.decideApproval(runId, input.approvalId, persistenceInput);
        if (decisionResult.duplicate) {
          throw new AgentRuntimeError('STALE_APPROVAL', `Approval ${input.approvalId} was already decided.`, 409);
        }
        await this.#append(runId, 'approval_decided', {
          approvalId: input.approvalId,
          decisions: input.decisions
        });
        this.#enqueue(runId, {
          kind: 'resume',
          decisions: input.decisions,
          actions
        });
        return decisionResult.run;
      } catch (error) {
        throw normalizeStoreError(error);
      }
    });
  }

  async stop(runId) {
    this.#assertAvailable();
    return this.#mutate(async () => {
      try {
        const run = await this.store.getRun(runId);
        if (!run) throw new AgentRuntimeError('RUN_NOT_FOUND', `Agent run ${runId} was not found.`, 404);
        if (TERMINAL_STATUSES.has(run.status)) return { run, changed: false };
        const result = await this.store.cancelRun(runId);
        const worker = this.workers.get(runId);
        if (worker) {
          worker.controller.abort();
          await worker.promise;
        }
        await this.#append(runId, 'run_cancelled', { reason: 'Stopped by user' });
        await this.#cleanupRetention();
        return { run: result.run, changed: result.changed };
      } catch (error) {
        throw normalizeStoreError(error);
      }
    });
  }

  #enqueue(runId, work) {
    if (this.closing) return;
    const existing = this.workers.get(runId);
    if (existing) {
      existing.promise.finally(() => this.#enqueue(runId, work));
      return;
    }
    const controller = new AbortController();
    const token = {};
    const worker = {
      controller,
      token,
      promise: new Promise(resolve => setImmediate(resolve))
        .then(() => this.#runWorker(runId, work, controller))
        .catch(error => this.#handleWorkerFailure(runId, error, controller.signal))
        .finally(() => {
          if (this.workers.get(runId)?.token === token) this.workers.delete(runId);
        })
    };
    this.workers.set(runId, worker);
  }

  async #executeCommand(run, args, toolCallId, controller, writer) {
    const executeShell = this.executeShell || require('./shellExecutor').executeShell;
    const cwd = args.cwd || run.cwd || this.projectRoot;
    const outputLimit = positiveInteger(this.config.maxOutputBytes, 1024 * 1024);
    let persistedOutputBytes = 0;
    await this.#append(run.id, 'command_started', {
      toolCallId,
      command: args.command,
      cwd,
      shell: run.shell
    });
    const result = await executeShell({
      command: args.command,
      cwd,
      timeoutMs: positiveInteger(this.config.commandTimeoutMs, 600_000),
      maxOutputBytes: outputLimit,
      signal: controller.signal,
      onEvent: event => {
        if (event.type !== 'stdout' && event.type !== 'stderr') return;
        const data = utf8Prefix(event.data, outputLimit - persistedOutputBytes);
        if (!data) return;
        persistedOutputBytes += Buffer.byteLength(data);
        const progress = {
          name: 'shell_output',
          toolCallId,
          stream: event.type,
          data
        };
        if (typeof writer === 'function') writer(progress);
        else void this.#append(run.id, 'command_output', progress);
      }
    });
    const persistedResult = { ...result };
    delete persistedResult.output;
    await this.#append(run.id, 'command_completed', { toolCallId, ...persistedResult });
    return result;
  }

  async #createGraph(run, context) {
    const dependencies = this.#deps();
    const createModel = this.createModel || require('./modelFactory').createAgentModel;
    const model = await createModel({
      provider: run.provider,
      model: run.model,
      supportsToolCalling: true
    }, { config: this.appConfig });
    const commandMax = positiveInteger(this.config.commandMaxLength, 20_000);
    const cwdMax = positiveInteger(this.config.cwdMaxChars, 2_000);
    const schema = dependencies.z.object({
      command: dependencies.z.string().min(1).max(commandMax),
      cwd: dependencies.z.string().min(1).max(cwdMax).optional()
    });
    const shellTool = dependencies.tool(async (args, toolRuntime) => {
      const previous = context.shellTail;
      let release;
      context.shellTail = new Promise(resolve => { release = resolve; });
      await previous;
      const toolCallId = toolRuntime && (toolRuntime.toolCallId || toolRuntime.tool_call_id) || null;
      try {
        if (context.controller.signal.aborted) {
          return JSON.stringify({ status: 'cancelled', cancelled: true, output: '', error: 'Command cancelled' });
        }
        const result = await this.#executeCommand(
          run,
          args,
          toolCallId,
          context.controller,
          toolRuntime?.writer
        );
        return JSON.stringify(result);
      } finally {
        release();
      }
    }, {
      name: 'execute_shell',
      description: 'Execute one non-interactive command using the host default shell. Every call requires human approval.',
      schema
    });
    return dependencies.createAgent({
      model,
      tools: [shellTool],
      systemPrompt: SYSTEM_PROMPT,
      middleware: [dependencies.humanInTheLoopMiddleware({
        interruptOn: {
          execute_shell: { allowedDecisions: [...DEFAULT_ALLOWED_DECISIONS] }
        }
      })],
      checkpointer: this.checkpointer
    });
  }

  async #runWorker(runId, work, controller) {
    const run = await this.store.getRun(runId);
    if (!run || run.status !== 'running' || controller.signal.aborted) return;
    const context = { controller, shellTail: Promise.resolve() };
    const graph = await this.#createGraph(run, context);
    const dependencies = this.#deps();
    let resumeDecisions = work.decisions;
    if (work.kind === 'resume' && work.decisions.some(decision => decision.type === 'reject') &&
        work.decisions.some(decision => decision.type !== 'reject')) {
      resumeDecisions = [];
      for (let index = 0; index < work.decisions.length; index += 1) {
        const decision = work.decisions[index];
        const action = work.actions[index];
        if (decision.type === 'reject') {
          resumeDecisions.push(decision);
          continue;
        }
        const selectedAction = decision.type === 'edit' ? decision.editedAction : action;
        const result = await this.#executeCommand(
          run,
          selectedAction.args,
          action?.toolCallId || null,
          controller
        );
        resumeDecisions.push({
          type: 'reject',
          feedback: `The user approved this command and it executed outside the review middleware. Result: ${JSON.stringify(result)}`
        });
        if (controller.signal.aborted) return;
      }
    }
    const input = work.kind === 'resume'
      ? new dependencies.Command({ resume: { decisions: resumeDecisions.map(decision => {
          if (decision.type === 'reject') {
            return {
              type: 'reject',
              message: decision.feedback || 'The user rejected this command. It did not execute.'
            };
          }
          if (decision.type === 'edit') {
            return {
              type: 'edit',
              editedAction: decision.editedAction
            };
          }
          return { type: 'approve' };
        }) } })
      : { messages: [{ role: 'user', content: run.request }] };
    const graphConfig = {
      configurable: { thread_id: run.threadId || run.id },
      signal: controller.signal
    };
    let interrupts = [];
    const observedToolCalls = [];
    let emittedText = false;

    if (typeof graph.streamEvents === 'function') {
      const eventRun = await graph.streamEvents(input, {
        ...graphConfig,
        version: 'v3'
      });
      const messagesTask = (async () => {
        for await (const projection of eventRun.messages) {
          let projectedText = false;
          if (projection?.text && typeof projection.text[Symbol.asyncIterator] === 'function') {
            for await (const delta of projection.text) {
              if (!delta) continue;
              projectedText = true;
              emittedText = true;
              await this.#append(runId, 'agent_message', { text: String(delta), delta: true });
            }
          }
          if (projection?.output) {
            const message = await projection.output;
            collectToolCalls(message, observedToolCalls);
            if (!projectedText && isAssistantMessage(message)) {
              const text = plainText(message.content);
              if (text) {
                emittedText = true;
                await this.#append(runId, 'agent_message', { text, delta: false });
              }
            }
          }
        }
      })();
      const protocolTask = (async () => {
        for await (const event of eventRun) {
          const method = event?.method;
          const data = event?.params?.data;
          collectToolCalls(data, observedToolCalls);
          if (method === 'custom' && data?.name === 'shell_output') {
            await this.#append(runId, 'command_output', {
              toolCallId: data.toolCallId || null,
              stream: data.stream,
              data: data.data
            });
          }
        }
      })();
      const result = await eventRun.output;
      await Promise.all([messagesTask, protocolTask]);
      interrupts = Array.isArray(eventRun.interrupts) && eventRun.interrupts.length
        ? eventRun.interrupts
        : extractInterrupts(result);
      collectToolCalls(result, observedToolCalls);
    } else if (typeof graph.stream === 'function') {
      const stream = await graph.stream(input, {
        ...graphConfig,
        streamMode: ['messages', 'updates']
      });
      for await (const rawChunk of stream) {
        if (controller.signal.aborted) break;
        const multiMode = Array.isArray(rawChunk) && typeof rawChunk[0] === 'string';
        const mode = multiMode ? rawChunk[0] : 'updates';
        const chunk = multiMode ? rawChunk[1] : rawChunk;
        interrupts.push(...extractInterrupts(chunk));
        collectToolCalls(chunk, observedToolCalls);
        if (mode === 'messages') {
          const message = Array.isArray(chunk) ? chunk[0] : chunk;
          if (isAssistantMessage(message)) {
            const text = plainText(message.content);
            if (text) {
              emittedText = true;
              await this.#append(runId, 'agent_message', { text, delta: true });
            }
          }
        }
      }
    } else {
      const result = await graph.invoke(input, graphConfig);
      interrupts = extractInterrupts(result);
      collectToolCalls(result, observedToolCalls);
      const messages = result && Array.isArray(result.messages) ? result.messages : [];
      const finalMessage = [...messages].reverse().find(isAssistantMessage);
      const text = finalMessage ? plainText(finalMessage.content) : '';
      if (text) {
        emittedText = true;
        await this.#append(runId, 'agent_message', { text, delta: false });
      }
    }

    if (controller.signal.aborted) return;
    const current = await this.store.getRun(runId);
    if (!current || current.status !== 'running') return;
    const actions = normalizeInterrupt(interrupts, run.cwd || this.projectRoot, observedToolCalls);
    if (actions.length) {
      const maxActions = positiveInteger(this.config.maxActionsPerApproval, 32);
      if (actions.length > maxActions) {
        throw new AgentRuntimeError(
          'TOO_MANY_APPROVAL_ACTIONS',
          `The model proposed ${actions.length} commands in one turn; the maximum is ${maxActions}. Start a new run and ask it to use one command at a time.`,
          400
        );
      }
      const firstInterrupt = interrupts[0];
      const approvalId = String(
        firstInterrupt?.interruptId || firstInterrupt?.id || crypto.randomUUID()
      );
      const first = actions[0];
      await this.store.markAwaitingApproval(runId, {
        id: approvalId,
        toolCallId: first.toolCallId,
        actionName: 'execute_shell',
        shell: run.shell,
        cwd: first.args.cwd,
        allowedDecisions: [...DEFAULT_ALLOWED_DECISIONS],
        originalArgs: { actions }
      });
      await this.#append(runId, 'approval_requested', {
        approvalId,
        shell: run.shell,
        actions
      });
      return;
    }

    const completed = await this.store.completeRun(runId);
    if (completed.changed) {
      await this.#append(runId, 'run_completed', { hasAgentOutput: emittedText });
      await this.#cleanupRetention();
    }
  }

  async #handleWorkerFailure(runId, error, signal) {
    try {
      const run = await this.store.getRun(runId);
      if (!run || TERMINAL_STATUSES.has(run.status)) return;
      if (signal.aborted) {
        const cancelled = await this.store.cancelRun(runId);
        if (cancelled.changed) await this.#append(runId, 'run_cancelled', { reason: 'Agent worker cancelled' });
        return;
      }
      const message = sanitizeEventPayload(
        asErrorMessage(error),
        configuredSecrets(this.appConfig)
      );
      const failed = await this.store.failRun(runId, message);
      if (failed.changed) {
        await this.#append(runId, 'run_failed', { error: message });
        await this.#cleanupRetention();
      }
    } catch (secondaryError) {
      this.logger.error('[agent] Unable to persist worker failure:', secondaryError);
    }
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    const active = this.store && typeof this.store.getActiveRun === 'function'
      ? await this.store.getActiveRun()
      : null;
    let cancelledRunId = null;
    if (active?.status === 'running') {
      try {
        const result = await this.store.cancelRun(active.id);
        if (result.changed) cancelledRunId = active.id;
      } catch (error) {
        this.logger.error('[agent] Unable to cancel active run during shutdown:', error);
      }
    }
    for (const worker of this.workers.values()) worker.controller.abort();
    await Promise.allSettled([...this.workers.values()].map(worker => worker.promise));
    this.workers.clear();
    if (cancelledRunId) {
      await this.#append(cancelledRunId, 'run_cancelled', { reason: 'Server shutting down' });
    }
    this.listeners.clear();
    if (this.store && typeof this.store.close === 'function') this.store.close();
  }
}

function createAgentRuntime(options) {
  return new AgentRuntime(options);
}

module.exports = {
  ACTIVE_STATUSES,
  AgentRuntime,
  AgentRuntimeError,
  DEFAULT_ALLOWED_DECISIONS,
  SYSTEM_PROMPT,
  TERMINAL_STATUSES,
  createAgentRuntime,
  plainText
};
