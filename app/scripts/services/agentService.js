/**
 * Agent REST and durable SSE event client.
 */

import { AGENT_EVENTS, ENDPOINTS, JSON_HEADERS, TIMEOUTS } from '../config.js';

function runUrl(runId, suffix = '') {
  const id = encodeURIComponent(String(runId || '').trim());
  if (!id) throw new Error('A run ID is required.');
  return `${ENDPOINTS.agentRuns}/${id}${suffix}`;
}

async function responseError(res, fallback) {
  let message = '';
  try {
    const body = await res.json();
    message = body?.error?.message || body?.message || body?.error || '';
  } catch {}
  return new Error(message ? `${fallback} (${res.status}): ${message}` : `${fallback} (${res.status})`);
}

async function requestJson(url, init = {}, timeoutMs = TIMEOUTS.defaultMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw await responseError(res, 'Agent request failed');
    return res.status === 204 ? null : res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listAgentRuns() {
  const data = await requestJson(ENDPOINTS.agentRuns);
  return Array.isArray(data) ? data : (Array.isArray(data?.runs) ? data.runs : []);
}

export async function getAgentRun(runId) {
  const data = await requestJson(runUrl(runId));
  return data?.run || data;
}

export async function startAgentRun({ request, provider, model, modelKey, approvalMode }) {
  const data = await requestJson(ENDPOINTS.agentRuns, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ request, provider, model, modelKey, approvalMode })
  });
  return data?.run || data;
}

export async function submitAgentApproval(runId, { approvalId, decisions }) {
  const data = await requestJson(runUrl(runId, '/approval'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ approvalId, decisions })
  });
  return data?.run || data;
}

export async function stopAgentRun(runId) {
  const data = await requestJson(runUrl(runId, '/stop'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{}'
  });
  return data?.run || data;
}

function parseEvent(event) {
  let data = {};
  try {
    data = event.data ? JSON.parse(event.data) : {};
  } catch {
    data = { text: String(event.data || '') };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = { data };
  const id = String(event.lastEventId || data.id || data.eventId || data.event_id || '').trim();
  const type = String(data.type || data.eventType || data.event_type || event.type || 'message').trim();
  return { id, type, data, receivedAt: new Date().toISOString() };
}

/**
 * Connect to one run's SSE stream. Reconnects explicitly so every new request
 * carries the latest durable event ID in the `after` query parameter.
 */
export function streamAgentRun(runId, {
  after = '0',
  onEvent = () => {},
  onOpen = () => {},
  onReconnect = () => {},
  onError = () => {}
} = {}) {
  let source = null;
  let reconnectTimer = null;
  let closed = false;
  let opened = false;
  let attempts = 0;
  let lastEventId = String(after || '0');
  const seenIds = new Set();
  const seenOrder = [];

  const rememberId = id => {
    if (!id || seenIds.has(id)) return false;
    seenIds.add(id);
    seenOrder.push(id);
    while (seenOrder.length > AGENT_EVENTS.maxRememberedIds) {
      seenIds.delete(seenOrder.shift());
    }
    return true;
  };

  const deliver = rawEvent => {
    const event = parseEvent(rawEvent);
    if (event.id) {
      if (!rememberId(event.id)) return;
      lastEventId = event.id;
    }
    onEvent(event);
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    attempts += 1;
    const delay = Math.min(
      AGENT_EVENTS.reconnectMaxMs,
      AGENT_EVENTS.reconnectBaseMs * (2 ** Math.min(attempts - 1, 4))
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) return;
    if (typeof EventSource !== 'function') {
      onError(new Error('Live Agent updates are not supported by this browser.'));
      return;
    }

    const separator = runUrl(runId, '/events').includes('?') ? '&' : '?';
    source = new EventSource(`${runUrl(runId, '/events')}${separator}after=${encodeURIComponent(lastEventId || '0')}`);
    const wasReconnect = opened;

    source.onopen = () => {
      attempts = 0;
      opened = true;
      onOpen({ reconnected: wasReconnect, lastEventId });
      if (wasReconnect) onReconnect({ lastEventId });
    };
    source.onmessage = deliver;
    AGENT_EVENTS.types.forEach(type => {
      if (type !== 'message') source.addEventListener(type, deliver);
    });
    source.onerror = () => {
      if (closed) return;
      source?.close();
      source = null;
      onError(new Error('Agent event stream disconnected. Reconnecting...'));
      scheduleReconnect();
    };
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      source?.close();
      source = null;
    },
    getLastEventId() {
      return lastEventId;
    }
  };
}
