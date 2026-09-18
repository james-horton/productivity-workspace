/**
 * Agent mission-control workspace. All server-provided content is rendered with
 * textContent or text nodes; opaque payloads are never inserted into the DOM.
 */

import {
  getSelectedAgentRunId,
  getState,
  setSelectedAgentRunId
} from '../state.js';
import {
  getModels,
  loadModels,
  modelIdFor,
  providerFor,
  supportsToolCallingFor
} from '../services/modelRegistry.js';
import { applyHighlight, renderAgentMessage } from './chatUI.js';
import { showMessageBox } from './messageBox.js';
import {
  getAgentRun,
  listAgentRuns,
  startAgentRun,
  stopAgentRun,
  streamAgentRun,
  submitAgentApproval
} from '../services/agentService.js';

const ACTIVE_STATUSES = new Set(['queued', 'starting', 'running', 'awaiting_approval', 'stopping']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const HIDDEN_CONTENT_TYPES = new Set(['analysis', 'reasoning', 'thinking', 'summary_text']);

const ui = {
  initialized: false,
  busy: false,
  currentRun: null,
  runs: [],
  events: [],
  eventIds: new Set(),
  approvals: [],
  stream: null,
  selectionToken: 0,
  eventRevision: 0,
  modelCapable: false
};

const byId = id => document.getElementById(id);
const text = value => String(value == null ? '' : value);

function create(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = text(content);
  return node;
}

function runId(run) {
  return text(run?.id || run?.runId || run?.run_id).trim();
}

function runStatus(run) {
  return text(run?.status || 'idle').trim().toLowerCase().replace(/\s+/g, '_');
}

function statusLabel(status) {
  return text(status || 'idle').replace(/_/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
}

function isActive(run) {
  return ACTIVE_STATUSES.has(runStatus(run));
}

function eventPayload(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  return data.payload && typeof data.payload === 'object' ? data.payload : data;
}

function visibleText(value) {
  if (typeof value === 'string' || typeof value === 'number') return text(value);
  if (Array.isArray(value)) return value.map(visibleText).filter(Boolean).join('');
  if (!value || typeof value !== 'object') return '';
  const type = text(value.type).toLowerCase();
  if (HIDDEN_CONTENT_TYPES.has(type) || type.includes('reasoning') || type.includes('thinking')) return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.output_text === 'string') return value.output_text;
  if (value.content != null) return visibleText(value.content);
  return '';
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] != null && source[key] !== '') return source[key];
  }
  return '';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function formatHistoryTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
}

function announce(message, kind = '') {
  const live = byId('agentLive');
  if (!live) return;
  live.textContent = text(message);
  live.dataset.kind = kind;
}

function currentModel() {
  const key = getState().modelKey;
  return getModels().find(model => model.key === key) || null;
}

function refreshCapability() {
  const model = currentModel();
  ui.modelCapable = !!model && supportsToolCallingFor(model.key);
  renderHeader();
  syncControls();
}

function modelSnapshot(run) {
  const snapshot = run?.modelSnapshot || run?.model_snapshot || {};
  const provider = firstValue(snapshot, ['provider']) || firstValue(run, ['provider', 'providerUsed', 'provider_used']);
  const model = firstValue(snapshot, ['model', 'modelId', 'model_id']) || firstValue(run, ['model', 'modelId', 'model_id']);
  return [provider, model].filter(Boolean).join(' / ');
}

function approvalMode(run) {
  return firstValue(run, ['approvalMode', 'approval_mode']).toLowerCase() === 'yolo' ? 'yolo' : 'manual';
}

function renderHeader() {
  const status = byId('agentStatus');
  const snapshot = byId('agentModelSnapshot');
  const mode = byId('agentApprovalMode');
  const request = byId('agentCurrentRequest');
  const currentStatus = ui.currentRun ? runStatus(ui.currentRun) : 'idle';
  if (status) {
    status.textContent = statusLabel(currentStatus);
    status.dataset.status = currentStatus;
  }
  if (snapshot) snapshot.textContent = modelSnapshot(ui.currentRun || currentModel());
  if (mode) {
    const currentMode = ui.currentRun ? approvalMode(ui.currentRun) : 'manual';
    mode.textContent = currentMode === 'yolo' ? 'YOLO mode' : 'Manual approvals';
    mode.dataset.mode = currentMode;
  }
  if (request) request.textContent = ui.currentRun ? text(firstValue(ui.currentRun, ['request', 'prompt', 'mission'])) : '';
}

function historyLabel(run) {
  const request = text(firstValue(run, ['request', 'prompt', 'mission'])).replace(/\s+/g, ' ').trim();
  const shortRequest = request.length > 58 ? `${request.slice(0, 57)}...` : request;
  const date = formatHistoryTime(firstValue(run, ['updatedAt', 'updated_at', 'createdAt', 'created_at']));
  return [statusLabel(runStatus(run)), shortRequest || runId(run), date].filter(Boolean).join(' | ');
}

function renderHistory() {
  const select = byId('agentHistory');
  if (!select) return;
  const selected = runId(ui.currentRun) || getSelectedAgentRunId();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'New run';
  const fragment = document.createDocumentFragment();
  fragment.appendChild(placeholder);
  ui.runs.forEach(run => {
    const id = runId(run);
    if (!id) return;
    const option = document.createElement('option');
    option.value = id;
    option.textContent = historyLabel(run);
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  select.value = ui.runs.some(run => runId(run) === selected) ? selected : '';
}

function syncControls() {
  const selectedActive = isActive(ui.currentRun);
  const anyActive = ui.runs.some(isActive) || selectedActive;
  const start = byId('agentStart');
  const stop = byId('agentStop');
  const newRun = byId('agentNewRun');
  const request = byId('agentRequest');
  const history = byId('agentHistory');
  const yolo = byId('agentYolo');
  const securityNote = byId('agentSecurityNote');
  if (start) start.disabled = ui.busy || anyActive || !ui.modelCapable;
  if (stop) stop.disabled = ui.busy || !selectedActive;
  if (newRun) newRun.disabled = ui.busy;
  if (request) request.disabled = ui.busy;
  if (history) history.disabled = ui.busy;
  if (securityNote) securityNote.hidden = yolo?.checked !== true;
  if (yolo) {
    yolo.disabled = ui.busy || anyActive;
  }
}

function shellDetails(payload) {
  const action = payload?.action && typeof payload.action === 'object' ? payload.action : payload;
  const args = action?.args || action?.arguments || action?.input || {};
  return {
    name: text(action?.name || action?.tool || action?.toolName || 'execute_shell'),
    command: text(firstValue(args, ['command']) || firstValue(action, ['command'])),
    cwd: text(firstValue(args, ['cwd']) || firstValue(action, ['cwd'])),
    shell: text(firstValue(action, ['shell', 'shellName', 'shell_name']) || firstValue(payload, ['shell', 'shellName', 'shell_name'])),
    args: args && typeof args === 'object' ? { ...args } : {}
  };
}

function normalizeApprovalBundle(value, fallbackRun = ui.currentRun) {
  if (!value || typeof value !== 'object') return null;
  const id = text(firstValue(value, ['approvalId', 'approval_id', 'id']) || firstValue(fallbackRun, ['activeApprovalId', 'active_approval_id'])).trim();
  let values = value.actions || value.requests || value.items || value.toolCalls || value.tool_calls;
  if (!Array.isArray(values)) values = [value.action || value.request || value];
  const actions = values.filter(item => item && typeof item === 'object').map(item => ({
    ...shellDetails(item),
    toolCallId: text(firstValue(item, ['toolCallId', 'tool_call_id', 'callId', 'call_id'])),
    allowedDecisions: Array.isArray(item.allowedDecisions || item.allowed_decisions)
      ? (item.allowedDecisions || item.allowed_decisions).map(decision => text(decision).toLowerCase())
      : ['approve', 'edit', 'reject']
  })).filter(action => action.command || action.name === 'execute_shell');
  return actions.length ? { id, actions } : null;
}

function approvalsFromRun(run) {
  const raw = run?.pendingApprovals || run?.pending_approvals || run?.approvals || run?.approval || run?.activeApproval || run?.active_approval;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length && raw.every(item => !Array.isArray(item?.actions) && !Array.isArray(item?.requests))) {
      const bundle = normalizeApprovalBundle({
        approvalId: firstValue(run, ['activeApprovalId', 'active_approval_id']),
        actions: raw
      }, run);
      return bundle ? [bundle] : [];
    }
    return raw.map(item => normalizeApprovalBundle(item, run)).filter(Boolean);
  }
  const bundle = normalizeApprovalBundle(raw, run);
  return bundle ? [bundle] : [];
}

function addLabeledValue(parent, label, value, className = '') {
  const row = create('div', `agent-detail${className ? ` ${className}` : ''}`);
  row.append(create('span', 'agent-detail-label', label), create('code', 'agent-detail-value', value || 'Not provided'));
  parent.appendChild(row);
}

function chooseDecision(card, decision) {
  card.dataset.decision = decision;
  card.querySelectorAll('[data-agent-decision]').forEach(button => {
    button.setAttribute('aria-pressed', button.dataset.agentDecision === decision ? 'true' : 'false');
  });
  const editor = card.querySelector('[data-agent-edit-fields]');
  if (editor) editor.hidden = decision !== 'edit';
  card.closest('form')?.dispatchEvent(new Event('agent-decision-change'));
}

function renderApprovals() {
  const queue = byId('agentApprovals');
  if (!queue) return;
  queue.replaceChildren();
  if (!ui.approvals.length) {
    queue.appendChild(create('p', 'agent-empty', 'No commands are waiting for approval.'));
    return;
  }

  ui.approvals.forEach(bundle => {
    const form = create('form', 'agent-approval-bundle');
    form.dataset.approvalId = bundle.id;
    const heading = create('div', 'agent-approval-heading');
    heading.append(create('strong', '', 'Human approval required'), create('span', 'agent-approval-id', `Approval ${bundle.id || 'ID unavailable'}`));
    form.appendChild(heading);
    form.appendChild(create('p', 'agent-danger-note', 'Review every command. Approval grants it the same permissions as the server process.'));

    bundle.actions.forEach((action, index) => {
      const card = create('fieldset', 'agent-approval-card');
      card.dataset.actionIndex = String(index);
      const legend = create('legend', '', `Command ${index + 1}`);
      card.appendChild(legend);
      addLabeledValue(card, 'Shell', action.shell || firstValue(ui.currentRun, ['shell', 'shellName', 'shell_name']) || 'Host default shell');
      addLabeledValue(card, 'Working directory', action.cwd || firstValue(ui.currentRun, ['cwd', 'workingDirectory', 'working_directory']) || 'Workspace root');
      addLabeledValue(card, 'Command', action.command, 'agent-command-detail');

      const decisionGroup = create('div', 'agent-decision-group');
      decisionGroup.setAttribute('role', 'group');
      decisionGroup.setAttribute('aria-label', `Decision for command ${index + 1}`);
      ['approve', 'edit', 'reject'].forEach(decision => {
        if (!action.allowedDecisions.includes(decision)) return;
        const button = create('button', `btn agent-decision agent-decision-${decision}`, statusLabel(decision));
        button.type = 'button';
        button.dataset.agentDecision = decision;
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => chooseDecision(card, decision));
        decisionGroup.appendChild(button);
      });
      card.appendChild(decisionGroup);

      const editFields = create('div', 'agent-edit-fields');
      editFields.dataset.agentEditFields = 'true';
      editFields.hidden = true;
      const commandLabel = create('label', '', 'Edited command');
      const commandInput = document.createElement('textarea');
      commandInput.rows = 3;
      commandInput.value = action.command;
      commandInput.dataset.agentEditedCommand = 'true';
      commandInput.setAttribute('aria-label', `Edited command ${index + 1}`);
      commandLabel.appendChild(commandInput);
      const cwdLabel = create('label', '', 'Edited working directory');
      const cwdInput = document.createElement('input');
      cwdInput.type = 'text';
      cwdInput.value = action.cwd;
      cwdInput.dataset.agentEditedCwd = 'true';
      cwdInput.setAttribute('aria-label', `Edited working directory ${index + 1}`);
      cwdLabel.appendChild(cwdInput);
      editFields.append(commandLabel, cwdLabel);
      card.appendChild(editFields);

      const feedbackLabel = create('label', 'agent-feedback-label', 'Feedback (optional)');
      const feedback = document.createElement('input');
      feedback.type = 'text';
      feedback.dataset.agentFeedback = 'true';
      feedback.setAttribute('aria-label', `Feedback for command ${index + 1}`);
      feedbackLabel.appendChild(feedback);
      card.appendChild(feedbackLabel);
      form.appendChild(card);
    });

    const error = create('p', 'agent-approval-error');
    error.setAttribute('role', 'alert');
    const submit = create('button', 'btn primary agent-approval-submit', 'Submit all decisions');
    submit.type = 'submit';
    submit.disabled = true;
    form.append(error, submit);
    form.addEventListener('agent-decision-change', () => {
      const cards = Array.from(form.querySelectorAll('.agent-approval-card'));
      submit.disabled = ui.busy || !bundle.id || cards.some(card => !card.dataset.decision);
    });
    form.addEventListener('submit', event => void handleApprovalSubmit(event, bundle));
    queue.appendChild(form);
  });
}

async function handleApprovalSubmit(event, bundle) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = form.querySelector('.agent-approval-error');
  const cards = Array.from(form.querySelectorAll('.agent-approval-card'));
  if (!bundle.id) {
    error.textContent = 'This approval has no ID and cannot be submitted. Reload the run.';
    return;
  }

  const decisions = [];
  for (const card of cards) {
    const index = Number(card.dataset.actionIndex);
    const action = bundle.actions[index];
    const type = card.dataset.decision;
    const feedback = text(card.querySelector('[data-agent-feedback]')?.value).trim();
    if (!type) {
      error.textContent = 'Choose a decision for every command.';
      return;
    }
    if (type === 'edit') {
      const command = text(card.querySelector('[data-agent-edited-command]')?.value).trim();
      const cwd = text(card.querySelector('[data-agent-edited-cwd]')?.value).trim();
      if (!command) {
        error.textContent = `Edited command ${index + 1} cannot be empty.`;
        return;
      }
      decisions.push({
        type: 'edit',
        editedAction: {
          name: action.name || 'execute_shell',
          args: { ...action.args, command, ...(cwd ? { cwd } : {}) }
        },
        ...(feedback ? { feedback } : {})
      });
    } else if (type === 'reject') {
      decisions.push({ type: 'reject', feedback: feedback || 'Command rejected by the user.' });
    } else {
      decisions.push({ type: 'approve', ...(feedback ? { feedback } : {}) });
    }
  }

  setBusy(true);
  error.textContent = '';
  try {
    const response = await submitAgentApproval(runId(ui.currentRun), { approvalId: bundle.id, decisions });
    if (response && typeof response === 'object') ui.currentRun = { ...ui.currentRun, ...response };
    ui.approvals = ui.approvals.filter(item => item.id !== bundle.id);
    announce('Approval decisions submitted.');
    renderAll();
    await refreshSelectedRun(true);
  } catch (err) {
    error.textContent = err?.message || 'Could not submit approval decisions.';
    announce(error.textContent, 'error');
  } finally {
    setBusy(false);
  }
}

function timelineMeta(event, payload) {
  const at = firstValue(payload, ['createdAt', 'created_at', 'timestamp', 'at'])
    || firstValue(event?.data, ['createdAt', 'created_at', 'timestamp'])
    || event.receivedAt;
  return [statusLabel(event.type), formatTime(at)].filter(Boolean).join(' | ');
}

function outputBlock(label, value, stream) {
  const wrap = create('div', `agent-output agent-output-${stream}`);
  wrap.appendChild(create('div', 'agent-output-label', label));
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text(value);
  pre.appendChild(code);
  wrap.appendChild(pre);
  return wrap;
}

function completionSummary(payload) {
  const parts = [];
  const exitCode = firstValue(payload, ['exitCode', 'exit_code', 'code']);
  const signal = firstValue(payload, ['signal']);
  if (exitCode !== '') parts.push(`Exit ${exitCode}`);
  if (signal) parts.push(`Signal ${signal}`);
  if (payload.timedOut === true || payload.timed_out === true || payload.timeout === true) parts.push('Timed out');
  if (payload.cancelled === true || payload.canceled === true) parts.push('Cancelled');
  if (payload.truncated === true) parts.push('Output truncated');
  if (payload.redacted === true || payload.redactionApplied === true || payload.redaction_applied === true) parts.push('Known secrets redacted');
  return parts.join(' | ');
}

function renderTimelineEvent(event) {
  const payload = eventPayload(event);
  const type = text(event.type).toLowerCase();
  const card = create('article', `agent-event agent-event-${type.replace(/[^a-z0-9_-]/g, '-')}`);
  card.appendChild(create('div', 'agent-event-meta', timelineMeta(event, payload)));

  const commandEvent = type.includes('proposal') || type.includes('shell_started') || type.includes('command_started');
  const outputEvent = type.includes('shell_output') || type.includes('command_output');
  const completionEvent = type.includes('shell_completed') || type.includes('command_completed') || type === 'tool_result';
  const messageEvent = ['agent_message', 'message', 'message_chunk', 'progress', 'final'].includes(type);
  const statusEvent = ['run_created', 'run_started', 'run_status', 'status', 'completed', 'run_completed', 'failed', 'run_failed', 'cancelled', 'run_cancelled', 'error'].includes(type);

  if (commandEvent) {
    const details = shellDetails(payload);
    addLabeledValue(card, 'Shell', details.shell || 'Host default shell');
    addLabeledValue(card, 'Working directory', details.cwd || 'Workspace root');
    addLabeledValue(card, 'Command', details.command, 'agent-command-detail');
  } else if (outputEvent) {
    const stream = text(firstValue(payload, ['stream', 'channel']) || 'stdout').toLowerCase() === 'stderr' ? 'stderr' : 'stdout';
    const output = firstValue(payload, ['chunk', 'output', 'data', 'text']);
    card.appendChild(outputBlock(stream.toUpperCase(), output, stream));
    const summary = completionSummary(payload);
    if (summary) card.appendChild(create('p', 'agent-event-summary', summary));
  } else if (completionEvent) {
    const stdout = firstValue(payload, ['stdout']);
    const stderr = firstValue(payload, ['stderr']);
    const output = firstValue(payload, ['output']);
    if (stdout) card.appendChild(outputBlock('STDOUT', stdout, 'stdout'));
    if (stderr) card.appendChild(outputBlock('STDERR', stderr, 'stderr'));
    if (!stdout && !stderr && output) card.appendChild(outputBlock('OUTPUT', output, 'stdout'));
    card.appendChild(create('p', 'agent-event-summary', completionSummary(payload) || 'Command finished.'));
  } else if (messageEvent) {
    const value = firstValue(payload, ['message', 'content', 'text', 'delta', 'output', 'finalOutput', 'final_output']);
    const message = visibleText(value);
    if (!message) return null;
    const markup = create('div', 'agent-message-markup');
    markup.appendChild(renderAgentMessage(message));
    card.appendChild(markup);
    applyHighlight(markup);
  } else if (statusEvent) {
    const value = firstValue(payload, ['message', 'error', 'statusText', 'status_text']);
    if (type === 'run_completed' && payload.hasAgentOutput === false) {
      card.classList.add('agent-event-no-output');
      card.appendChild(create('div', 'agent-no-output', 'Agent completed without producing any visible output.'));
    } else {
      const message = visibleText(value) || statusLabel(firstValue(payload, ['status']) || type);
      card.appendChild(create('div', 'agent-status-text', message));
    }
  } else {
    return null;
  }
  return card;
}

function renderTimeline() {
  const timeline = byId('agentTimeline');
  if (!timeline) return;
  timeline.replaceChildren();
  if (ui.currentRun) {
    const mission = create('article', 'agent-event agent-event-mission');
    mission.append(create('div', 'agent-event-meta', 'Mission'), create('div', 'agent-message-text', firstValue(ui.currentRun, ['request', 'prompt', 'mission']) || 'Request unavailable'));
    timeline.appendChild(mission);
  }
  const events = [];
  ui.events.forEach(event => {
    const payload = eventPayload(event);
    const previous = events[events.length - 1];
    if (event.type === 'agent_message' && payload.delta === true && previous?.type === 'agent_message' && eventPayload(previous).delta === true) {
      const previousPayload = eventPayload(previous);
      events[events.length - 1] = {
        ...event,
        data: { payload: { ...payload, text: `${text(previousPayload.text)}${text(payload.text)}` } }
      };
      return;
    }
    events.push(event);
  });
  events.forEach(event => {
    const node = renderTimelineEvent(event);
    if (node) timeline.appendChild(node);
  });
  if (!timeline.childElementCount) timeline.appendChild(create('p', 'agent-empty', 'Select a run or describe a new mission.'));
}

function renderAll() {
  renderHeader();
  renderHistory();
  renderTimeline();
  renderApprovals();
  syncControls();
}

function normalizeEmbeddedEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const data = value.payload && value.type && !value.data ? value : (value.data || value);
  return {
    id: text(value.id || value.eventId || value.event_id),
    type: text(value.type || value.eventType || value.event_type || data.type || 'message'),
    data,
    receivedAt: firstValue(value, ['createdAt', 'created_at', 'timestamp']) || new Date().toISOString()
  };
}

function replaceEmbeddedEvents(run, preserveEvents) {
  const embedded = run?.events || run?.eventHistory || run?.event_history;
  if (!Array.isArray(embedded)) return;
  if (!preserveEvents) {
    ui.events = [];
    ui.eventIds.clear();
  }
  embedded.map(normalizeEmbeddedEvent).filter(Boolean).forEach(addEvent);
}

function addEvent(event) {
  if (!event) return false;
  if (event.id && ui.eventIds.has(event.id)) return false;
  if (event.id) ui.eventIds.add(event.id);
  ui.events.push(event);
  ui.eventRevision += 1;
  return true;
}

function latestEventId() {
  for (let index = ui.events.length - 1; index >= 0; index -= 1) {
    if (ui.events[index].id) return ui.events[index].id;
  }
  return '0';
}

function applyEvent(event) {
  if (!addEvent(event)) return;
  const payload = eventPayload(event);
  const type = text(event.type).toLowerCase();
  const terminalStatus = type === 'run_completed'
    ? 'completed'
    : (type === 'run_failed' ? 'failed' : (type === 'run_cancelled' ? 'cancelled' : type));
  const nextStatus = text(firstValue(payload, ['status', 'runStatus', 'run_status'])).toLowerCase();
  if (ui.currentRun && nextStatus) ui.currentRun = { ...ui.currentRun, status: nextStatus };
  if (ui.currentRun && TERMINAL_STATUSES.has(terminalStatus)) ui.currentRun = { ...ui.currentRun, status: terminalStatus };

  if (type === 'approval_required' || type === 'approval_requested' || type === 'tool_proposal') {
    const bundle = normalizeApprovalBundle(payload);
    if (bundle) ui.approvals = [bundle];
    if (ui.currentRun) ui.currentRun = { ...ui.currentRun, status: 'awaiting_approval' };
    announce('A shell command is waiting for approval.');
  } else if (type === 'approval_resolved' || type === 'approval_decided') {
    const approvalId = text(firstValue(payload, ['approvalId', 'approval_id', 'id']));
    ui.approvals = approvalId ? ui.approvals.filter(item => item.id !== approvalId) : [];
    if (type === 'approval_decided' && ui.currentRun) ui.currentRun = { ...ui.currentRun, status: 'running' };
  }

  const id = runId(ui.currentRun);
  ui.runs = ui.runs.map(run => runId(run) === id ? { ...run, ...ui.currentRun } : run);
  if (nextStatus || TERMINAL_STATUSES.has(terminalStatus)) {
    announce(`Agent run ${statusLabel(nextStatus || terminalStatus)}.`);
    if (TERMINAL_STATUSES.has(nextStatus || terminalStatus)) void refreshHistory();
  }
  renderAll();
}

function closeStream() {
  ui.stream?.close();
  ui.stream = null;
}

function attachStream(token) {
  const id = runId(ui.currentRun);
  if (!id) return;
  closeStream();
  ui.stream = streamAgentRun(id, {
    after: latestEventId(),
    onOpen: ({ reconnected }) => {
      if (token !== ui.selectionToken) return;
      announce(reconnected ? 'Agent event stream reconnected.' : 'Agent event stream connected.');
    },
    onReconnect: () => {
      if (token === ui.selectionToken) void refreshSelectedRun(true);
    },
    onEvent: event => {
      if (token === ui.selectionToken) applyEvent(event);
    },
    onError: err => {
      if (token === ui.selectionToken) announce(err?.message || 'Agent event stream disconnected.', 'warning');
    }
  });
}

async function refreshHistory() {
  try {
    ui.runs = await listAgentRuns();
    renderHistory();
    syncControls();
  } catch (err) {
    announce(err?.message || 'Could not load Agent run history.', 'error');
  }
}

async function refreshSelectedRun(preserveEvents = true) {
  const id = runId(ui.currentRun) || getSelectedAgentRunId();
  if (!id) return;
  const revision = ui.eventRevision;
  try {
    const run = await getAgentRun(id);
    if (!run || runId(run) !== id) return;
    const receivedNewerEvent = preserveEvents && ui.eventRevision !== revision;
    ui.currentRun = receivedNewerEvent
      ? { ...run, ...ui.currentRun }
      : { ...ui.currentRun, ...run };
    replaceEmbeddedEvents(run, preserveEvents);
    if (!receivedNewerEvent) ui.approvals = approvalsFromRun(run);
    ui.runs = ui.runs.map(item => runId(item) === id ? { ...item, ...run } : item);
    if (!ui.runs.some(item => runId(item) === id)) ui.runs.unshift(run);
    renderAll();
  } catch (err) {
    announce(err?.message || 'Could not refresh the selected Agent run.', 'error');
  }
}

async function selectRun(id) {
  const selectedId = text(id).trim();
  const token = ui.selectionToken + 1;
  ui.selectionToken = token;
  closeStream();
  setSelectedAgentRunId(selectedId);
  ui.events = [];
  ui.eventIds.clear();
  ui.eventRevision = 0;
  ui.approvals = [];

  if (!selectedId) {
    ui.currentRun = null;
    renderAll();
    byId('agentRequest')?.focus();
    return;
  }

  ui.currentRun = ui.runs.find(run => runId(run) === selectedId) || { id: selectedId, status: 'loading' };
  renderAll();
  try {
    const run = await getAgentRun(selectedId);
    if (token !== ui.selectionToken) return;
    ui.currentRun = run;
    replaceEmbeddedEvents(run, false);
    ui.approvals = approvalsFromRun(run);
    if (!ui.runs.some(item => runId(item) === selectedId)) ui.runs.unshift(run);
    renderAll();
    attachStream(token);
  } catch (err) {
    if (token !== ui.selectionToken) return;
    announce(err?.message || 'Could not load the selected Agent run.', 'error');
    attachStream(token);
  }
}

function setBusy(busy) {
  ui.busy = !!busy;
  byId('agent')?.setAttribute('aria-busy', ui.busy ? 'true' : 'false');
  syncControls();
  document.querySelectorAll('#agentApprovals button, #agentApprovals input, #agentApprovals textarea').forEach(control => {
    control.disabled = ui.busy;
  });
  if (!ui.busy) {
    document.querySelectorAll('#agentApprovals form').forEach(form => {
      form.dispatchEvent(new Event('agent-decision-change'));
    });
  }
}

async function handleStart(event) {
  event.preventDefault();
  const input = byId('agentRequest');
  const request = text(input?.value).trim();
  if (!request) return;
  const model = currentModel();
  if (!model || !supportsToolCallingFor(model.key)) {
    refreshCapability();
    announce('Choose a model known to support tool calling before starting an Agent run.', 'error');
    return;
  }

  const yolo = byId('agentYolo');
  const approvalMode = yolo?.checked === true ? 'yolo' : 'manual';
  if (approvalMode === 'yolo') {
    const confirmed = await showMessageBox({
      title: 'Run in YOLO mode?',
      message: 'YOLO mode will execute every shell command without human approval using the server process permissions. Continue?',
      confirmLabel: 'Continue',
      cancelLabel: 'Cancel'
    });
    if (!confirmed) {
      announce('YOLO run cancelled.');
      return;
    }
  }

  setBusy(true);
  announce(`Starting a ${approvalMode === 'yolo' ? 'YOLO ' : ''}run with ${model.label}...`);
  try {
    const run = await startAgentRun({
      request,
      provider: providerFor(model.key),
      model: modelIdFor(model.key),
      approvalMode
    });
    if (!runId(run)) throw new Error('The Agent server did not return a run ID.');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    if (yolo) yolo.checked = false;
    ui.runs = [run, ...ui.runs.filter(item => runId(item) !== runId(run))];
    await selectRun(runId(run));
    announce(approvalMode === 'yolo'
      ? 'YOLO Agent run started. Shell commands will execute without approval.'
      : 'Agent run started. Shell commands will require approval.');
  } catch (err) {
    announce(err?.message || 'Could not start the Agent run.', 'error');
  } finally {
    setBusy(false);
  }
}

async function handleStop() {
  const id = runId(ui.currentRun);
  if (!id || !isActive(ui.currentRun)) return;
  setBusy(true);
  announce('Stopping the Agent run...');
  try {
    const response = await stopAgentRun(id);
    ui.currentRun = { ...ui.currentRun, ...(response || {}), status: response?.status || 'cancelled' };
    ui.approvals = [];
    announce('Agent run cancelled.');
    await refreshHistory();
    renderAll();
  } catch (err) {
    announce(err?.message || 'Could not stop the Agent run.', 'error');
  } finally {
    setBusy(false);
  }
}

function autoGrowRequest() {
  const input = byId('agentRequest');
  if (!input) return;
  input.style.height = 'auto';
  const maxHeight = parseFloat(window.getComputedStyle(input).maxHeight || '0') || Infinity;
  input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
}

export function initAgentUI() {
  if (ui.initialized || !byId('agent')) return;
  ui.initialized = true;
  byId('agentForm')?.addEventListener('submit', handleStart);
  byId('agentStop')?.addEventListener('click', () => void handleStop());
  byId('agentNewRun')?.addEventListener('click', () => void selectRun(''));
  byId('agentHistory')?.addEventListener('change', event => void selectRun(event.target.value));
  byId('agentRequest')?.addEventListener('input', autoGrowRequest);
  byId('agentRequest')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      byId('agentForm')?.requestSubmit();
    }
  });
  byId('agentYolo')?.addEventListener('change', syncControls);
  document.addEventListener('pw:model:changed', refreshCapability);
  document.addEventListener('pw:settings:loaded', refreshCapability);

  // A page load always starts in the new-run state; history remains available in the dropdown.
  setSelectedAgentRunId('');
  renderAll();
  autoGrowRequest();
  void loadModels().finally(refreshCapability);
  void (async () => {
    await refreshHistory();
    renderAll();
  })();
}
