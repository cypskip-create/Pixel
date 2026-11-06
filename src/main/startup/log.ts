/**
 * Startup and crash logging.
 *
 * A desktop app that fails before its window appears leaves the user with
 * nothing to report. Pixel writes a small, rotating log next to its settings so
 * that a failed launch can be diagnosed afterwards - and so the Windows
 * diagnostics script has something concrete to read.
 *
 * Deliberately dependency-free and synchronous: it must work even when the rest
 * of the startup path is failing.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Keep the log small enough to attach to a bug report. */
const MAX_LOG_BYTES = 256 * 1024;

export type LogLevel = 'info' | 'warn' | 'error';

export class StartupLog {
  private readonly path: string;

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'pixel-startup.log');
  }

  get logPath(): string {
    return this.path;
  }

  /** Append one line. Never throws: logging must not break startup. */
  write(level: LogLevel, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.path, line, 'utf8');
    } catch {
      // Nothing useful can be done here.
    }
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string): void {
    this.write('error', message);
  }

  /** Last `lines` lines, for the diagnostics panel. */
  tail(lines = 100): string[] {
    try {
      if (!existsSync(this.path)) return [];
      const content = readFileSync(this.path, 'utf8');
      const all = content.split('\n').filter((line) => line.length > 0);
      return all.slice(-lines);
    } catch {
      return [];
    }
  }

  /**
   * Truncate once the log grows past the cap, keeping the newer half. A single
   * line write can never fail because the file got too big.
   */
  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.path)) return;
      const content = readFileSync(this.path, 'utf8');
      if (content.length <= MAX_LOG_BYTES) return;
      const kept = content.slice(-Math.floor(MAX_LOG_BYTES / 2));
      const firstNewline = kept.indexOf('\n');
      writeFileSync(this.path, firstNewline >= 0 ? kept.slice(firstNewline + 1) : kept, 'utf8');
    } catch {
      // Rotation is best effort.
    }
  }
}

/** Format an unknown thrown value for the log. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    return `${error.name}: ${error.message}${stack ? `\n${stack}` : ''}`;
  }
  return String(error);
}
