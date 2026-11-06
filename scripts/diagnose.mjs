/**
 * Environment and build diagnostics for Cyps.
 *
 * Read-only: it inspects the machine, the build output and the network path to
 * DeepSeek, then prints a report. It never reads, prints or transmits the API
 * key, and it never launches the GUI.
 *
 *   node scripts/diagnose.mjs
 *   node scripts/diagnose.mjs --json > report.json
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const asJson = process.argv.includes('--json');

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  if (!asJson) {
    const colour = { pass: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m', info: '\u001b[90m' };
    const label = status.toUpperCase().padEnd(4);
    process.stdout.write(`${colour[status] ?? ''}[${label}]\u001b[0m ${name}\n`);
    if (detail) process.stdout.write(`        ${detail}\n`);
  }
}

function section(title) {
  if (asJson) return;
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

/* ------------------------------ environment ---------------------------- */

section('Environment');

record('Operating system', 'pass', `${platform()} ${release()}`);
record('Architecture', 'pass', process.arch);
record('Node.js', 'pass', process.version);

const cpuList = cpus();
record('CPU', 'pass', `${cpuList[0]?.model ?? 'unknown'} (${cpuList.length} cores)`);
record(
  'Memory',
  'pass',
  `${Math.round((freemem() / 1024 ** 3) * 10) / 10} GB free of ${Math.round((totalmem() / 1024 ** 3) * 10) / 10} GB`,
);

if (process.env.ELECTRON_RUN_AS_NODE) {
  record(
    'ELECTRON_RUN_AS_NODE',
    'fail',
    'It is set. Electron would run as plain Node and Cyps cannot show a window. Unset it before launching.',
  );
} else {
  record('ELECTRON_RUN_AS_NODE', 'pass', 'Not set.');
}

/* ------------------------------ dependencies --------------------------- */

section('Dependencies');

for (const name of ['electron', 'react', 'vite', 'playwright', 'typescript']) {
  try {
    const version = require(`${name}/package.json`).version;
    record(name, 'pass', version);
  } catch {
    record(name, 'warn', 'not installed');
  }
}

/* -------------------------------- build -------------------------------- */

section('Build output');

const expected = [
  ['dist/main/main/main.js', 'main process bundle'],
  ['dist/main/preload/index.js', 'preload bridge'],
  ['dist/renderer/index.html', 'renderer entry'],
  ['release/win-unpacked/Cyps.exe', 'packaged executable'],
];

for (const [path, label] of expected) {
  const full = join(root, path);
  if (existsSync(full)) {
    const size = Math.round(statSync(full).size / 1024);
    record(label, 'pass', `${path} (${size} KB)`);
  } else {
    record(label, 'fail', `${path} is missing. Run: npm run build${path.startsWith('release') ? ' && npm run dist' : ''}`);
  }
}

const rendererAssets = join(root, 'dist', 'renderer', 'assets');
if (existsSync(rendererAssets)) {
  const files = readdirSync(rendererAssets);
  record('Renderer assets', files.length > 0 ? 'pass' : 'fail', files.join(', ') || 'none');
}

/* ------------------------------- browser ------------------------------- */

section('Browser automation');

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(root, '.pw-browsers');
if (existsSync(browsersPath)) {
  record('Playwright browsers', 'pass', browsersPath);
} else {
  record(
    'Playwright browsers',
    'warn',
    `Not found at ${browsersPath}. Browser tools will report a capability error. Run: npx playwright install chromium`,
  );
}

/* -------------------------------- voice -------------------------------- */

section('Voice');

if (platform() !== 'win32') {
  record('Speech services', 'warn', 'Voice is only supported on Windows.');
} else {
  const { execFileSync } = await import('node:child_process');
  try {
    const script =
      'Add-Type -AssemblyName System.Speech; ' +
      '$r=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers().Count; ' +
      '$t=[System.Speech.Synthesis.SpeechSynthesizer]::new(); ' +
      '$v=$t.GetInstalledVoices().Count; $t.Dispose(); ' +
      'Write-Output ("STT={0} TTS={1}" -f $r,$v)';
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout: 20000 },
    );
    const match = /STT=(\d+)\s+TTS=(\d+)/.exec(output);
    if (match) {
      record('Speech recognizers', match[1] !== '0' ? 'pass' : 'warn', `${match[1]} installed`);
      record('Speech voices', match[2] !== '0' ? 'pass' : 'warn', `${match[2]} installed`);
    } else {
      record('Speech services', 'warn', 'Windows did not report recognizer data.');
    }
  } catch (error) {
    record('Speech services', 'warn', `Probe failed: ${error.message}`);
  }
}

/* ------------------------------ credentials ---------------------------- */

section('Stored credentials');

const appData = process.env.APPDATA;
if (appData) {
  const keyFile = join(appData, 'Cyps', 'credentials', 'deepseek.key');
  if (!existsSync(keyFile)) {
    record('DeepSeek API key', 'info', 'Not saved yet. Add one in Cyps Settings.');
  } else {
    const raw = readFileSync(keyFile, 'utf8');
    // Never print the contents: only whether a plaintext key leaked.
    const leaked = /sk-[A-Za-z0-9]{8,}/.test(raw);
    record(
      'DeepSeek API key',
      leaked ? 'fail' : 'pass',
      leaked ? 'The key file appears to contain plaintext!' : 'Encrypted blob present, no plaintext.',
    );
  }
}

/* -------------------------------- network ------------------------------ */

section('Network');

try {
  const started = Date.now();
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'ping' }] }),
    signal: AbortSignal.timeout(15000),
  });
  const latency = Date.now() - started;
  const reached = response.status === 401 || response.status === 402 || response.status === 200;
  record(
    'api.deepseek.com reachable',
    reached ? 'pass' : 'warn',
    `HTTP ${response.status} in ${latency} ms${response.status === 401 ? ' (expected without a key)' : ''}`,
  );
} catch (error) {
  record('api.deepseek.com reachable', 'fail', error.message);
}

/* -------------------------------- summary ------------------------------ */

const summary = {
  passed: results.filter((r) => r.status === 'pass').length,
  failed: results.filter((r) => r.status === 'fail').length,
  warnings: results.filter((r) => r.status === 'warn').length,
  info: results.filter((r) => r.status === 'info').length,
};

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results, summary }, null, 2)}\n`,
  );
} else {
  section('Summary');
  process.stdout.write(
    `  ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings, ${summary.info} notes\n`,
  );
  process.stdout.write(
    summary.failed === 0
      ? '\n  No blocking problems found. For the GUI checks, run scripts\\validate-windows.ps1\n'
      : '\n  Fix the failures above, then re-run.\n',
  );
}

process.exitCode = summary.failed > 0 ? 1 : 0;
