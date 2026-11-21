import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRendererServer } from './dev-renderer.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCli = process.env.npm_execpath;
const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const gpuEnabled = process.argv.includes('--gpu');
const startedChildren = new Set();
let shuttingDown = false;

if (!npmCli || !existsSync(electronExe)) {
  throw new Error('Pixel development dependencies are incomplete. Run npm install before npm run dev.');
}

function runNpm(script) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [npmCli, 'run', script], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    startedChildren.add(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      startedChildren.delete(child);
      if (signal) reject(new Error(`${script} stopped on ${signal}.`));
      else if (code !== 0) reject(new Error(`${script} exited with code ${String(code)}.`));
      else resolveExit();
    });
  });
}

function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of startedChildren) {
    try { child.kill(); } catch { /* the child may already have exited */ }
  }
}

process.once('SIGINT', stopChildren);
process.once('SIGTERM', stopChildren);

let electron;
let renderer;
try {
  await runNpm('build:main');
  await runNpm('build:native');

  renderer = await startRendererServer(root);
  const rendererUrl = renderer.url;
  console.log(`[dev] Pixel renderer is listening at ${rendererUrl}`);
  if (shuttingDown) process.exitCode = 130;
  else {
    const args = gpuEnabled ? [] : ['--disable-gpu'];
    electron = spawn(electronExe, [...args, '.'], {
      cwd: root,
      env: {
        ...process.env,
        CYPS_DEV: '1',
        CYPS_DEV_SERVER_URL: rendererUrl,
      },
      stdio: 'inherit',
      windowsHide: false,
    });
    startedChildren.add(electron);
    electron.once('error', (error) => {
      console.error(`[dev] Electron could not start: ${error.message}`);
      process.exitCode = 1;
      stopChildren();
    });
    electron.once('exit', (code, signal) => {
      startedChildren.delete(electron);
      if (signal) {
        console.error(`[dev] Electron exited after signal ${signal}.`);
        process.exitCode = 1;
      } else {
        process.exitCode = code ?? 1;
        if (code !== 0) console.error(`[dev] Electron exited with code ${String(code)}.`);
      }
      stopChildren();
    });
    await waitForExit(electron);
  }
} finally {
  stopChildren();
  await renderer?.server.close();
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once('exit', resolveExit);
  });
}

