import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [pythonArg, workerArg] = process.argv.slice(2);
if (!pythonArg || !workerArg) {
  console.error('Usage: node scripts/smoke-voice-dev-worker.mjs <python.exe> <worker.py>');
  process.exit(2);
}

const child = spawn(resolve(pythonArg), ['-u', resolve(workerArg)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const frames = [
  { id: 'capabilities', op: 'capabilities', protocol: 1, params: {} },
  { id: 'shutdown', op: 'shutdown', protocol: 1, params: {} },
];
let output = '';
let errors = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 1_000_000) child.kill(); });
child.stderr.on('data', (chunk) => { errors += chunk; if (errors.length > 32_000) errors = errors.slice(-32_000); });
const timer = setTimeout(() => child.kill(), 30_000);
try {
  child.stdin.end(`${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`, 'utf8');
  const [code] = await new Promise((resolveClose, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolveClose([exitCode, signal]));
  });
  if (code !== 0) throw new Error(`Worker exited with code ${String(code)}. ${errors.trim()}`);
  const rows = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const caps = rows[0]?.result;
  if (rows.length !== 2 || rows.some((row, index) => row.id !== frames[index].id || row.ok !== true) ||
      caps?.protocol !== 1 || caps?.optional?.faster_whisper !== true || caps?.optional?.kokoro_onnx !== true) {
    throw new Error(`Unexpected worker capability response: ${output.trim()}`);
  }
  console.log(`[voice-dev-smoke] JSONL protocol 1 OK; Python ${caps.python}; faster-whisper and Kokoro available.`);
} catch (error) {
  console.error(`[voice-dev-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
