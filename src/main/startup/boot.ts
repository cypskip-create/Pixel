/**
 * Boot diagnostics.
 *
 * This module must be the FIRST thing the main process loads, and it must import
 * nothing but Node built-ins. Everything else in the app - Electron itself, the
 * IPC layer, the provider clients - is loaded afterwards, so a failure inside
 * any of those imports is still recorded rather than dying silently.
 *
 * That ordering is why the entry point no longer statically imports the
 * application: a failed import would abort before any logging existed, which is
 * exactly the "no window, no log, no event-log entry" failure this fixes.
 *
 * Log locations are resolved without Electron, because Electron may not have
 * initialised yet:
 *   1. %APPDATA%\Pixel\pixel-startup.log   (normal)
 *   2. %TEMP%\Pixel\pixel-startup.log      (APPDATA missing)
 *   3. <cwd>\pixel-startup.log             (last resort)
 * A marker file is also written next to the executable's user data area, so the
 * diagnostics script can tell "never ran" from "ran and died".
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BootState {
  startedAt: number;
  logPath: string;
  stages: Array<{ at: number; stage: string; detail?: string }>;
  exitCode: number | null;
}

const MAX_LOG_BYTES = 512 * 1024;

function candidateLogPaths(): string[] {
  const paths: string[] = [];
  const appData = process.env.APPDATA;
  if (appData && appData.trim().length > 0) paths.push(join(appData, 'Pixel'));
  // The previous product name, so a pre-migration launch is still captured.
  if (appData && appData.trim().length > 0) paths.push(join(appData, 'cyps'));
  paths.push(join(tmpdir(), 'Pixel'));
  paths.push(join(homedir(), 'Pixel-logs'));
  return paths;
}

function pickLogPath(): string {
  for (const dir of candidateLogPaths()) {
    try {
      mkdirSync(dir, { recursive: true });
      return join(dir, 'pixel-startup.log');
    } catch {
      // Try the next candidate.
    }
  }
  return join(process.cwd(), 'pixel-startup.log');
}

class BootLogger {
  private readonly state: BootState;
  private writeFailures = 0;

  constructor() {
    this.state = {
      startedAt: Date.now(),
      logPath: pickLogPath(),
      stages: [],
      exitCode: null,
    };
  }

  get logPath(): string {
    return this.state.logPath;
  }

  /** Write the first lines and install process-level handlers. */
  begin(): void {
    this.capture('boot', `log file: ${this.state.logPath}`);
    this.capture(
      'boot',
      `pid=${String(process.pid)} execPath=${process.execPath} cwd=${process.cwd()}`,
    );
    this.capture('boot', `node=${process.versions.node} electron=${process.versions.electron ?? 'n/a'}`);
    this.capture('boot', `argv=${process.argv.slice(1).join(' ')}`);
    this.installProcessHandlers();
  }

  /** Record a named startup stage. */
  stage(name: string, detail?: string): void {
    this.capture('stage', detail ? `${name} - ${detail}` : name);
  }

  info(message: string): void {
    this.capture('info', message);
  }

  warn(message: string): void {
    this.capture('warn', message);
  }

  error(message: string): void {
    this.capture('error', message);
  }

  /** Log a fatal error with its stack, then flush. */
  fatal(error: unknown): void {
    this.capture('fatal', describeError(error));
  }

  /** Stages recorded so far, for the diagnostics panel and self-check. */
  snapshot(): BootState {
    return { ...this.state, stages: [...this.state.stages] };
  }

  private capture(kind: string, message: string): void {
    const at = Date.now();
    const elapsed = at - this.state.startedAt;
    this.state.stages.push({ at, stage: kind, detail: message });

    const line = `${new Date(at).toISOString()} +${String(elapsed).padStart(5)}ms [${kind}] ${message}\n`;
    // Always mirror to stderr: even when every file write fails, the exit code
    // and message are still visible if the app is started from a console.
    try {
      process.stderr.write(line);
    } catch {
      // Nothing else to do.
    }

    if (this.writeFailures > 5) return;
    try {
      this.rotateIfNeeded();
      appendFileSync(this.state.logPath, line, 'utf8');
    } catch {
      this.writeFailures += 1;
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.state.logPath)) return;
      const content = readFileSync(this.state.logPath, 'utf8');
      if (content.length <= MAX_LOG_BYTES) return;
      const kept = content.slice(-Math.floor(MAX_LOG_BYTES / 2));
      const firstNewline = kept.indexOf('\n');
      writeFileSync(
        this.state.logPath,
        firstNewline >= 0 ? kept.slice(firstNewline + 1) : kept,
        'utf8',
      );
    } catch {
      // Rotation is best effort.
    }
  }

  private installProcessHandlers(): void {
    process.on('uncaughtException', (error) => {
      this.fatal(error);
    });

    process.on('unhandledRejection', (reason) => {
      this.capture('rejection', describeError(reason));
    });

    // 'exit' cannot await anything; the write here is synchronous on purpose.
    process.on('exit', (code) => {
      this.state.exitCode = code;
      this.capture('exit', `process exit code ${String(code)}`);
      this.writeMarker(code);
    });

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      try {
        process.on(signal, () => {
          this.capture('signal', signal);
        });
      } catch {
        // Not supported on this platform.
      }
    }
  }

  /**
   * Write a tiny marker file recording the last exit code.
   *
   * A Windows application that dies before the renderer loads leaves no event
   * log entry, so this file is often the only evidence that it ran at all.
   */
  private writeMarker(code: number): void {
    try {
      const marker = join(dirname(this.state.logPath), 'pixel-last-exit.json');
      writeFileSync(
        marker,
        JSON.stringify({ at: new Date().toISOString(), exitCode: code, logPath: this.state.logPath }),
        'utf8',
      );
    } catch {
      // Never fail on the way out.
    }
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

/** The single boot logger for the process. */
export const boot = new BootLogger();
