/**
 * Self-check.
 *
 * Answers "does this build actually work on this machine?" without needing a
 * window, a GPU, or a desktop session. It verifies the things that silently
 * break a packaged Electron app:
 *
 *  - the compiled main bundle and its path assumptions;
 *  - the preload script the window will load;
 *  - the renderer entry file Vite produced;
 *  - that Electron itself initialises and reports its paths;
 *  - that the user-data directory is writable;
 *  - what the boot log recorded so far.
 *
 * Run it with:  Pixel.exe --pixel-selfcheck
 * Output is JSON on stdout, plus a human summary on stderr, so it can be read by
 * a person or parsed by scripts/capture-startup.ps1.
 */

import { existsSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { boot } from './boot';
import { APP_NAME } from './user-data';

export interface FileCheck {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  detail?: string;
}

export interface SelfCheckReport {
  ok: boolean;
  at: string;
  platform: string;
  arch: string;
  pid: number;
  versions: {
    node: string;
    electron: string | null;
    chrome: string | null;
  };
  paths: {
    execPath: string;
    /** Directory holding the compiled main bundle. */
    mainBundleDir: string;
    userData: string | null;
    log: string;
  };
  files: FileCheck[];
  electron: {
    initialised: boolean;
    error: string | null;
  };
  userDataWritable: boolean | null;
  bootStages: string[];
  problems: string[];
  /** Where this report was persisted, for the diagnostic script. */
  reportPath?: string;
}

/** Directories the packaged bundle must contain, relative to the main bundle. */
const REQUIRED_FILES: Array<{ name: string; path: (mainDir: string) => string }> = [
  {
    name: 'main bundle',
    path: (mainDir) => join(mainDir, 'main.js'),
  },
  {
    name: 'preload bridge',
    path: (mainDir) => join(mainDir, '..', 'preload', 'index.js'),
  },
  {
    name: 'renderer entry',
    path: (mainDir) => join(mainDir, '..', '..', 'renderer', 'index.html'),
  },
  {
    name: 'renderer bundle',
    path: (mainDir) => join(mainDir, '..', '..', 'renderer', 'assets'),
  },
];

/**
 * Directory holding the compiled main bundle.
 *
 * This module lives in `<dist>/main/main/startup/`, so the bundle directory is
 * one level up. Getting this wrong made the self-check report every file as
 * missing; the fix is asserted by tests/startup.test.ts against the real build.
 */
function mainBundleDir(): string {
  return join(__dirname, '..');
}

function inspectFile(name: string, path: string): FileCheck {
  try {
    const stats = statSync(path);
    return {
      name,
      path,
      exists: true,
      sizeBytes: stats.isDirectory() ? null : stats.size,
    };
  } catch {
    return {
      name,
      path,
      exists: false,
      sizeBytes: null,
      detail: 'missing - the packaged application is incomplete',
    };
  }
}

/** Check the user-data directory by writing and removing a probe file. */
function probeUserData(userData: string): { writable: boolean; detail?: string } {
  const probe = join(userData, '.pixel-selfcheck');
  try {
    mkdirSync(userData, { recursive: true });
    writeFileSync(probe, 'ok', 'utf8');
    unlinkSync(probe);
    return { writable: true };
  } catch (error) {
    return { writable: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runSelfCheck(): Promise<SelfCheckReport> {
  const problems: string[] = [];
  const mainDir = mainBundleDir();

  const files = REQUIRED_FILES.map((entry) => inspectFile(entry.name, entry.path(mainDir)));
  for (const file of files) {
    if (!file.exists) problems.push(`${file.name} is missing at ${file.path}`);
  }
  if (!existsSync(join(mainDir, 'main.js'))) {
    problems.push(`the process is not running the expected bundle (looked in ${mainDir})`);
  }

  let electronInitialised = false;
  let electronError: string | null = null;
  let userData: string | null = null;

  /*
   * A globally-set ELECTRON_RUN_AS_NODE makes the executable behave as plain
   * Node: no Chromium, no window, and `require('electron')` returns the npm
   * path helper instead of the API. That failure is silent from the outside, so
   * name it explicitly before blaming anything else.
   */
  const nodeMode = process.env.ELECTRON_RUN_AS_NODE === '1';
  if (nodeMode) {
    electronError =
      'ELECTRON_RUN_AS_NODE is set, so this process is running as plain Node and cannot create a window';
    problems.push(electronError);
  }

  try {
    /*
     * Loaded with a direct `require` on purpose. A dynamic `import('electron')`
     * compiles to a `__importStar` wrapper, which copies own property names onto
     * a fresh object; Electron's API export does not survive that copy, so
     * `app` came back undefined and the self-check reported a false negative.
     * This file is compiled to CommonJS and runs in the main process, where
     * `require('electron')` returns the real API.
     */
    const electronModule: typeof import('electron') = require('electron') as typeof import('electron');
    const app = electronModule.app;
    electronInitialised = typeof app?.getVersion === 'function';
    if (electronInitialised && app) {
      // Resolve the same data directory the app will use.
      const roaming = app.getPath('appData');
      userData = join(roaming, APP_NAME);
      app.setPath('userData', userData);
    } else {
      electronError = 'the electron module did not expose an app object';
      problems.push(`Electron could not initialise: ${electronError}`);
    }
  } catch (error) {
    electronError = error instanceof Error ? error.message : String(error);
    problems.push(`Electron could not initialise: ${electronError}`);
  }

  let userDataWritable: boolean | null = null;
  if (userData) {
    const probe = probeUserData(userData);
    userDataWritable = probe.writable;
    if (!probe.writable) {
      problems.push(
        `user data is not writable: ${probe.detail ?? userData}. Settings and the API key cannot be saved.`,
      );
    }

    // The boot log falls back to %TEMP% or the working directory when %APPDATA%
    // cannot be written. That is legitimate, but it means a person looking only
    // in %APPDATA%\Pixel would conclude "no log at all", so surface it.
    const logInAppData = boot.logPath.toLowerCase().startsWith(userData.toLowerCase());
    if (!logInAppData && probe.writable) {
      problems.push(
        `the startup log is not in the user data directory (${boot.logPath}); unexpected ordering during boot.`,
      );
    }
  } else if (electronInitialised) {
    userDataWritable = false;
  }

  const report: SelfCheckReport = {
    ok: problems.length === 0,
    at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    versions: {
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
    },
    paths: {
      execPath: process.execPath,
      mainBundleDir: mainDir,
      userData,
      log: boot.logPath,
    },
    files,
    electron: { initialised: electronInitialised, error: electronError },
    userDataWritable,
    bootStages: boot.snapshot().stages.map((entry) => `${entry.stage}: ${entry.detail ?? ''}`),
    problems,
  };

  // Human summary on stderr; JSON goes to stdout from the caller.
  boot.info(`Self-check ${report.ok ? 'PASSED' : 'FAILED'}: ${problems.length} problem(s)`);
  for (const problem of problems) boot.warn(problem);

  /*
   * Also write the report next to the log.
   *
   * A Windows GUI-subsystem executable is not attached to the parent console, so
   * stdout from `Pixel.exe --pixel-selfcheck` can be discarded even when the
   * process runs correctly. The file is the reliable channel; the diagnostic
   * script reads it.
   */
  try {
    const reportPath = join(dirname(boot.logPath), 'pixel-selfcheck.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    report.reportPath = reportPath;
  } catch {
    // stdout remains available for interactive runs.
  }

  return report;
}
