const { spawn } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const TRUNCATION_MARKER = '\n[output truncated]\n';
const REDACTION_MARKER = '[REDACTED]';
const SECRET_ENV_NAME = /(api[_-]?key|token|secret|password|authorization|credential)/i;

function addSecretValues(target, value) {
  if (typeof value === 'string') {
    if (value) target.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) addSecretValues(target, item);
    return;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) addSecretValues(target, item);
  }
}

function configuredSecretValues() {
  try {
    const { config } = require('../../config');
    return [
      config?.openai?.apiKey,
      config?.openrouter?.apiKey,
      config?.tavily?.apiKey
    ].filter(value => typeof value === 'string' && value);
  } catch {
    return [];
  }
}

function collectSecretValues(environment, suppliedSecrets) {
  const values = configuredSecretValues();
  addSecretValues(values, suppliedSecrets);

  for (const [name, value] of Object.entries(environment)) {
    if (SECRET_ENV_NAME.test(name) && typeof value === 'string' && value) {
      values.push(value);
    }
  }

  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

class StreamingRedactor {
  constructor(secrets) {
    this.secrets = secrets;
    this.pending = '';
    this.redacted = false;
  }

  push(chunk, final = false) {
    const input = this.pending + String(chunk);
    let output = '';
    let index = 0;

    while (index < input.length) {
      const match = this.secrets.find(secret => input.startsWith(secret, index));
      if (match) {
        output += REDACTION_MARKER;
        index += match.length;
        this.redacted = true;
        continue;
      }

      const remaining = input.slice(index);
      if (!final && this.secrets.some(secret => secret.startsWith(remaining))) break;

      output += input[index];
      index += 1;
    }

    this.pending = input.slice(index);
    return output;
  }

  flush() {
    return this.push('', true);
  }
}

function redactText(value, secrets) {
  const redactor = new StreamingRedactor(secrets);
  return {
    text: redactor.push(String(value), true),
    redacted: redactor.redacted
  };
}

function utf8Prefix(value, byteLimit) {
  if (byteLimit <= 0) return '';
  const buffer = Buffer.from(value);
  if (buffer.length <= byteLimit) return value;

  return buffer.subarray(0, byteLimit).toString('utf8').replace(/\uFFFD$/, '');
}

class BoundedOutput {
  constructor(limitBytes) {
    this.limitBytes = limitBytes;
    this.values = { stdout: '', stderr: '' };
    this.bytes = 0;
    this.truncated = false;
  }

  append(stream, value) {
    if (!value) return;

    const available = this.limitBytes - this.bytes;
    const valueBytes = Buffer.byteLength(value);
    if (valueBytes <= available) {
      this.values[stream] += value;
      this.bytes += valueBytes;
      return;
    }

    this.truncated = true;
    if (available > 0) {
      const prefix = utf8Prefix(value, available);
      this.values[stream] += prefix;
      this.bytes += Buffer.byteLength(prefix);
    }
  }

  result() {
    const marker = this.truncated ? utf8Prefix(TRUNCATION_MARKER, this.limitBytes) : '';
    let remaining = Math.max(0, this.limitBytes - Buffer.byteLength(marker));
    const stdout = utf8Prefix(this.values.stdout, remaining);
    remaining -= Buffer.byteLength(stdout);
    const stderr = utf8Prefix(this.values.stderr, remaining);
    return { stdout, stderr, output: stdout + stderr + marker };
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function killProcessTree(child) {
  if (!child?.pid) return null;

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    });
    killer.once('error', () => {
      try {
        child.kill();
      } catch {}
    });
    return null;
  }

  const kill = signal => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {}
    }
  };

  kill('SIGTERM');
  return setTimeout(() => kill('SIGKILL'), 250);
}

/**
 * Execute a non-interactive command using the host's default shell.
 *
 * @param {object|string} commandOrOptions Options, or the command string.
 * @param {string} commandOrOptions.command Command passed to the host shell.
 * @param {string} [commandOrOptions.cwd=process.cwd()] Working directory.
 * @param {number} [commandOrOptions.timeoutMs=600000] Hard timeout.
 * @param {number} [commandOrOptions.maxOutputBytes=1048576] Combined result cap.
 * @param {AbortSignal} [commandOrOptions.signal] Cancellation signal.
 * @param {(event: object) => void} [commandOrOptions.onEvent] Sanitized event callback.
 * @param {string[]|object} [commandOrOptions.secrets] Additional values to redact.
 * @param {object} [commandOrOptions.env] Environment values to add or override.
 * @param {object} [additionalOptions] Options when the first argument is a string.
 * @returns {Promise<object>} Structured command result.
 */
function executeShell(commandOrOptions, additionalOptions = {}) {
  const options = typeof commandOrOptions === 'string'
    ? { ...additionalOptions, command: commandOrOptions }
    : (commandOrOptions || {});
  const command = options.command;

  if (typeof command !== 'string' || command.length === 0) {
    return Promise.reject(new TypeError('command must be a non-empty string'));
  }

  const cwd = options.cwd === undefined ? process.cwd() : options.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return Promise.reject(new TypeError('cwd must be a non-empty string'));
  }

  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const outputLimit = positiveNumber(
    options.maxOutputBytes ?? options.outputLimitBytes,
    DEFAULT_OUTPUT_LIMIT_BYTES
  );
  const environment = options.env
    ? { ...process.env, ...options.env }
    : { ...process.env };
  const secrets = collectSecretValues(
    environment,
    options.secrets ?? options.secretValues
  );
  const output = new BoundedOutput(outputLimit);
  const stdoutRedactor = new StreamingRedactor(secrets);
  const stderrRedactor = new StreamingRedactor(secrets);
  let otherRedaction = false;

  const emit = event => {
    if (typeof options.onEvent !== 'function') return;
    try {
      options.onEvent(event);
    } catch {}
  };

  const createResult = ({ status, exitCode = null, signal = null, error = null }) => {
    const safeError = error ? redactText(error, secrets) : { text: null, redacted: false };
    const retained = output.result();
    otherRedaction ||= safeError.redacted;
    return {
      status,
      ok: status === 'succeeded',
      exitCode,
      signal,
      timedOut: status === 'timed_out',
      cancelled: status === 'cancelled',
      truncated: output.truncated,
      redacted: stdoutRedactor.redacted || stderrRedactor.redacted || otherRedaction,
      stdout: retained.stdout,
      stderr: retained.stderr,
      output: retained.output,
      error: safeError.text
    };
  };

  if (options.signal?.aborted) {
    const result = createResult({ status: 'cancelled', error: 'Command cancelled' });
    emit({ type: 'status', ...result });
    return Promise.resolve(result);
  }

  return new Promise(resolve => {
    let child;
    let spawnError = null;
    let terminationReason = null;
    let timeout;
    let forceKillTimer = null;
    let settled = false;

    const stream = (type, redactor, value) => {
      const data = redactor.push(value);
      if (!data) return;
      output.append(type, data);
      emit({ type, data });
    };

    const flush = (type, redactor) => {
      const data = redactor.flush();
      if (!data) return;
      output.append(type, data);
      emit({ type, data });
    };

    const stop = reason => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      forceKillTimer = killProcessTree(child);
    };

    const onAbort = () => stop('cancelled');

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      options.signal?.removeEventListener('abort', onAbort);
      flush('stdout', stdoutRedactor);
      flush('stderr', stderrRedactor);

      let result;
      if (spawnError) {
        result = createResult({
          status: 'spawn_error',
          signal,
          error: `Unable to start command: ${spawnError.message}`
        });
      } else if (terminationReason === 'timed_out') {
        result = createResult({
          status: 'timed_out',
          exitCode,
          signal,
          error: `Command timed out after ${timeoutMs}ms`
        });
      } else if (terminationReason === 'cancelled') {
        result = createResult({
          status: 'cancelled',
          exitCode,
          signal,
          error: 'Command cancelled'
        });
      } else {
        result = createResult({
          status: exitCode === 0 ? 'succeeded' : 'failed',
          exitCode,
          signal
        });
      }

      emit({ type: 'status', ...result });
      resolve(result);
    };

    try {
      child = spawn(command, {
        cwd,
        env: environment,
        shell: true,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', value => stream('stdout', stdoutRedactor, value));
    child.stderr.on('data', value => stream('stderr', stderrRedactor, value));
    child.once('error', error => {
      spawnError = error;
    });
    child.once('close', finish);

    emit({ type: 'status', status: 'running', pid: child.pid });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    timeout = setTimeout(() => stop('timed_out'), timeoutMs);
  });
}

module.exports = {
  executeShell
};
