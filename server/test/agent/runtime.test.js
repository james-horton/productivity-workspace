'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AgentRuntimeError, SYSTEM_PROMPT, createAgentRuntime } = require('../../lib/agent/runtime');

class MemoryStore {
  constructor(seed = []) {
    this.runs = new Map(seed.map(run => [run.id, { ...run }]));
    this.events = [];
    this.approvals = new Map();
    this.nextEventId = 1;
    this.recovered = false;
    this.closed = false;
  }

  setCheckpointer(checkpointer) { this.checkpointer = checkpointer; }
  recoverOrphanedRuns() {
    this.recovered = true;
    for (const run of this.runs.values()) {
      if (run.status === 'running') run.status = 'failed';
    }
  }
  async cleanupRetention() {}
  getDatabase() { return {}; }
  createRun(input) {
    const active = this.getActiveRun();
    if (active) {
      const error = new Error('A run is already active');
      error.code = 'ACTIVE_RUN_EXISTS';
      error.details = { runId: active.id };
      throw error;
    }
    const now = new Date().toISOString();
    const run = {
      ...input,
      threadId: input.id,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null,
      error: null,
      activeApprovalId: null
    };
    this.runs.set(run.id, run);
    return { ...run };
  }
  getRun(id) { return this.runs.has(id) ? { ...this.runs.get(id) } : null; }
  getActiveRun() {
    const run = [...this.runs.values()].find(item => ['running', 'awaiting_approval'].includes(item.status));
    return run ? { ...run } : null;
  }
  listRuns({ limit }) { return [...this.runs.values()].slice(0, limit).map(run => ({ ...run })); }
  appendEvent(runId, type, payload) {
    const event = { id: this.nextEventId++, runId, type, payload, createdAt: new Date().toISOString() };
    this.events.push(event);
    return event;
  }
  getEvents(runId, { afterEventId, limit }) {
    return this.events.filter(event => event.runId === runId && event.id > afterEventId).slice(0, limit);
  }
  markAwaitingApproval(runId, input) {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') throw new Error('invalid approval transition');
    const approval = {
      id: input.id,
      runId,
      toolCallId: input.toolCallId,
      actionName: input.actionName,
      shell: input.shell,
      cwd: input.cwd,
      allowedDecisions: input.allowedDecisions,
      originalArgs: input.originalArgs,
      editedArgs: null,
      decision: null,
      createdAt: new Date().toISOString()
    };
    this.approvals.set(input.id, approval);
    run.status = 'awaiting_approval';
    run.activeApprovalId = input.id;
    return { ...approval };
  }
  getActiveApproval(runId) {
    const run = this.runs.get(runId);
    const approval = run && this.approvals.get(run.activeApprovalId);
    return approval ? structuredClone(approval) : null;
  }
  decideApproval(runId, approvalId, input) {
    const run = this.runs.get(runId);
    const approval = this.approvals.get(approvalId);
    if (!run || run.status !== 'awaiting_approval' || run.activeApprovalId !== approvalId || !approval) {
      const error = new Error('Approval is stale');
      error.code = 'STALE_APPROVAL';
      throw error;
    }
    approval.decision = input.decision;
    approval.editedArgs = input.editedArgs;
    approval.feedback = input.feedback;
    run.status = 'running';
    run.activeApprovalId = null;
    return { approval: { ...approval }, run: { ...run }, duplicate: false };
  }
  transition(runId, status, error = null) {
    const run = this.runs.get(runId);
    if (run.status === status) return { run: { ...run }, changed: false };
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      const exception = new Error('already terminal');
      exception.code = 'INVALID_STATUS_TRANSITION';
      throw exception;
    }
    run.status = status;
    run.error = error;
    run.activeApprovalId = null;
    run.completedAt = new Date().toISOString();
    return { run: { ...run }, changed: true };
  }
  completeRun(id) { return this.transition(id, 'completed'); }
  failRun(id, error) { return this.transition(id, 'failed', String(error)); }
  cancelRun(id) { return this.transition(id, 'cancelled'); }
  close() { this.closed = true; }
}

function fakeDependencies(graphFactory) {
  class Command {
    constructor(input) { Object.assign(this, input); }
  }
  return {
    Command,
    SqliteSaver: class {},
    z: {
      object: shape => ({ shape }),
      string: () => {
        const schema = {
          min() { return schema; },
          max() { return schema; },
          optional() { return schema; }
        };
        return schema;
      }
    },
    tool: (fn, metadata) => ({ ...metadata, invoke: fn }),
    humanInTheLoopMiddleware: input => input,
    createAgent: graphFactory
  };
}

async function waitFor(predicate, message = 'condition') {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

function runtimeOptions(store, graphFactory, executeShell = async () => ({ status: 'succeeded', output: '' })) {
  return {
    config: {
      agent: {
        enabled: true,
        projectRoot: process.cwd(),
        maxEventsPerRun: 100,
        commandTimeoutMs: 1000,
        maxOutputBytes: 1000
      }
    },
    store,
    checkpointer: {},
    dependencies: fakeDependencies(graphFactory),
    createModel: async selection => selection,
    executeShell,
    logger: { error() {} }
  };
}

test('initialize recovers running orphans while preserving awaiting approvals', async () => {
  const store = new MemoryStore([
    { id: 'orphan', status: 'running' },
    { id: 'paused', status: 'awaiting_approval' }
  ]);
  const runtime = createAgentRuntime(runtimeOptions(store, () => ({ async *stream() {} })));
  await runtime.initialize();

  assert.equal(store.recovered, true);
  assert.equal(store.getRun('orphan').status, 'failed');
  assert.equal(store.getRun('paused').status, 'awaiting_approval');
  await runtime.close();
});

test('initialize creates checkpoint tables before pruning runs without checkpoints', async () => {
  const Database = require('better-sqlite3');
  const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
  const { AgentStore } = require('../../lib/agent/store');
  const db = new Database(':memory:');
  const store = new AgentStore({ db, dbPath: ':memory:', recoverOrphans: false });
  store.createRun({
    id: 'old-without-checkpoint',
    request: 'old',
    provider: 'openai',
    model: 'fake',
    shell: 'test-shell',
    cwd: process.cwd()
  });
  store.completeRun('old-without-checkpoint');
  store.createRun({
    id: 'new-without-checkpoint',
    request: 'new',
    provider: 'openai',
    model: 'fake',
    shell: 'test-shell',
    cwd: process.cwd()
  });
  store.completeRun('new-without-checkpoint');
  const checkpointer = new SqliteSaver(db);
  const runtime = createAgentRuntime({
    ...runtimeOptions(store, () => ({ async *stream() {} })),
    checkpointer,
    config: {
      agent: {
        enabled: true,
        projectRoot: process.cwd(),
        maxRuns: 1,
        maxEventsPerRun: 100,
        retentionDays: 36500
      }
    }
  });

  try {
    await runtime.initialize();
    assert.equal(store.getRun('old-without-checkpoint'), null);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get());
  } finally {
    await runtime.close();
    db.close();
  }
});

test('one active run is enforced and start returns before its worker finishes', async t => {
  let release;
  let agentOptions;
  const blocked = new Promise(resolve => { release = resolve; });
  const store = new MemoryStore();
  const runtime = createAgentRuntime(runtimeOptions(store, options => {
    agentOptions = options;
    return ({
    async *stream() { await blocked; }
    });
  }));
  await runtime.initialize();
  t.after(async () => { release(); await runtime.close(); });

  const started = await runtime.startRun({
    request: 'work', provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true
  });
  assert.equal(started.status, 'running');
  await waitFor(() => agentOptions, 'Agent construction');
  assert.equal(agentOptions.systemPrompt, SYSTEM_PROMPT);
  assert.equal(Object.hasOwn(agentOptions, 'prompt'), false);
  await assert.rejects(
    runtime.startRun({ request: 'other', provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true }),
    error => error instanceof AgentRuntimeError && error.code === 'ACTIVE_RUN_EXISTS'
  );
});

test('records when a completed run produced no visible Agent output', async t => {
  const store = new MemoryStore();
  const runtime = createAgentRuntime(runtimeOptions(store, () => ({
    async *stream() {}
  })));
  await runtime.initialize();
  t.after(() => runtime.close());

  const run = await runtime.startRun({
    request: 'return nothing',
    provider: 'openai',
    model: 'gpt-5.6-sol',
    supportsToolCalling: true
  });

  await waitFor(() => store.getRun(run.id).status === 'completed', 'empty run completion');
  const completion = store.events.find(event => event.type === 'run_completed');

  assert.deepEqual(completion?.payload, { hasAgentOutput: false });
  assert.equal(store.events.some(event => event.type === 'agent_message'), false);
});

test('grouped approvals resume all actions, skip rejects, and serialize approved shells', async t => {
  const proposedActions = [
    { name: 'execute_shell', args: { command: 'first' }, id: 'tool-1' },
    { name: 'execute_shell', args: { command: 'second' }, id: 'tool-2' },
    { name: 'execute_shell', args: { command: 'third' }, id: 'tool-3' }
  ];
  const shellCommands = [];
  let activeShells = 0;
  let maximumActiveShells = 0;
  const executeShell = async options => {
    shellCommands.push(options.command);
    activeShells += 1;
    maximumActiveShells = Math.max(maximumActiveShells, activeShells);
    options.onEvent({ type: 'stdout', data: `${options.command}\n` });
    await new Promise(resolve => setTimeout(resolve, 15));
    activeShells -= 1;
    return { status: 'succeeded', ok: true, output: options.command, exitCode: 0 };
  };
  const store = new MemoryStore();
  const runtime = createAgentRuntime(runtimeOptions(store, ({ tools }) => ({
    async *stream(input) {
      if (!input.resume) {
        yield ['messages', [{ role: 'assistant', content: '', tool_calls: proposedActions }, {}]];
        yield ['updates', {
          middleware: {
            __interrupt__: [{
              value: {
                actionRequests: proposedActions.map(action => ({ name: action.name, args: action.args })),
                reviewConfigs: proposedActions.map(() => ({ allowedDecisions: ['approve', 'edit', 'reject'] }))
              }
            }]
          }
        }];
        return;
      }
      const calls = input.resume.decisions.map((decision, index) => {
        if (decision.type === 'reject') return Promise.resolve();
        const action = decision.type === 'edit' ? decision.editedAction : proposedActions[index];
        return tools[0].invoke(action.args, { toolCallId: proposedActions[index].id });
      });
      await Promise.all(calls);
      yield ['messages', [{ role: 'assistant', content: 'Finished.' }, {}]];
    }
  }), executeShell));
  await runtime.initialize();
  t.after(() => runtime.close());

  const run = await runtime.startRun({
    request: 'do three things', provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true
  });
  const paused = await waitFor(() => {
    const value = store.getRun(run.id);
    return value.status === 'awaiting_approval' && value;
  }, 'approval interrupt');
  const detail = await runtime.getRun(run.id);
  assert.equal(detail.approval.actions.length, 3);
  assert.equal(detail.approval.actions[0].toolCallId, 'tool-1');
  assert.deepEqual(shellCommands, []);

  await runtime.approve(run.id, {
    approvalId: paused.activeApprovalId,
    decisions: [
      { type: 'approve' },
      {
        type: 'edit',
        editedAction: { name: 'execute_shell', args: { command: 'second-edited', cwd: process.cwd() } }
      },
      { type: 'reject', feedback: 'Skip it.' }
    ]
  });
  await waitFor(() => store.getRun(run.id).status === 'completed', 'run completion');

  assert.deepEqual(shellCommands, ['first', 'second-edited']);
  assert.equal(maximumActiveShells, 1);
  assert.equal(store.events.some(event => event.type === 'agent_message' && event.payload.text === 'Finished.'), true);
  assert.equal(store.events.some(event => event.type === 'command_output'), true);
});

test('actual LangGraph HITL resumes mixed decisions without dropping approved commands', async () => {
  const Database = require('better-sqlite3');
  const { SqliteSaver } = require('@langchain/langgraph-checkpoint-sqlite');
  const { FakeToolCallingModel } = require('langchain');
  const { AgentStore } = require('../../lib/agent/store');
  const db = new Database(':memory:');
  const store = new AgentStore({ db, dbPath: ':memory:', recoverOrphans: false });
  const checkpointer = new SqliteSaver(db);
  const commands = [];
  const model = new FakeToolCallingModel({
    toolCalls: [
      [
        { name: 'execute_shell', args: { command: 'smoke-one' }, id: 'actual-tool-1' },
        { name: 'execute_shell', args: { command: 'smoke-two' }, id: 'actual-tool-2' },
        { name: 'execute_shell', args: { command: 'smoke-three' }, id: 'actual-tool-3' }
      ],
      []
    ]
  });
  const runtime = createAgentRuntime({
    config: {
      agent: { enabled: true, projectRoot: process.cwd(), maxEventsPerRun: 100 }
    },
    store,
    checkpointer,
    createModel: async () => model,
    executeShell: async options => {
      commands.push(options.command);
      options.onEvent({ type: 'stdout', data: 'smoke-output' });
      return { status: 'succeeded', ok: true, exitCode: 0, output: 'smoke-ok' };
    }
  });

  try {
    await runtime.initialize();
    const run = await runtime.startRun({
      request: 'Run the smoke command',
      provider: 'openai',
      model: 'fake-tool-model',
      supportsToolCalling: true
    });
    const paused = await waitFor(async () => {
      const detail = await runtime.getRun(run.id);
      return detail.status === 'awaiting_approval' && detail;
    }, 'actual LangGraph interrupt');
    assert.deepEqual(commands, []);
    assert.deepEqual(paused.approval.actions.map(action => action.toolCallId), [
      'actual-tool-1',
      'actual-tool-2',
      'actual-tool-3'
    ]);

    await runtime.approve(run.id, {
      approvalId: paused.approval.approvalId,
      decisions: [
        { type: 'approve' },
        {
          type: 'edit',
          editedAction: { name: 'execute_shell', args: { command: 'smoke-two-edited' } }
        },
        { type: 'reject', feedback: 'Do not run the third command.' }
      ]
    });
    await waitFor(() => store.getRun(run.id).status === 'completed', 'actual LangGraph completion');
    assert.deepEqual(commands, ['smoke-one', 'smoke-two-edited']);
    assert.equal(store.getEvents(run.id).some(event => (
      event.type === 'command_output' && event.payload.data === 'smoke-output'
    )), true);
  } finally {
    await runtime.close();
    if (db.open) db.close();
  }
});

test('reopens SQLite and resumes a pending LangGraph approval after restart', async () => {
  const { FakeToolCallingModel } = require('langchain');
  const { AgentStore } = require('../../lib/agent/store');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-restart-'));
  const dbPath = path.join(directory, 'agent.sqlite');
  const firstStore = new AgentStore({ dbPath, recoverOrphans: false });
  const firstRuntime = createAgentRuntime({
    config: { agent: { enabled: true, projectRoot: process.cwd(), maxEventsPerRun: 100 } },
    store: firstStore,
    createModel: async () => new FakeToolCallingModel({
      toolCalls: [[{ name: 'execute_shell', args: { command: 'after-restart' }, id: 'restart-tool' }]]
    }),
    executeShell: async () => {
      throw new Error('The first process must not execute a pending command');
    }
  });

  let runId;
  let approvalId;
  try {
    await firstRuntime.initialize();
    const run = await firstRuntime.startRun({
      request: 'pause then restart', provider: 'openai', model: 'fake', supportsToolCalling: true
    });
    runId = run.id;
    const paused = await waitFor(async () => {
      const detail = await firstRuntime.getRun(run.id);
      return detail.status === 'awaiting_approval' && detail;
    }, 'persisted approval');
    approvalId = paused.approval.approvalId;
    await firstRuntime.close();
    assert.equal(firstStore.getDatabase().open, false);

    const commands = [];
    const secondStore = new AgentStore({ dbPath, recoverOrphans: true });
    const secondRuntime = createAgentRuntime({
      config: { agent: { enabled: true, projectRoot: process.cwd(), maxEventsPerRun: 100 } },
      store: secondStore,
      createModel: async () => new FakeToolCallingModel({ toolCalls: [[]] }),
      executeShell: async options => {
        commands.push(options.command);
        return { status: 'succeeded', ok: true, exitCode: 0, output: 'resumed' };
      }
    });
    try {
      await secondRuntime.initialize();
      const reloaded = await secondRuntime.getRun(runId);
      assert.equal(reloaded.status, 'awaiting_approval');
      assert.equal(reloaded.approval.approvalId, approvalId);
      await secondRuntime.approve(runId, {
        approvalId,
        decisions: [{ type: 'approve' }]
      });
      await waitFor(() => secondStore.getRun(runId).status === 'completed', 'restart completion');
      assert.deepEqual(commands, ['after-restart']);
    } finally {
      await secondRuntime.close();
    }
  } finally {
    if (!firstRuntime.closing) await firstRuntime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('stale approvals are rejected and Stop is idempotent', async t => {
  const store = new MemoryStore();
  const runtime = createAgentRuntime(runtimeOptions(store, () => ({
    async *stream() {
      yield ['updates', {
        __interrupt__: [{
          value: {
            actionRequests: [{ name: 'execute_shell', args: { command: 'never' }, id: 'tool-1' }],
            reviewConfigs: [{ allowedDecisions: ['approve', 'edit', 'reject'] }]
          }
        }]
      }];
    }
  })));
  await runtime.initialize();
  t.after(() => runtime.close());

  const run = await runtime.startRun({
    request: 'pause', provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true
  });
  const paused = await waitFor(() => {
    const value = store.getRun(run.id);
    return value.status === 'awaiting_approval' && value;
  }, 'paused run');

  await assert.rejects(
    runtime.approve(run.id, { approvalId: 'wrong', decisions: [{ type: 'approve' }] }),
    error => error.code === 'STALE_APPROVAL'
  );
  const first = await runtime.stop(run.id);
  const second = await runtime.stop(run.id);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(store.events.filter(event => event.type === 'run_cancelled').length, 1);
  await assert.rejects(
    runtime.approve(run.id, { approvalId: paused.activeApprovalId, decisions: [{ type: 'approve' }] }),
    error => error.code === 'STALE_APPROVAL'
  );
});

test('fails clearly when a model proposes more actions than can be approved', async t => {
  const store = new MemoryStore();
  const runtime = createAgentRuntime({
    ...runtimeOptions(store, () => ({
      async *stream() {
        yield ['updates', {
          __interrupt__: [{
            value: {
              actionRequests: ['one', 'two', 'three'].map(command => ({
                name: 'execute_shell',
                args: { command }
              })),
              reviewConfigs: ['one', 'two', 'three'].map(() => ({
                allowedDecisions: ['approve', 'edit', 'reject']
              }))
            }
          }]
        }];
      }
    })),
    config: {
      agent: {
        enabled: true,
        projectRoot: process.cwd(),
        maxActionsPerApproval: 2,
        maxEventsPerRun: 100
      }
    }
  });
  await runtime.initialize();
  t.after(() => runtime.close());

  const run = await runtime.startRun({
    request: 'too many', provider: 'openai', model: 'fake', supportsToolCalling: true
  });
  await waitFor(() => store.getRun(run.id).status === 'failed', 'too-many-actions failure');
  assert.equal(store.getRun(run.id).activeApprovalId, null);
  assert.match(store.getRun(run.id).error, /maximum is 2/);
});

test('Stop aborts an executing shell and cancellation remains terminal', async t => {
  let executionStarted;
  const started = new Promise(resolve => { executionStarted = resolve; });
  let observedAbort = false;
  const executeShell = options => new Promise(resolve => {
    executionStarted();
    options.signal.addEventListener('abort', () => {
      observedAbort = true;
      resolve({ status: 'cancelled', cancelled: true, output: '' });
    }, { once: true });
  });
  const store = new MemoryStore();
  const runtime = createAgentRuntime(runtimeOptions(store, ({ tools }) => ({
    async *stream() {
      await tools[0].invoke({ command: 'long-running' }, { toolCallId: 'tool-long' });
    }
  }), executeShell));
  await runtime.initialize();
  t.after(() => runtime.close());

  const run = await runtime.startRun({
    request: 'run until stopped', provider: 'openai', model: 'gpt-5.6-sol', supportsToolCalling: true
  });
  await started;
  const result = await runtime.stop(run.id);
  await waitFor(() => observedAbort, 'AbortSignal');

  assert.equal(result.run.status, 'cancelled');
  assert.equal(store.getRun(run.id).status, 'cancelled');
  const types = store.events.map(event => event.type);
  assert.ok(types.indexOf('command_completed') < types.indexOf('run_cancelled'));
  assert.equal(types.at(-1), 'run_cancelled');
});
