'use strict';

const crypto = require('crypto');
const path = require('path');

const RUN_STATUSES = Object.freeze([
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled'
]);
const ACTIVE_STATUSES = new Set(['running', 'awaiting_approval']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DECISIONS = new Set(['approve', 'edit', 'reject']);
const APPROVAL_MODES = new Set(['manual', 'yolo']);
const DEFAULT_APPROVAL_MODE = 'manual';
const CURRENT_SCHEMA_VERSION = 2;
const PROCESS_OWNER_ID = `${process.pid}:${crypto.randomUUID()}`;
const ORPHANED_RUN_ERROR =
  'The server restarted while this Agent run was executing. The interrupted process cannot be resumed; start a new run.';

class AgentStoreError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AgentStoreError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentStoreError('INVALID_ARGUMENT', `${name} must be a non-empty string`);
  }
  return value;
}

function serializeJson(value, name = 'value') {
  try {
    const json = JSON.stringify(value === undefined ? null : value);
    if (json === undefined) {
      throw new TypeError('value is not JSON serializable');
    }
    return json;
  } catch (error) {
    throw new AgentStoreError('INVALID_JSON', `${name} must be JSON serializable`, {
      cause: error.message
    });
  }
}

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    request: row.request,
    provider: row.provider,
    model: row.model,
    shell: row.shell,
    cwd: row.cwd,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    approvalMode: row.approval_mode || DEFAULT_APPROVAL_MODE,
    activeApprovalId: row.active_approval_id,
    ownerId: row.owner_id
  };
}

function mapApproval(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    actionName: row.action_name,
    shell: row.shell,
    cwd: row.cwd,
    allowedDecisions: parseJson(row.allowed_decisions_json),
    originalArgs: parseJson(row.original_args_json),
    editedArgs: parseJson(row.edited_args_json),
    decision: row.decision,
    feedback: row.feedback,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  };
}

function mapEvent(row) {
  return {
    id: row.event_id,
    runId: row.run_id,
    type: row.type,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at
  };
}

class AgentStore {
  constructor(options = {}) {
    const {
      db,
      dbPath,
      Database,
      ownerId = PROCESS_OWNER_ID,
      now = () => new Date().toISOString(),
      sanitizePayload = value => value,
      checkpointer = null,
      recoverOrphans = true,
      busyTimeoutMs = 5000,
      maxEventsPerRun = null
    } = options;

    if (!db && !dbPath) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'db or dbPath is required');
    }

    let DatabaseConstructor = Database;
    if (!db && !DatabaseConstructor) {
      try {
        DatabaseConstructor = require('better-sqlite3');
      } catch (error) {
        throw new AgentStoreError(
          'SQLITE_DEPENDENCY_MISSING',
          'better-sqlite3 is required when AgentStore creates the database',
          { cause: error.message }
        );
      }
    }

    const connectionPath = dbPath === ':memory:' || dbPath?.startsWith('file:')
      ? dbPath
      : path.resolve(dbPath);
    this.db = db || new DatabaseConstructor(connectionPath);
    this.rawDb = this.db;
    this.ownsDatabase = !db;
    this.ownerId = requireNonEmptyString(ownerId, 'ownerId');
    this.now = now;
    this.sanitizePayload = sanitizePayload;
    this.checkpointer = checkpointer;
    if (maxEventsPerRun !== null && (!Number.isSafeInteger(maxEventsPerRun) || maxEventsPerRun < 1)) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'maxEventsPerRun must be a positive integer or null');
    }
    this.maxEventsPerRun = maxEventsPerRun;

    this.db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.#migrate();
    this.#prepareStatements();
    this.recoveredOrphanCount = recoverOrphans ? this.recoverOrphanedRuns() : 0;
  }

  #migrate() {
    const version = this.db.pragma('user_version', { simple: true });
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new AgentStoreError(
        'UNSUPPORTED_SCHEMA',
        `Agent database schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`
      );
    }

    const migrate = this.db.transaction(() => {
      if (version === 0) {
        this.db.exec(`
          CREATE TABLE agent_runs (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL UNIQUE,
            request TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            shell TEXT NOT NULL,
            cwd TEXT NOT NULL,
            approval_mode TEXT NOT NULL DEFAULT 'manual' CHECK (
              approval_mode IN ('manual', 'yolo')
            ),
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
          CREATE INDEX agent_events_replay
            ON agent_events (run_id, event_id);

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
          CREATE INDEX agent_approvals_run
            ON agent_approvals (run_id, created_at DESC);

          PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};
        `);
      } else if (version === 1) {
        this.db.exec(`
          ALTER TABLE agent_runs
            ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'manual'
            CHECK (approval_mode IN ('manual', 'yolo'));
          PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};
        `);
      }
    });
    if (version < CURRENT_SCHEMA_VERSION) migrate.immediate();
  }

  #prepareStatements() {
    this.statements = {
      insertRun: this.db.prepare(`
        INSERT INTO agent_runs (
          id, thread_id, request, provider, model, shell, cwd, approval_mode, status,
          created_at, updated_at, started_at, owner_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
      `),
      getRun: this.db.prepare('SELECT * FROM agent_runs WHERE id = ?'),
      getActiveRun: this.db.prepare(`
        SELECT * FROM agent_runs
        WHERE status IN ('running', 'awaiting_approval')
        LIMIT 1
      `),
      insertEvent: this.db.prepare(`
        INSERT INTO agent_events (run_id, type, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `),
      getEvents: this.db.prepare(`
        SELECT * FROM agent_events
        WHERE run_id = ? AND event_id > ?
        ORDER BY event_id ASC
        LIMIT ?
      `),
      getApproval: this.db.prepare('SELECT * FROM agent_approvals WHERE id = ?'),
      insertApproval: this.db.prepare(`
        INSERT INTO agent_approvals (
          id, run_id, tool_call_id, action_name, shell, cwd,
          allowed_decisions_json, original_args_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      markAwaitingApproval: this.db.prepare(`
        UPDATE agent_runs
        SET status = 'awaiting_approval', active_approval_id = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `),
      decideApproval: this.db.prepare(`
        UPDATE agent_approvals
        SET decision = ?, edited_args_json = ?, feedback = ?, decided_at = ?
        WHERE id = ? AND decision IS NULL
      `),
      resumeRun: this.db.prepare(`
        UPDATE agent_runs
        SET status = 'running', active_approval_id = NULL, owner_id = ?, updated_at = ?
        WHERE id = ? AND status = 'awaiting_approval' AND active_approval_id = ?
      `)
    };
  }

  getDatabase() {
    return this.db;
  }

  setCheckpointer(checkpointer) {
    this.checkpointer = checkpointer;
  }

  close({ force = false } = {}) {
    if ((this.ownsDatabase || force) && this.db.open) {
      this.db.close();
      return true;
    }
    return false;
  }

  createRun(input = {}) {
    const id = input.id || crypto.randomUUID();
    const threadId = input.threadId || id;
    const request = requireNonEmptyString(input.request, 'request');
    const provider = requireNonEmptyString(input.provider, 'provider');
    const model = requireNonEmptyString(input.model, 'model');
    const shell = requireNonEmptyString(
      input.shell || (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'),
      'shell'
    );
    const cwd = requireNonEmptyString(input.cwd || process.cwd(), 'cwd');
    const approvalMode = input.approvalMode || DEFAULT_APPROVAL_MODE;
    if (!APPROVAL_MODES.has(approvalMode)) {
      throw new AgentStoreError('INVALID_ARGUMENT', `Unsupported approval mode: ${approvalMode}`);
    }
    const timestamp = this.now();

    const create = this.db.transaction(() => {
      this.statements.insertRun.run(
        id,
        threadId,
        request,
        provider,
        model,
        shell,
        cwd,
        approvalMode,
        timestamp,
        timestamp,
        timestamp,
        this.ownerId
      );
      return mapRun(this.statements.getRun.get(id));
    });

    try {
      return create.immediate();
    } catch (error) {
      const activeRun = this.getActiveRun();
      if (activeRun && activeRun.id !== id && error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new AgentStoreError(
          'ACTIVE_RUN_EXISTS',
          `Agent run ${activeRun.id} is already active`,
          { runId: activeRun.id, status: activeRun.status }
        );
      }
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new AgentStoreError('RUN_ALREADY_EXISTS', `Agent run ${id} already exists`);
      }
      throw error;
    }
  }

  getRun(runId) {
    return mapRun(this.statements.getRun.get(runId));
  }

  requireRun(runId) {
    const run = this.getRun(runId);
    if (!run) throw new AgentStoreError('RUN_NOT_FOUND', `Agent run ${runId} was not found`);
    return run;
  }

  getActiveRun() {
    return mapRun(this.statements.getActiveRun.get());
  }

  listRuns({ limit = 50, status } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    if (status !== undefined && !RUN_STATUSES.includes(status)) {
      throw new AgentStoreError('INVALID_STATUS', `Unknown Agent run status: ${status}`);
    }
    const rows = status
      ? this.db.prepare(`
          SELECT * FROM agent_runs WHERE status = ?
          ORDER BY created_at DESC, rowid DESC LIMIT ?
        `).all(status, boundedLimit)
      : this.db.prepare(`
          SELECT * FROM agent_runs
          ORDER BY created_at DESC, rowid DESC LIMIT ?
        `).all(boundedLimit);
    return rows.map(mapRun);
  }

  appendEvent(runId, type, payload = {}) {
    requireNonEmptyString(type, 'type');
    this.requireRun(runId);
    const sanitizedPayload = this.sanitizePayload(payload);
    const append = this.db.transaction(() => {
      const result = this.statements.insertEvent.run(
        runId,
        type,
        serializeJson(sanitizedPayload, 'event payload'),
        this.now()
      );
      const row = this.db.prepare('SELECT * FROM agent_events WHERE event_id = ?').get(result.lastInsertRowid);
      if (this.maxEventsPerRun !== null) {
        this.db.prepare(`
          DELETE FROM agent_events
          WHERE run_id = ? AND event_id IN (
            SELECT event_id FROM agent_events
            WHERE run_id = ?
            ORDER BY event_id DESC
            LIMIT -1 OFFSET ?
          )
        `).run(runId, runId, this.maxEventsPerRun);
      }
      return mapEvent(row);
    });
    return append.immediate();
  }

  getEvents(runId, { afterEventId = 0, limit = 1000 } = {}) {
    this.requireRun(runId);
    const after = Number(afterEventId);
    const boundedLimit = Math.max(1, Math.min(10000, Math.trunc(limit)));
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'afterEventId must be a non-negative integer');
    }
    return this.statements.getEvents.all(runId, after, boundedLimit).map(mapEvent);
  }

  getApproval(approvalId) {
    return mapApproval(this.statements.getApproval.get(approvalId));
  }

  getActiveApproval(runId) {
    const run = this.requireRun(runId);
    return run.activeApprovalId ? this.getApproval(run.activeApprovalId) : null;
  }

  markAwaitingApproval(runId, input = {}) {
    const id = requireNonEmptyString(input.id || input.approvalId, 'approvalId');
    const actionName = requireNonEmptyString(input.actionName || 'execute_shell', 'actionName');
    const shell = requireNonEmptyString(input.shell, 'shell');
    const cwd = requireNonEmptyString(input.cwd, 'cwd');
    const originalArgs = input.originalArgs;
    if (!originalArgs || typeof originalArgs !== 'object' || Array.isArray(originalArgs)) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'originalArgs must be an object');
    }
    const allowedDecisions = input.allowedDecisions || Array.from(DECISIONS);
    if (!Array.isArray(allowedDecisions) || allowedDecisions.length === 0 ||
        allowedDecisions.some(decision => !DECISIONS.has(decision))) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'allowedDecisions contains an unsupported decision');
    }
    const timestamp = this.now();

    const mark = this.db.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status !== 'running') {
        throw new AgentStoreError(
          'INVALID_STATUS_TRANSITION',
          `Agent run ${runId} cannot await approval from status ${run.status}`
        );
      }
      this.statements.insertApproval.run(
        id,
        runId,
        input.toolCallId || null,
        actionName,
        shell,
        cwd,
        serializeJson(allowedDecisions, 'allowedDecisions'),
        serializeJson(originalArgs, 'originalArgs'),
        timestamp
      );
      const result = this.statements.markAwaitingApproval.run(id, timestamp, runId);
      if (result.changes !== 1) {
        throw new AgentStoreError('STALE_RUN', `Agent run ${runId} changed before approval was stored`);
      }
      return this.getApproval(id);
    });

    try {
      return mark.immediate();
    } catch (error) {
      if (error instanceof AgentStoreError) throw error;
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new AgentStoreError('APPROVAL_ALREADY_EXISTS', `Approval ${id} already exists`);
      }
      throw error;
    }
  }

  decideApproval(runId, approvalId, input = {}) {
    const decision = input.decision;
    if (!DECISIONS.has(decision)) {
      throw new AgentStoreError('INVALID_DECISION', `Unsupported approval decision: ${decision}`);
    }
    const feedback = input.feedback == null ? null : String(input.feedback);
    const editedArgs = input.editedArgs == null ? null : input.editedArgs;
    if (decision === 'edit' && (!editedArgs || typeof editedArgs !== 'object' || Array.isArray(editedArgs))) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'editedArgs must be an object for an edit decision');
    }
    if (decision !== 'edit' && editedArgs !== null) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'editedArgs is only valid for an edit decision');
    }

    const decide = this.db.transaction(() => {
      const approval = this.getApproval(approvalId);
      if (!approval || approval.runId !== runId) {
        throw new AgentStoreError('STALE_APPROVAL', `Approval ${approvalId} is not active for run ${runId}`);
      }

      if (approval.decision !== null) {
        const sameDecision = approval.decision === decision &&
          approval.feedback === feedback &&
          canonicalJson(approval.editedArgs) === canonicalJson(editedArgs);
        if (!sameDecision) {
          throw new AgentStoreError(
            'APPROVAL_ALREADY_DECIDED',
            `Approval ${approvalId} already has a different decision`
          );
        }
        return { approval, run: this.requireRun(runId), duplicate: true };
      }

      const run = this.requireRun(runId);
      if (run.status !== 'awaiting_approval' || run.activeApprovalId !== approvalId) {
        throw new AgentStoreError('STALE_APPROVAL', `Approval ${approvalId} is no longer active`);
      }
      if (!approval.allowedDecisions.includes(decision)) {
        throw new AgentStoreError(
          'DECISION_NOT_ALLOWED',
          `Decision ${decision} is not allowed for approval ${approvalId}`
        );
      }

      const timestamp = this.now();
      const approvalResult = this.statements.decideApproval.run(
        decision,
        editedArgs === null ? null : serializeJson(editedArgs, 'editedArgs'),
        feedback,
        timestamp,
        approvalId
      );
      const runResult = this.statements.resumeRun.run(this.ownerId, timestamp, runId, approvalId);
      if (approvalResult.changes !== 1 || runResult.changes !== 1) {
        throw new AgentStoreError('STALE_APPROVAL', `Approval ${approvalId} changed before it was decided`);
      }
      return {
        approval: this.getApproval(approvalId),
        run: this.requireRun(runId),
        duplicate: false
      };
    });
    return decide.immediate();
  }

  transitionRun(runId, status, { error = null, expectedStatus } = {}) {
    if (!TERMINAL_STATUSES.has(status)) {
      throw new AgentStoreError(
        'INVALID_STATUS_TRANSITION',
        `transitionRun only accepts terminal statuses, received ${status}`
      );
    }
    if (expectedStatus !== undefined && !ACTIVE_STATUSES.has(expectedStatus)) {
      throw new AgentStoreError('INVALID_STATUS', `Invalid expected status: ${expectedStatus}`);
    }

    const transition = this.db.transaction(() => {
      const run = this.requireRun(runId);
      if (run.status === status) return { run, changed: false };
      if (TERMINAL_STATUSES.has(run.status)) {
        throw new AgentStoreError(
          'INVALID_STATUS_TRANSITION',
          `Agent run ${runId} is already ${run.status}`
        );
      }
      if (expectedStatus !== undefined && run.status !== expectedStatus) {
        throw new AgentStoreError(
          'STALE_RUN',
          `Expected Agent run ${runId} to be ${expectedStatus}, found ${run.status}`
        );
      }
      const timestamp = this.now();
      this.db.prepare(`
        UPDATE agent_runs
        SET status = ?, updated_at = ?, completed_at = ?, error = ?,
            active_approval_id = NULL, owner_id = NULL
        WHERE id = ?
      `).run(status, timestamp, timestamp, error, runId);
      return { run: this.requireRun(runId), changed: true };
    });
    return transition.immediate();
  }

  completeRun(runId) {
    return this.transitionRun(runId, 'completed');
  }

  failRun(runId, error) {
    return this.transitionRun(runId, 'failed', {
      error: error instanceof Error ? error.message : String(error || 'Agent run failed')
    });
  }

  cancelRun(runId) {
    return this.transitionRun(runId, 'cancelled');
  }

  recoverOrphanedRuns() {
    const recover = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT id FROM agent_runs
        WHERE status = 'running' AND (owner_id IS NULL OR owner_id <> ?)
      `).all(this.ownerId);
      const timestamp = this.now();
      const update = this.db.prepare(`
        UPDATE agent_runs
        SET status = 'failed', updated_at = ?, completed_at = ?, error = ?,
            active_approval_id = NULL, owner_id = NULL
        WHERE id = ? AND status = 'running'
      `);
      for (const row of rows) {
        const result = update.run(timestamp, timestamp, ORPHANED_RUN_ERROR, row.id);
        if (result.changes === 1) {
          this.statements.insertEvent.run(
            row.id,
            'run_failed',
            serializeJson({ error: ORPHANED_RUN_ERROR, recoverable: true }),
            timestamp
          );
        }
      }
      return rows.length;
    });
    return recover.immediate();
  }

  async #deleteCheckpointThread(threadId, override) {
    const checkpointer = override || this.checkpointer;
    const deleteThread = typeof checkpointer === 'function'
      ? checkpointer
      : checkpointer?.deleteThread?.bind(checkpointer);
    if (!deleteThread) {
      throw new AgentStoreError(
        'CHECKPOINT_CLEANUP_REQUIRED',
        'Deleting an Agent run requires a checkpointer with deleteThread(threadId)'
      );
    }
    await deleteThread(threadId);
  }

  async deleteRun(runId, { checkpointer } = {}) {
    const run = this.requireRun(runId);
    if (ACTIVE_STATUSES.has(run.status)) {
      throw new AgentStoreError('ACTIVE_RUN_PROTECTED', `Active Agent run ${runId} cannot be deleted`);
    }
    await this.#deleteCheckpointThread(run.threadId, checkpointer);
    const result = this.db.prepare(`
      DELETE FROM agent_runs
      WHERE id = ? AND status NOT IN ('running', 'awaiting_approval')
    `).run(runId);
    if (result.changes !== 1) {
      throw new AgentStoreError('ACTIVE_RUN_PROTECTED', `Agent run ${runId} became active`);
    }
    return true;
  }

  async cleanupRetention({ maxRuns = 100, maxEventsPerRun = 1000, maxAgeDays = null, checkpointer } = {}) {
    if (!Number.isSafeInteger(maxRuns) || maxRuns < 0) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'maxRuns must be a non-negative integer');
    }
    if (!Number.isSafeInteger(maxEventsPerRun) || maxEventsPerRun < 0) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'maxEventsPerRun must be a non-negative integer');
    }
    if (maxAgeDays !== null && (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 1)) {
      throw new AgentStoreError('INVALID_ARGUMENT', 'maxAgeDays must be a positive integer or null');
    }

    const terminalRuns = this.db.prepare(`
      SELECT id, thread_id, COALESCE(completed_at, updated_at) AS retained_at
      FROM agent_runs
      WHERE status NOT IN ('running', 'awaiting_approval')
      ORDER BY COALESCE(completed_at, updated_at) DESC, created_at DESC, rowid DESC
    `).all();
    const cutoff = maxAgeDays === null
      ? null
      : Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const expired = terminalRuns.filter((run, index) => {
      if (index >= maxRuns) return true;
      if (cutoff === null) return false;
      const retainedAt = Date.parse(run.retained_at);
      return Number.isFinite(retainedAt) && retainedAt < cutoff;
    });

    for (const run of expired) {
      await this.#deleteCheckpointThread(run.thread_id, checkpointer);
    }

    const cleanup = this.db.transaction(() => {
      let runsDeleted = 0;
      for (const run of expired) {
        runsDeleted += this.db.prepare(`
          DELETE FROM agent_runs
          WHERE id = ? AND status NOT IN ('running', 'awaiting_approval')
        `).run(run.id).changes;
      }
      const eventsDeleted = this.db.prepare(`
        DELETE FROM agent_events
        WHERE event_id IN (
          SELECT event_id FROM (
            SELECT e.event_id,
                   ROW_NUMBER() OVER (PARTITION BY e.run_id ORDER BY e.event_id DESC) AS event_rank
            FROM agent_events e
            JOIN agent_runs r ON r.id = e.run_id
            WHERE r.status NOT IN ('running', 'awaiting_approval')
          ) ranked_events
          WHERE event_rank > ?
        )
      `).run(maxEventsPerRun).changes;
      return { runsDeleted, eventsDeleted };
    });
    const result = cleanup.immediate();
    return {
      ...result,
      runIds: expired.map(run => run.id)
    };
  }
}

module.exports = {
  ACTIVE_STATUSES,
  AgentStore,
  AgentStoreError,
  ORPHANED_RUN_ERROR,
  RUN_STATUSES,
  TERMINAL_STATUSES
};
