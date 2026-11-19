import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROTOCOL_VERSION = 1;
const SMOKE_ID = 'pixel-runtime-smoke';
const CAPABILITIES_ID = 'pixel-capabilities-smoke';
const SHUTDOWN_ID = 'pixel-shutdown-smoke';
const REQUEST_TIMEOUT_MS = 90_000;
const TERMINATION_GRACE_MS = 3_000;

export function buildRequestFrames() {
  const requests = [
    { id: SMOKE_ID, op: 'runtime_smoke_test', protocol: PROTOCOL_VERSION, params: { encodingProbe: 'Pixel — café' } },
    { id: CAPABILITIES_ID, op: 'capabilities', protocol: PROTOCOL_VERSION, params: {} },
    { id: SHUTDOWN_ID, op: 'shutdown', protocol: PROTOCOL_VERSION, params: {} },
  ];
  // ASCII-only fixture JSON, explicit UTF-8, newline-delimited, and no BOM.
  return Buffer.from(`${requests.map((request) => JSON.stringify(request)).join('\n')}\n`, 'utf8');
}

export function validateResponses(lines) {
  if (!Array.isArray(lines) || lines.length !== 3) {
    throw new Error(`Expected 3 newline-delimited protocol responses; received ${Array.isArray(lines) ? lines.length : 'invalid output'}.`);
  }

  let responses;
  try {
    responses = lines.map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error(`Worker stdout was not valid JSON Lines: ${error instanceof Error ? error.message : String(error)}`);
  }

  const [smoke, capabilities, shutdown] = responses;
  for (const [response, expectedId] of [
    [smoke, SMOKE_ID],
    [capabilities, CAPABILITIES_ID],
    [shutdown, SHUTDOWN_ID],
  ]) {
    if (!response || response.id !== expectedId || response.ok !== true || !response.result || typeof response.result !== 'object') {
      throw new Error(`Worker returned an invalid response for ${expectedId}: ${JSON.stringify(response)}`);
    }
  }

  const runtime = smoke.result;
  if (runtime.protocol !== PROTOCOL_VERSION ||
      !Array.isArray(runtime.onnxProviders) || !runtime.onnxProviders.includes('CPUExecutionProvider') ||
      runtime.onnxCpuProvider !== true || runtime.fasterWhisper !== true ||
      runtime.kokoro !== true || runtime.espeakReady !== true) {
    throw new Error(`Packaged runtime capability response is incomplete: ${JSON.stringify(runtime)}`);
  }

  const caps = capabilities.result;
  if (caps.protocol !== PROTOCOL_VERSION || typeof caps.python !== 'string' ||
      !/^3\.12\./.test(caps.python) || !Array.isArray(caps.formats) ||
      !caps.formats.every((format) => typeof format === 'string') ||
      !caps.optional || typeof caps.optional !== 'object' || Array.isArray(caps.optional) ||
      !Object.entries(caps.optional).every(([name, available]) => typeof name === 'string' && typeof available === 'boolean')) {
    throw new Error(`Packaged worker capabilities response has an unexpected shape: ${JSON.stringify(caps)}`);
  }

  if (shutdown.result.bye !== true) {
    throw new Error(`Packaged worker did not acknowledge shutdown: ${JSON.stringify(shutdown)}`);
  }
  return { runtime, capabilities: caps };
}

function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveClose) => {
    const onClose = () => {
      clearTimeout(timer);
      resolveClose(true);
    };
    const timer = setTimeout(() => {
      child.off('close', onClose);
      resolveClose(false);
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  child.kill();
  if (await waitForChildClose(child, TERMINATION_GRACE_MS)) return;

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolveKill) => {
      killer.once('error', resolveKill);
      killer.once('close', resolveKill);
    });
    await waitForChildClose(child, TERMINATION_GRACE_MS);
  }
}

export async function runWorkerProtocolSmoke(executable, workerArgs = [], timeoutMs = REQUEST_TIMEOUT_MS) {
  const workerPath = resolve(executable);
  const child = spawn(workerPath, workerArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= 1_000_000) stdoutChunks.push(Buffer.from(chunk));
    else { outputLimitExceeded = true; void terminate(child); }
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 128_000) stderrChunks.push(Buffer.from(chunk));
  });

  const frames = buildRequestFrames();
  const frameHex = frames.toString('hex');
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminate(child);
  }, timeoutMs);
  timeout.unref?.();

  try {
    const closed = new Promise((resolveClose, rejectClose) => {
      child.once('error', rejectClose);
      child.once('close', (code, signal) => resolveClose({ code, signal }));
    });
    child.stdin.on('error', () => { /* close/exit provides the useful failure */ });
    child.stdin.end(frames);

    const exit = await closed;
    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    if (timedOut) throw new Error(`Timed out after ${timeoutMs} ms. stderr: ${stderr || '(empty)'}`);
    if (outputLimitExceeded) throw new Error('Worker exceeded the 1 MB stdout limit.');
    if (exit.code !== 0) throw new Error(`Worker exited with code ${String(exit.code)} (signal ${String(exit.signal)}). stderr: ${stderr || '(empty)'}`);

    const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
    const result = validateResponses(lines);
    return { ...result, frameBytes: frames.length, frameHex };
  } catch (error) {
    await terminate(child);
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}${stderr ? `\nworker stderr:\n${stderr}` : ''}`);
  } finally {
    clearTimeout(timeout);
  }
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (scriptPath && import.meta.url === pathToFileURL(scriptPath).href) {
  const executable = process.argv[2];
  if (!executable || !isAbsolute(executable)) {
    console.error('Usage: node scripts/smoke-frozen-voice-worker.mjs <absolute-worker-executable>');
    process.exitCode = 2;
  } else {
    try {
      const result = await runWorkerProtocolSmoke(executable);
      console.log(`[voice-worker-smoke] request bytes=${result.frameBytes}; UTF-8 hex=${result.frameHex}`);
      console.log(`[voice-worker-smoke] protocol ${PROTOCOL_VERSION}; Python ${result.capabilities.python}; ONNX CPU, faster-whisper, Kokoro and eSpeak passed.`);
    } catch (error) {
      const frames = buildRequestFrames();
      console.error(`[voice-worker-smoke] request bytes=${frames.length}; UTF-8 hex=${frames.toString('hex')}`);
      console.error(`[voice-worker-smoke] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
