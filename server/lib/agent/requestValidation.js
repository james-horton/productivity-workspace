'use strict';

const net = require('node:net');

const DEFAULT_LIMITS = Object.freeze({
  requestMaxLength: 20_000,
  identifierMaxLength: 256,
  modelKeyMaxLength: 512,
  feedbackMaxLength: 4_000,
  commandMaxLength: 20_000,
  cwdMaxLength: 2_000,
  maxDecisions: 32
});

const PROVIDERS = new Set(['openai', 'openrouter']);
const APPROVAL_MODES = new Set(['manual', 'yolo']);
const DECISION_TYPES = new Set(['approve', 'edit', 'reject']);

class AgentRequestError extends Error {
  constructor(message, { status = 400, code = 'INVALID_AGENT_REQUEST', field } = {}) {
    super(message);
    this.name = 'AgentRequestError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    if (field) this.field = field;
  }
}

function invalid(message, field) {
  throw new AgentRequestError(message, { field });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readLimit(options, name) {
  const value = options && options[name];
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_LIMITS[name];
}

function requiredString(value, field, maxLength, { trim = true } = {}) {
  if (typeof value !== 'string') invalid(`${field} must be a string.`, field);

  const normalized = trim ? value.trim() : value;
  if (!normalized.trim()) invalid(`${field} is required.`, field);
  if (normalized.length > maxLength) {
    invalid(`${field} must be ${maxLength} characters or fewer.`, field);
  }
  return normalized;
}

function optionalString(value, field, maxLength, { trim = true } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${field} must be a string.`, field);

  const normalized = trim ? value.trim() : value;
  if (normalized.length > maxLength) {
    invalid(`${field} must be ${maxLength} characters or fewer.`, field);
  }
  return normalized;
}

function ipv6Words(address) {
  const halves = address.split('::');
  if (halves.length > 2) return null;

  function wordsFor(part) {
    if (!part) return [];
    const words = [];
    for (const token of part.split(':')) {
      if (token.includes('.')) {
        if (net.isIP(token) !== 4) return null;
        const bytes = token.split('.').map(Number);
        words.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else {
        words.push(Number.parseInt(token, 16));
      }
    }
    return words;
  }

  const left = wordsFor(halves[0]);
  const right = wordsFor(halves[1] || '');
  if (!left || !right) return null;

  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function mappedIpv4FromIpv6(address) {
  if (net.isIP(address) !== 6) return null;

  const words = ipv6Words(address);
  if (!words || words.slice(0, 5).some(word => word !== 0) || words[5] !== 0xffff) {
    return null;
  }

  const high = words[6];
  const low = words[7];
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function normalizeSocketAddress(value) {
  if (typeof value !== 'string') return null;

  let address = value.trim().toLowerCase();
  if (!address) return null;

  if (address.startsWith('[')) {
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
    if (!bracketed) return null;
    address = bracketed[1];
  } else if (net.isIP(address) === 0) {
    const ipv4WithPort = /^(.*):(\d+)$/.exec(address);
    if (!ipv4WithPort || net.isIP(ipv4WithPort[1]) !== 4) return null;
    address = ipv4WithPort[1];
  }

  if (net.isIP(address) === 0) return null;
  return mappedIpv4FromIpv6(address) || address;
}

function isLoopbackAddress(value) {
  const address = normalizeSocketAddress(value);
  if (!address) return false;
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true;
  return net.isIP(address) === 4 && address.split('.')[0] === '127';
}

function isLocalRequest(req) {
  return isLoopbackAddress(req && req.socket && req.socket.remoteAddress);
}

function assertLocalRequest(req) {
  if (!isLocalRequest(req)) {
    throw new AgentRequestError('Agent requests are only accepted from the local machine.', {
      status: 403,
      code: 'AGENT_LOCAL_ONLY'
    });
  }
}

function localOnly(req, res, next) {
  try {
    assertLocalRequest(req);
    next();
  } catch (error) {
    next(error);
  }
}

function validateStartRequest(body, options = {}) {
  if (!isRecord(body)) invalid('Request body must be a JSON object.', 'body');

  const request = requiredString(
    body.request,
    'request',
    readLimit(options, 'requestMaxLength'),
    { trim: false }
  );
  const provider = requiredString(
    body.provider,
    'provider',
    readLimit(options, 'identifierMaxLength')
  ).toLowerCase();
  const model = requiredString(
    body.model,
    'model',
    readLimit(options, 'identifierMaxLength')
  );
  const modelKey = optionalString(
    body.modelKey,
    'modelKey',
    readLimit(options, 'modelKeyMaxLength')
  );
  const approvalMode = optionalString(body.approvalMode, 'approvalMode', 16);

  if (!PROVIDERS.has(provider)) {
    invalid('provider must be "openai" or "openrouter".', 'provider');
  }

  if (approvalMode !== undefined && !APPROVAL_MODES.has(approvalMode.toLowerCase())) {
    invalid('approvalMode must be "manual" or "yolo".', 'approvalMode');
  }

  const result = modelKey === undefined
    ? { request, provider, model }
    : { request, provider, model, modelKey };
  if (approvalMode !== undefined) result.approvalMode = approvalMode.toLowerCase();
  return result;
}

function validateShellAction(action, options = {}, field = 'editedAction') {
  if (!isRecord(action)) invalid(`${field} must be an object.`, field);
  if (action.name !== 'execute_shell') {
    invalid(`${field}.name must be "execute_shell".`, `${field}.name`);
  }
  if (!isRecord(action.args)) invalid(`${field}.args must be an object.`, `${field}.args`);

  const command = requiredString(
    action.args.command,
    `${field}.args.command`,
    readLimit(options, 'commandMaxLength'),
    { trim: false }
  );
  const cwd = optionalString(
    action.args.cwd,
    `${field}.args.cwd`,
    readLimit(options, 'cwdMaxLength')
  );
  const args = cwd === undefined ? { command } : { command, cwd };

  return { name: 'execute_shell', args };
}

function validateDecision(decision, index, options) {
  const field = `decisions[${index}]`;
  if (!isRecord(decision)) invalid(`${field} must be an object.`, field);

  const type = requiredString(decision.type, `${field}.type`, 16).toLowerCase();
  if (!DECISION_TYPES.has(type)) {
    invalid(`${field}.type must be "approve", "edit", or "reject".`, `${field}.type`);
  }

  const feedback = optionalString(
    decision.feedback,
    `${field}.feedback`,
    readLimit(options, 'feedbackMaxLength'),
    { trim: false }
  );
  const normalized = feedback === undefined ? { type } : { type, feedback };

  if (type === 'edit') {
    normalized.editedAction = validateShellAction(
      decision.editedAction,
      options,
      `${field}.editedAction`
    );
  } else if (decision.editedAction !== undefined) {
    invalid(`${field}.editedAction is only valid for an edit decision.`, `${field}.editedAction`);
  }

  return normalized;
}

function validateApprovalRequest(body, options = {}) {
  if (!isRecord(body)) invalid('Request body must be a JSON object.', 'body');

  const approvalId = requiredString(
    body.approvalId,
    'approvalId',
    readLimit(options, 'identifierMaxLength')
  );
  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    invalid('decisions must be a non-empty array.', 'decisions');
  }
  if (body.decisions.length > readLimit(options, 'maxDecisions')) {
    invalid(`decisions must contain no more than ${readLimit(options, 'maxDecisions')} items.`, 'decisions');
  }

  return {
    approvalId,
    decisions: body.decisions.map((decision, index) => validateDecision(decision, index, options))
  };
}

module.exports = {
  AgentRequestError,
  DEFAULT_LIMITS,
  APPROVAL_MODES,
  normalizeSocketAddress,
  isLoopbackAddress,
  isLocalRequest,
  assertLocalRequest,
  localOnly,
  validateStartRequest,
  validateShellAction,
  validateApprovalRequest
};
