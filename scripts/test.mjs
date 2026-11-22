import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localBrowserCache = join(root, '.pw-browsers');

function cachedChromiumPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return null;

  try {
    const manifestPath = join(root, 'node_modules', 'playwright-core', 'browsers.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const browser = manifest.browsers?.find((entry) => entry.name === 'chromium-headless-shell');
    if (!browser?.revision) return null;

    const directory = join(localBrowserCache, `${browser.name.replaceAll('-', '_')}-${browser.revision}`);
    const executableDirectory = process.platform === 'win32'
      ? 'chrome-headless-shell-win64'
      : process.platform === 'linux'
        ? 'chrome-headless-shell-linux64'
        : process.platform === 'darwin'
          ? `chrome-headless-shell-mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
          : null;
    if (!executableDirectory) return null;

    const executable = join(directory, executableDirectory, `chrome-headless-shell${process.platform === 'win32' ? '.exe' : ''}`);
    const installMarker = join(directory, 'INSTALLATION_COMPLETE');
    return existsSync(installMarker) && existsSync(executable) ? localBrowserCache : null;
  } catch {
    return null;
  }
}

const browserCache = cachedChromiumPath();
if (browserCache) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
  console.log(`[test] using the matching repository Playwright cache: ${browserCache}`);
}

const args = process.argv.slice(2);
const watchMode = args.includes('--watch') || args.includes('-w');
const vitestCli = join(root, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestCli, ...(watchMode ? [] : ['run']), ...args], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not start Vitest: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
