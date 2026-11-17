import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronExe = resolve(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const smokeApp = resolve(projectRoot, 'scripts', 'preload-smoke');
const artifactDir = resolve(projectRoot, 'artifacts', 'windows-acceptance');
const reportPath = resolve(artifactDir, 'preload-sandbox-smoke.json');
const logPath = resolve(artifactDir, 'preload-sandbox-smoke.log');

mkdirSync(artifactDir, { recursive: true });
if (!existsSync(electronExe)) {
  throw new Error(`Electron executable not found at ${electronExe}. Install Electron before running this test.`);
}

const env = { ...process.env, CYPS_PRELOAD_SMOKE_RESULT: reportPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExe, ['--disable-gpu', smokeApp], {
  cwd: projectRoot,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });

const exitCode = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    writeFileSync(logPath, output, 'utf8');
    child.kill();
    reject(new Error(`Electron sandbox smoke test timed out. See ${logPath}`));
  }, 45_000);
  child.once('error', (error) => {
    clearTimeout(timeout);
    writeFileSync(logPath, output, 'utf8');
    reject(error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    writeFileSync(logPath, output, 'utf8');
    if (signal) reject(new Error(`Electron sandbox smoke test exited on ${signal}. See ${logPath}`));
    else resolveExit(code ?? 1);
  });
});

writeFileSync(logPath, output, 'utf8');
if (exitCode !== 0) {
  throw new Error(`Electron sandbox smoke test exited with ${exitCode}. See ${logPath}\n${output.slice(-3000)}`);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (!report.ok) throw new Error(`Electron sandbox smoke test reported failure. See ${reportPath}`);
console.log(`Electron sandbox preload smoke passed. Report: ${reportPath}`);
console.log(`Electron output: ${logPath}`);
console.log(JSON.stringify(report, null, 2));
