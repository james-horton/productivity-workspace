'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentRequestError,
  normalizeSocketAddress,
  isLoopbackAddress,
  isLocalRequest,
  assertLocalRequest,
  localOnly,
  validateStartRequest,
  validateShellAction,
  validateApprovalRequest
} = require('../../lib/agent/requestValidation');

function assertRequestError(fn, { field, status = 400, code = 'INVALID_AGENT_REQUEST' } = {}) {
  assert.throws(fn, error => {
    assert.ok(error instanceof AgentRequestError);
    assert.equal(error.status, status);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

test('normalizes IPv4, IPv6, mapped IPv6, and socket address forms', () => {
  assert.equal(normalizeSocketAddress(' 127.0.0.1 '), '127.0.0.1');
  assert.equal(normalizeSocketAddress('127.0.0.2:4321'), '127.0.0.2');
  assert.equal(normalizeSocketAddress('[::1]:4321'), '::1');
  assert.equal(normalizeSocketAddress('::ffff:127.0.0.3'), '127.0.0.3');
  assert.equal(normalizeSocketAddress('[::FFFF:127.0.0.4]:8080'), '127.0.0.4');
  assert.equal(normalizeSocketAddress('::ffff:7f00:5'), '127.0.0.5');
  assert.equal(normalizeSocketAddress('0:0:0:0:0:ffff:7f00:5'), '127.0.0.5');
  assert.equal(normalizeSocketAddress('not-an-address'), null);
  assert.equal(normalizeSocketAddress('[::1]suffix'), null);
});

test('recognizes only IPv4, IPv6, and mapped IPv6 loopback addresses', () => {
  for (const address of [
    '127.0.0.1',
    '127.255.255.255',
    '::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '[::ffff:127.10.20.30]:9000'
  ]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }

  for (const address of [
    '0.0.0.0',
    '192.168.1.10',
    '::',
    '::2',
    '::ffff:192.168.1.10',
    undefined
  ]) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
});

test('uses only req.socket.remoteAddress and ignores forwarded headers', () => {
  const forwardedLocal = {
    socket: { remoteAddress: '203.0.113.20' },
    headers: {
      forwarded: 'for=127.0.0.1',
      'x-forwarded-for': '127.0.0.1',
      'x-real-ip': '127.0.0.1'
    }
  };
  assert.equal(isLocalRequest(forwardedLocal), false);

  const forwardedRemote = {
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.20' }
  };
  assert.equal(isLocalRequest(forwardedRemote), true);
});

test('local-only guards expose clear 403 route errors', () => {
  assert.doesNotThrow(() => assertLocalRequest({ socket: { remoteAddress: '::1' } }));
  assertRequestError(
    () => assertLocalRequest({ socket: { remoteAddress: '10.0.0.4' } }),
    { status: 403, code: 'AGENT_LOCAL_ONLY' }
  );

  let nextError;
  localOnly({ socket: { remoteAddress: '10.0.0.4' } }, {}, error => {
    nextError = error;
  });
  assert.ok(nextError instanceof AgentRequestError);
  assert.equal(nextError.status, 403);
});

test('validates and normalizes Agent start payloads', () => {
  assert.deepEqual(validateStartRequest({
    request: '  preserve my request edges  ',
    provider: ' OpenAI ',
    model: ' gpt-tool-model ',
    modelKey: ' openai:gpt-tool-model '
  }), {
    request: '  preserve my request edges  ',
    provider: 'openai',
    model: 'gpt-tool-model',
    modelKey: 'openai:gpt-tool-model'
  });

  assert.deepEqual(validateStartRequest({
    request: 'Work locally',
    provider: 'openrouter',
    model: 'vendor/model'
  }), {
    request: 'Work locally',
    provider: 'openrouter',
    model: 'vendor/model'
  });

  assert.equal(validateStartRequest({
    request: 'Run without approval',
    provider: 'openai',
    model: 'gpt-tool-model',
    approvalMode: ' YOLO '
  }).approvalMode, 'yolo');
});

test('rejects malformed start payloads and configured length overflows', () => {
  assertRequestError(() => validateStartRequest(null), { field: 'body' });
  assertRequestError(() => validateStartRequest({ request: 42, provider: 'openai', model: 'm' }), { field: 'request' });
  assertRequestError(() => validateStartRequest({ request: '   ', provider: 'openai', model: 'm' }), { field: 'request' });
  assertRequestError(() => validateStartRequest({ request: 'task', provider: 'other', model: 'm' }), { field: 'provider' });
  assertRequestError(() => validateStartRequest({ request: 'task', provider: 'openai', model: '' }), { field: 'model' });
  assertRequestError(
    () => validateStartRequest(
      { request: '123456', provider: 'openai', model: 'm' },
      { requestMaxLength: 5 }
    ),
    { field: 'request' }
  );
  assertRequestError(
    () => validateStartRequest(
      { request: 'task', provider: 'openai', model: 'model', modelKey: '1234' },
      { modelKeyMaxLength: 3 }
    ),
    { field: 'modelKey' }
  );
  assertRequestError(
    () => validateStartRequest({
      request: 'task', provider: 'openai', model: 'model', approvalMode: 'automatic'
    }),
    { field: 'approvalMode' }
  );
});

test('validates approve, edit, and reject approval decision shapes', () => {
  assert.deepEqual(validateApprovalRequest({
    approvalId: ' approval-1 ',
    decisions: [
      { type: 'approve' },
      {
        type: 'edit',
        feedback: 'Use the narrower command',
        editedAction: {
          name: 'execute_shell',
          args: { command: 'node --test', cwd: ' C:\\workspace ' }
        }
      },
      { type: 'reject', feedback: 'Do not execute this command.' }
    ]
  }), {
    approvalId: 'approval-1',
    decisions: [
      { type: 'approve' },
      {
        type: 'edit',
        feedback: 'Use the narrower command',
        editedAction: {
          name: 'execute_shell',
          args: { command: 'node --test', cwd: 'C:\\workspace' }
        }
      },
      { type: 'reject', feedback: 'Do not execute this command.' }
    ]
  });
});

test('rejects invalid approval and edited shell structures', () => {
  assertRequestError(
    () => validateApprovalRequest({ approvalId: 'a', decisions: [] }),
    { field: 'decisions' }
  );
  assertRequestError(
    () => validateApprovalRequest({ approvalId: 'a', decisions: [{ type: 'skip' }] }),
    { field: 'decisions[0].type' }
  );
  assertRequestError(
    () => validateApprovalRequest({ approvalId: 'a', decisions: [{ type: 'edit' }] }),
    { field: 'decisions[0].editedAction' }
  );
  assertRequestError(
    () => validateApprovalRequest({
      approvalId: 'a',
      decisions: [{ type: 'approve', editedAction: { name: 'execute_shell', args: { command: 'dir' } } }]
    }),
    { field: 'decisions[0].editedAction' }
  );
  assertRequestError(
    () => validateShellAction(
      { name: 'other_tool', args: { command: 'dir' } },
      {},
      'action'
    ),
    { field: 'action.name' }
  );
  assertRequestError(
    () => validateShellAction(
      { name: 'execute_shell', args: { command: '1234' } },
      { commandMaxLength: 3 },
      'action'
    ),
    { field: 'action.args.command' }
  );
});
