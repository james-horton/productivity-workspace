const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const { executeShell } = require('../../lib/agent/shellExecutor');

function nodeCommand(source) {
  const encoded = Buffer.from(source).toString('base64');
  const executable = `"${process.execPath.replaceAll('"', '""')}"`;
  return `${executable} -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}

test('streams and captures stdout and stderr', async () => {
  const events = [];
  const result = await executeShell({
    command: nodeCommand(
      "process.stdout.write('standard output'); process.stderr.write('standard error')"
    ),
    onEvent: event => events.push(event)
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /standard output/);
  assert.match(result.output, /standard error/);
  assert.equal(result.output.length, 'standard outputstandard error'.length);
  assert.equal(
    events.filter(event => event.type === 'stdout').map(event => event.data).join(''),
    'standard output'
  );
  assert.equal(
    events.filter(event => event.type === 'stderr').map(event => event.data).join(''),
    'standard error'
  );
});

test('returns a non-zero exit as a failed tool result', async () => {
  const result = await executeShell(nodeCommand("process.stderr.write('bad exit'); process.exit(7)"));

  assert.equal(result.status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.match(result.output, /bad exit/);
  assert.equal(result.timedOut, false);
});

test('returns invalid cwd failures as structured spawn errors', async () => {
  const missingDirectory = path.join(
    os.tmpdir(),
    `shell-executor-missing-${process.pid}-${Date.now()}`
  );
  const events = [];
  const result = await executeShell({
    command: nodeCommand("process.stdout.write('not reached')"),
    cwd: missingDirectory,
    onEvent: event => events.push(event)
  });

  assert.equal(result.status, 'spawn_error');
  assert.equal(result.exitCode, null);
  assert.match(result.error, /Unable to start command:/);
  assert.equal(events.at(-1).status, 'spawn_error');
});

test('times out and terminates the spawned process tree', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-executor-'));
  const markerPath = path.join(tempDirectory, 'descendant-survived.txt');
  const descendant = [
    "const fs = require('node:fs')",
    `setTimeout(() => fs.writeFileSync(${JSON.stringify(markerPath)}, 'alive'), 700)`
  ].join(';');
  const parent = [
    "const { spawn } = require('node:child_process')",
    `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })`,
    "setInterval(() => {}, 1000)"
  ].join(';');

  try {
    const result = await executeShell({
      command: nodeCommand(parent),
      timeoutMs: 120
    });

    assert.equal(result.status, 'timed_out');
    assert.equal(result.timedOut, true);
    await delay(900);
    assert.equal(fs.existsSync(markerPath), false, 'a descendant process survived timeout');
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('caps retained combined output and adds a truncation marker', async () => {
  const events = [];
  const result = await executeShell({
    command: nodeCommand("process.stdout.write('x'.repeat(500))"),
    maxOutputBytes: 80,
    onEvent: event => events.push(event)
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= 80);
  assert.match(result.output, /\[output truncated\]/);
  assert.equal(
    events.filter(event => event.type === 'stdout').map(event => event.data).join('').length,
    500
  );
});

test('redacts configured secrets across stream chunk boundaries', async () => {
  const secret = 'known-provider-secret-value';
  const events = [];
  const source = [
    "process.stdout.write(process.env.SHELL_EXECUTOR_TEST_API_KEY.slice(0, 9))",
    "setTimeout(() => process.stdout.write(process.env.SHELL_EXECUTOR_TEST_API_KEY.slice(9)), 20)"
  ].join(';');
  const result = await executeShell({
    command: nodeCommand(source),
    env: { SHELL_EXECUTOR_TEST_API_KEY: secret },
    secrets: [secret],
    onEvent: event => events.push(event)
  });
  const serialized = JSON.stringify({ result, events });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.redacted, true);
  assert.equal(result.output, '[REDACTED]');
  assert.doesNotMatch(serialized, new RegExp(secret));
});

test('redacts a secret split by interleaved stderr output', async () => {
  const secret = 'ABCDEFSECRET';
  const source = [
    "process.stdout.write('ABCDEF')",
    "setTimeout(() => process.stderr.write('interleaved error'), 10)",
    "setTimeout(() => process.stdout.write('SECRET'), 25)"
  ].join(';');
  const result = await executeShell({
    command: nodeCommand(source),
    secrets: [secret]
  });

  assert.equal(result.redacted, true);
  assert.match(result.output, /\[REDACTED\]/);
  assert.doesNotMatch(result.output, /ABCDEF|SECRET/);
  assert.match(result.output, /interleaved error/);
});

test('supports AbortSignal cancellation', async () => {
  const controller = new AbortController();
  const execution = executeShell({
    command: nodeCommand("setInterval(() => {}, 1000)"),
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 50);

  const result = await execution;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});
