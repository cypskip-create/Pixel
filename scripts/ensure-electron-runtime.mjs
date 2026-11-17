import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  throw new Error('ensure:electron-runtime is a Windows CI check and must run on Windows.');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronPackage = resolve(root, 'node_modules', 'electron');
const packageJson = JSON.parse(readFileSync(resolve(electronPackage, 'package.json'), 'utf8'));
const executable = resolve(electronPackage, 'dist', 'electron.exe');
const installer = resolve(electronPackage, 'install.js');

function readRuntimeVersion() {
  if (!existsSync(executable)) return null;
  // Electron's --version prints its bundled Node version. In Electron's
  // documented Node mode, process.versions.electron reports the actual runtime.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const result = spawnSync(executable, ['-e', 'process.stdout.write(process.versions.electron ?? "")'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

if (readRuntimeVersion() !== packageJson.version) {
  if (!existsSync(installer)) throw new Error(`Electron install script not found: ${installer}`);
  console.log(`[electron-runtime] Electron ${packageJson.version} is missing or mismatched; running its locked install script.`);
  const install = spawnSync(process.execPath, [installer], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (install.error) throw install.error;
  if (install.status !== 0) throw new Error(`Electron install script exited with ${String(install.status)}.`);
}

if (!existsSync(executable)) throw new Error(`Electron install script completed without creating ${executable}`);
const reported = readRuntimeVersion();
if (reported !== packageJson.version) {
  throw new Error(`Electron runtime verification failed. Expected ${packageJson.version}; got ${JSON.stringify(reported)}`);
}

console.log(`[electron-runtime] Verified Electron ${reported} at ${executable}`);
