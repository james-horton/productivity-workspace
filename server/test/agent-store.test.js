'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AgentStore, AgentStoreError, ORPHANED_RUN_ERROR } = require('../lib/agent/store');

let Database;
try {
  Database = require('better-sqlite3');
} catch {}

const sqliteTest = Database ? test : test.skip;

function createHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-'));
  const dbPath = path.join(directory, 'agent.sqlite');
  const stores = [];
  t.after(() => {
    for (const store of stores.reverse()) store.close({ force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    dbPath,
    open(storeOptions = {}) {
      const store = new AgentStore({
        dbPath,
        Database,
        ownerId: storeOptions.ownerId || `owner-${stores.length + 1}`,
        ...options,
        ...storeOptions
      });
      stores.push(store);
      return store;
    }
  };
}

function runInput(id) {
  return {
    id,
    request: `request ${id}`,
    provider: 'openai',
    model: 'tool-model',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    cwd: process.cwd()
  };
}

sqliteTest('migrates a WAL database and enforces one active run across connections', t => {
  const harness = createHarness(t);
  const first = harness.open();
  const second = harness.open({ ownerId: 'owner-1' });

  assert.equal(first.getDatabase(), first.rawDb);
  assert.equal(first.getDatabase().pragma('user_version', { simple: true }), 2);
  assert.equal(first.getDatabase().pragma('journal_mode', { simple: true }), 'wal');

  first.createRun(runInput('run-1'));
  assert.throws(
    () => second.createRun(runInput('run-2')),
    error => error instanceof AgentStoreError &&
      error.code === 'ACTIVE_RUN_EXISTS' &&
      error.details.runId === 'run-1'
  );

  first.completeRun('run-1');
  assert.equal(second.createRun(runInput('run-2')).status, 'running');
});

sqliteTest('upgrades legacy run records to manual approval mode', t => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL UNIQUE,
      request TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      shell TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('running', 'awaiting_approval', 'completed', 'failed', 'cancelled')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      active_approval_id TEXT,
      owner_id TEXT
    );
    CREATE UNIQUE INDEX one_active_agent_run
      ON agent_runs ((1))
      WHERE status IN ('running', 'awaiting_approval');
    CREATE INDEX agent_runs_history
      ON agent_runs (updated_at DESC, created_at DESC);
    CREATE TABLE agent_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX agent_events_replay ON agent_events (run_id, event_id);
    CREATE TABLE agent_approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      tool_call_id TEXT,
      action_name TEXT NOT NULL,
      shell TEXT NOT NULL,
      cwd TEXT NOT NULL,
      allowed_decisions_json TEXT NOT NULL,
      original_args_json TEXT NOT NULL,
      edited_args_json TEXT,
      decision TEXT CHECK (decision IS NULL OR decision IN ('approve', 'edit', 'reject')),
      feedback TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX agent_approvals_run ON agent_approvals (run_id, created_at DESC);
    PRAGMA user_version = 1;
  `);
  const store = new AgentStore({ db, dbPath: ':memory:', recoverOrphans: false });
  t.after(() => store.close({ force: true }));

  assert.equal(db.pragma('user_version', { simple: true }), 2);
  store.createRun(runInput('legacy-run'));
  assert.equal(store.getRun('legacy-run').approvalMode, 'manual');
});

sqliteTest('persists the approval mode with each run', t => {
  const harness = createHarness(t);
  const store = harness.open();
  store.createRun({ ...runInput('yolo-run'), approvalMode: 'yolo' });

  assert.equal(store.getRun('yolo-run').approvalMode, 'yolo');
  assert.equal(store.listRuns({ limit: 1 })[0].approvalMode, 'yolo');
});

sqliteTest('replays sanitized events in monotonic order after an event ID', t => {
  const harness = createHarness(t, {
    sanitizePayload(payload) {
      return { ...payload, secret: payload.secret ? '[redacted]' : undefined };
    }
  });
  const store = harness.open();
  store.createRun(runInput('events'));

  const first = store.appendEvent('events', 'message', { text: 'one', secret: 'key' });
  const second = store.appendEvent('events', 'message', { text: 'two' });
  const third = store.appendEvent('events', 'output', { text: 'three' });

  assert.ok(first.id < second.id && second.id < third.id);
  assert.deepEqual(store.getEvents('events', { afterEventId: first.id }), [second, third]);
  assert.equal(first.payload.secret, '[redacted]');
});

sqliteTest('bounds event history while a run remains active', t => {
  const harness = createHarness(t, { maxEventsPerRun: 2 });
  const store = harness.open();
  store.createRun(runInput('bounded-events'));
  store.appendEvent('bounded-events', 'message', { text: 'one' });
  const second = store.appendEvent('bounded-events', 'message', { text: 'two' });
  const third = store.appendEvent('bounded-events', 'message', { text: 'three' });

  assert.deepEqual(store.getEvents('bounded-events').map(event => event.id), [second.id, third.id]);
  assert.equal(store.getRun('bounded-events').status, 'running');
});

sqliteTest('persists approvals with idempotent decisions and rejects stale decisions', t => {
  const harness = createHarness(t);
  const store = harness.open();
  store.createRun(runInput('approval-run'));
  const approval = store.markAwaitingApproval('approval-run', {
    approvalId: 'approval-1',
    toolCallId: 'call-1',
    shell: 'test-shell',
    cwd: process.cwd(),
    originalArgs: { command: 'before' },
    allowedDecisions: ['edit', 'reject']
  });

  assert.equal(store.getRun('approval-run').status, 'awaiting_approval');
  assert.deepEqual(approval.originalArgs, { command: 'before' });
  const decision = store.decideApproval('approval-run', 'approval-1', {
    decision: 'edit',
    editedArgs: { cwd: process.cwd(), command: 'after' },
    feedback: 'Use the safer command'
  });
  assert.equal(decision.duplicate, false);
  assert.equal(decision.run.status, 'running');
  assert.equal(decision.run.activeApprovalId, null);

  const retry = store.decideApproval('approval-run', 'approval-1', {
    decision: 'edit',
    editedArgs: { command: 'after', cwd: process.cwd() },
    feedback: 'Use the safer command'
  });
  assert.equal(retry.duplicate, true);

  assert.throws(
    () => store.decideApproval('approval-run', 'approval-1', { decision: 'reject' }),
    error => error.code === 'APPROVAL_ALREADY_DECIDED'
  );
  assert.throws(
    () => store.decideApproval('another-run', 'approval-1', { decision: 'reject' }),
    error => error.code === 'STALE_APPROVAL'
  );

  store.markAwaitingApproval('approval-run', {
    approvalId: 'approval-2',
    shell: 'test-shell',
    cwd: process.cwd(),
    originalArgs: { command: 'never-run' }
  });
  store.cancelRun('approval-run');
  assert.throws(
    () => store.decideApproval('approval-run', 'approval-2', { decision: 'approve' }),
    error => error.code === 'STALE_APPROVAL'
  );
});

sqliteTest('allows guarded terminal transitions and makes repeated cancellation idempotent', t => {
  const harness = createHarness(t);
  const store = harness.open();
  store.createRun(runInput('cancelled-run'));

  assert.throws(
    () => store.transitionRun('cancelled-run', 'completed', { expectedStatus: 'awaiting_approval' }),
    error => error.code === 'STALE_RUN'
  );
  assert.equal(store.cancelRun('cancelled-run').changed, true);
  assert.equal(store.cancelRun('cancelled-run').changed, false);
  assert.throws(
    () => store.completeRun('cancelled-run'),
    error => error.code === 'INVALID_STATUS_TRANSITION'
  );
});

sqliteTest('startup recovery fails orphaned running runs but preserves pending approvals', t => {
  const harness = createHarness(t);
  const first = harness.open({ ownerId: 'old-process' });
  first.createRun(runInput('orphan'));
  first.close();

  const recovered = harness.open({ ownerId: 'new-process' });
  assert.equal(recovered.recoveredOrphanCount, 1);
  assert.equal(recovered.getRun('orphan').status, 'failed');
  assert.equal(recovered.getRun('orphan').error, ORPHANED_RUN_ERROR);
  assert.equal(recovered.getEvents('orphan')[0].payload.recoverable, true);

  recovered.createRun(runInput('pending'));
  recovered.markAwaitingApproval('pending', {
    approvalId: 'pending-approval',
    shell: 'test-shell',
    cwd: process.cwd(),
    originalArgs: { command: 'wait' }
  });
  recovered.close();

  const reopened = harness.open({ ownerId: 'third-process' });
  assert.equal(reopened.recoveredOrphanCount, 0);
  assert.equal(reopened.getRun('pending').status, 'awaiting_approval');
  assert.equal(reopened.getActiveApproval('pending').id, 'pending-approval');
});

sqliteTest('retention cleans checkpoint threads and protects active history and events', async t => {
  let tick = 0;
  const harness = createHarness(t, {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
  });
  const deletedThreads = [];
  const store = harness.open({
    checkpointer: {
      async deleteThread(threadId) {
        deletedThreads.push(threadId);
      }
    }
  });

  store.createRun(runInput('old'));
  store.appendEvent('old', 'output', { index: 1 });
  store.appendEvent('old', 'output', { index: 2 });
  store.completeRun('old');
  store.createRun(runInput('kept'));
  store.appendEvent('kept', 'output', { index: 1 });
  store.appendEvent('kept', 'output', { index: 2 });
  store.completeRun('kept');
  store.createRun(runInput('pending'));
  store.appendEvent('pending', 'output', { index: 1 });
  store.appendEvent('pending', 'output', { index: 2 });
  store.markAwaitingApproval('pending', {
    approvalId: 'retention-approval',
    shell: 'test-shell',
    cwd: process.cwd(),
    originalArgs: { command: 'wait' }
  });

  const result = await store.cleanupRetention({ maxRuns: 1, maxEventsPerRun: 1 });
  assert.deepEqual(result.runIds, ['old']);
  assert.deepEqual(deletedThreads, ['old']);
  assert.equal(store.getRun('old'), null);
  assert.equal(store.getRun('kept').status, 'completed');
  assert.equal(store.getEvents('kept').length, 1);
  assert.equal(store.getEvents('pending').length, 2);
  assert.equal(store.getRun('pending').status, 'awaiting_approval');
});

sqliteTest('retention removes terminal runs older than the configured age', async t => {
  const harness = createHarness(t);
  const deletedThreads = [];
  const store = harness.open({
    checkpointer: {
      async deleteThread(threadId) {
        deletedThreads.push(threadId);
      }
    }
  });

  store.createRun(runInput('old-by-age'));
  store.completeRun('old-by-age');
  store.createRun(runInput('recent-by-age'));
  store.completeRun('recent-by-age');
  store.getDatabase().prepare(`
    UPDATE agent_runs SET completed_at = ?, updated_at = ? WHERE id = ?
  `).run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', 'old-by-age');

  const result = await store.cleanupRetention({
    maxRuns: 100,
    maxEventsPerRun: 100,
    maxAgeDays: 30
  });

  assert.deepEqual(result.runIds, ['old-by-age']);
  assert.deepEqual(deletedThreads, ['old-by-age']);
  assert.equal(store.getRun('old-by-age'), null);
  assert.equal(store.getRun('recent-by-age').status, 'completed');
});

test('reports the optional test prerequisite when better-sqlite3 is unavailable', {
  skip: Boolean(Database)
}, () => {
  assert.throws(
    () => new AgentStore({ dbPath: ':memory:' }),
    error => error.code === 'SQLITE_DEPENDENCY_MISSING'
  );
});
