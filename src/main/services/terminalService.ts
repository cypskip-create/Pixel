/**
 * Controlled Windows-compatible Terminal & Process Service.
 *
 * Inspired by Hermes `tools/process_registry.py` and `tools/terminal_tool.py`,
 * adapted to Pixel's Electron main-process security model:
 *  - Every command requires explicit `PermissionBroker` approval (unless a
 *    test/caller supplies an explicit authorizer).
 *  - Working directory is strictly jailed to an authorized directory.
 *  - Streams real `stdout` / `stderr` chunks, tracks real exit codes, and
 *    terminates the full Windows process tree (`taskkill /PID /T /F`) on cancel
 *    or Emergency Stop (`killAll`).
 *  - Caps buffered output per session (256 KiB) to prevent memory leaks.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export type TerminalSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TerminalSessionSummary {
  id: string;
  command: string;
  cwd: string;
  status: TerminalSessionStatus;
  pid: number | null;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  status: TerminalSessionStatus;
  exitCode: number | null;
}

export interface TerminalServiceOptions {
  authorize?: (command: string, cwd: string) => Promise<{ allowed: boolean; reason?: string }>;
  isEmergencyStopped?: () => boolean;
  onOutput?: (event: TerminalOutputEvent) => void;
  onExit?: (event: TerminalExitEvent) => void;
  defaultCwd?: string;
}

interface LiveSession {
  summary: TerminalSessionSummary;
  proc: ChildProcess | null;
}

const MAX_OUTPUT_CHARS = 256 * 1024;
const MAX_SESSIONS = 24;

function terminateProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already exited.
      }
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

export class TerminalService {
  private readonly sessions = new Map<string, LiveSession>();

  constructor(private readonly options: TerminalServiceOptions = {}) {}

  private appendOutput(session: LiveSession, stream: 'stdout' | 'stderr', raw: Buffer | string): void {
    const chunk = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (!chunk) return;
    const combined = session.summary.output + chunk;
    session.summary.output =
      combined.length > MAX_OUTPUT_CHARS
        ? combined.slice(combined.length - MAX_OUTPUT_CHARS)
        : combined;
    this.options.onOutput?.({ sessionId: session.summary.id, stream, chunk });
  }

  private pruneOldSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const finished = [...this.sessions.values()]
      .filter((s) => s.summary.status !== 'running')
      .sort((a, b) => (a.summary.endedAt ?? 0) - (b.summary.endedAt ?? 0));
    while (this.sessions.size > MAX_SESSIONS && finished.length > 0) {
      const oldest = finished.shift()!;
      this.sessions.delete(oldest.summary.id);
    }
  }

  async run(
    command: string,
    cwdOverride?: string,
  ): Promise<{ ok: boolean; session?: TerminalSessionSummary; error?: string }> {
    const trimmed = command.trim();
    if (!trimmed) return { ok: false, error: 'Command cannot be empty.' };
    if (trimmed.length > 4096) return { ok: false, error: 'Command exceeds maximum length (4096 chars).' };
    if (this.options.isEmergencyStopped?.()) {
      return { ok: false, error: 'Emergency Stop is active. Clear Emergency Stop before running commands.' };
    }

    const cwd = resolve(cwdOverride || this.options.defaultCwd || process.cwd());
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return { ok: false, error: 'Working directory does not exist.' };
    }

    if (this.options.authorize) {
      const auth = await this.options.authorize(trimmed, cwd);
      if (!auth.allowed) {
        return { ok: false, error: auth.reason || 'Command execution was not approved.' };
      }
    }

    const id = `term_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const summary: TerminalSessionSummary = {
      id,
      command: trimmed,
      cwd,
      status: 'running',
      pid: null,
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      output: '',
    };

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
    const args =
      process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', trimmed]
        : ['-c', trimmed];

    let proc: ChildProcess;
    try {
      proc = spawn(shell, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to start command process.',
      };
    }

    summary.pid = proc.pid ?? null;
    const live: LiveSession = { summary, proc };
    this.sessions.set(id, live);
    this.pruneOldSessions();

    proc.stdout?.on('data', (buf: Buffer) => this.appendOutput(live, 'stdout', buf));
    proc.stderr?.on('data', (buf: Buffer) => this.appendOutput(live, 'stderr', buf));

    proc.on('error', (err) => {
      if (live.summary.status !== 'running') return;
      this.appendOutput(live, 'stderr', `\n${err.message}\n`);
      live.summary.status = 'failed';
      live.summary.endedAt = Date.now();
      live.proc = null;
      this.options.onExit?.({ sessionId: id, status: 'failed', exitCode: null });
    });

    proc.on('close', (code) => {
      if (live.summary.status === 'running') {
        live.summary.exitCode = typeof code === 'number' ? code : null;
        live.summary.status = code === 0 ? 'completed' : 'failed';
        live.summary.endedAt = Date.now();
        live.proc = null;
        this.options.onExit?.({
          sessionId: id,
          status: live.summary.status,
          exitCode: live.summary.exitCode,
        });
      }
    });

    return { ok: true, session: { ...summary } };
  }

  cancel(sessionId: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live || live.summary.status !== 'running') return false;
    live.summary.status = 'cancelled';
    live.summary.endedAt = Date.now();
    const pid = live.proc?.pid ?? live.summary.pid;
    live.proc = null;
    if (pid) terminateProcessTree(pid);
    this.options.onExit?.({ sessionId, status: 'cancelled', exitCode: null });
    return true;
  }

  /** Immediately kill every running terminal process (Emergency Stop / app shutdown). */
  killAll(): number {
    let killed = 0;
    for (const [id, live] of this.sessions.entries()) {
      if (live.summary.status === 'running') {
        if (this.cancel(id)) killed += 1;
      }
    }
    return killed;
  }

  get(sessionId: string): TerminalSessionSummary | null {
    const live = this.sessions.get(sessionId);
    return live ? { ...live.summary } : null;
  }

  list(): TerminalSessionSummary[] {
    return [...this.sessions.values()]
      .map((s) => ({ ...s.summary }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }
}
