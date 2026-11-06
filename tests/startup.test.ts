import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the startup diagnostics.
 *
 * These lock in the structural fixes for the silent-startup failure: the entry
 * point must log before anything else loads, the boot logger must stay free of
 * Electron, and the self-check must be able to report without a window.
 *
 * They are source-shape assertions on purpose - the failure they prevent is a
 * module-loading order problem, which no behavioural test can observe after the
 * fact in this environment.
 */

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const mainSource = read('src/main/main.ts');
const appSource = read('src/main/app.ts');
const bootSource = read('src/main/startup/boot.ts');
const selfCheckSource = read('src/main/startup/selfcheck.ts');

describe('entry point ordering', () => {
  it('imports the boot logger before anything else', () => {
    const imports = mainSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));
    expect(imports[0]).toContain('./startup/boot');
  });

  it('starts logging before importing the application', () => {
    const bootIndex = mainSource.indexOf('boot.begin()');
    const appImportIndex = mainSource.indexOf("import('./app')");
    expect(bootIndex).toBeGreaterThan(-1);
    expect(appImportIndex).toBeGreaterThan(bootIndex);
  });

  it('loads the application dynamically so import failures are logged', () => {
    expect(mainSource).toMatch(/await\s+import\('\.\/app'\)/);
    // A static import of the app would run before boot.begin().
    expect(mainSource).not.toMatch(/^import .* from '\.\/app';$/m);
  });

  it('records a failed startup instead of exiting silently', () => {
    expect(mainSource).toContain('boot.fatal(error)');
    expect(mainSource).toContain('process.exit');
  });

  it('supports a self-check that needs no window', () => {
    expect(mainSource).toContain('--pixel-selfcheck');
  });

  it('exports start() from the application module', () => {
    expect(appSource).toContain('export async function start()');
  });

  it('runs the single-instance lock only after logging exists', () => {
    const lockIndex = appSource.indexOf('requestSingleInstanceLock');
    const logIndex = appSource.indexOf('boot.stage');
    expect(lockIndex).toBeGreaterThan(-1);
    // The lock lives inside start(), which is called after boot.begin().
    expect(logIndex).toBeGreaterThan(-1);
    expect(appSource.indexOf('boot.stage')).toBeLessThan(lockIndex);
  });
});

describe('boot logger', () => {
  it('uses only Node built-ins, so it works before Electron exists', () => {
    const imports = bootSource
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('import '));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).toMatch(/from 'node:/);
    }
  });

  it('records uncaught exceptions, rejections and the exit code', () => {
    expect(bootSource).toContain("process.on('uncaughtException'");
    expect(bootSource).toContain("process.on('unhandledRejection'");
    expect(bootSource).toContain("process.on('exit'");
  });

  it('writes an exit marker so a crash leaves evidence', () => {
    expect(bootSource).toContain('pixel-last-exit.json');
  });

  it('tries several locations in case the profile directory is unwritable', () => {
    expect(bootSource).toContain('tmpdir()');
    expect(bootSource).toContain('APPDATA');
  });

  it('mirrors every line to stderr as a fallback', () => {
    expect(bootSource).toContain('process.stderr.write');
  });
});

describe('self-check', () => {
  it('is free to import Electron late, so it can report a failed Electron start', () => {
    // A direct require is required: the __importStar wrapper loses Electron's API.
    expect(selfCheckSource).toContain("require('electron')");
    expect(selfCheckSource).not.toContain("await import('electron')");
  });

  it('resolves the bundle directory one level above the startup module', () => {
    expect(selfCheckSource).toContain("join(__dirname, '..')");
  });

  it('checks the preload and renderer, not just the main bundle', () => {
    expect(selfCheckSource).toContain("'preload'");
    expect(selfCheckSource).toContain("'renderer'");
    expect(selfCheckSource).toContain('index.html');
  });

  it('names ELECTRON_RUN_AS_NODE as a cause when it is set', () => {
    expect(selfCheckSource).toContain('ELECTRON_RUN_AS_NODE');
  });

  it('persists its report next to the log, because GUI stdout is unreliable', () => {
    expect(selfCheckSource).toContain('pixel-selfcheck.json');
    expect(selfCheckSource).toContain('writeFileSync');
  });
});
