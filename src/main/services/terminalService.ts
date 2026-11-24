/**
 * Controlled Windows-compatible Terminal & Process Service (Hermes `process_registry.py` parity).
 *
 * Security & lifecycle invariants:
 *  - Every command requires explicit `PermissionBroker` approval when an authorizer is supplied.
 *  - Working directory is canonically jailed (`realpathSync`) inside `authorizedRoot` when configured.
 *    (Note: a shell command can still reference paths outside its cwd, so command approval stays mandatory.)
 *  - Supports interactive `stdin` (`writeStdin`), real-time `stdout`/`stderr` streaming, `wait` with
 *    timeout, per-owner session isolation (`ownerId`), real exit codes, Windows process-tree
 *    termination (`taskkill /PID /T /F`), and Emergency Stop (`killAll`).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type TerminalSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type TerminalShellKind = 'powershell' | 'cmd' | 'pwsh' | 'sh';

export interface TerminalSessionSummary {
  id: string;
  command: string;
  cwd: string;
  ownerId?: string;
  persistent?: boolean;
  shell?: TerminalShellKind;
  cols?: number;
  rows?: number;
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
  authorizedRoot?: string;
  getAuthorizedRoot?: () => string | null;
  getDefaultShell?: () => TerminalShellKind;
  getDefaultTimeoutMs?: () => number;
  getMaxOutputChars?: () => number;
}

export interface TerminalRunOptions {
  cwd?: string;
  ownerId?: string;
  timeoutMs?: number;
  shell?: TerminalShellKind;
}

export interface TerminalShellOptions {
  shell?: TerminalShellKind;
  cwd?: string;
  ownerId: string;
  cols?: number;
  rows?: number;
  timeoutMs?: number;
}

interface LiveSession {
  summary: TerminalSessionSummary;
  proc: ChildProcess | null;
  exitResolvers: Array<() => void>;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

const MAX_OUTPUT_CHARS = 256 * 1024;
const MAX_SESSIONS = 24;

function isWithinCanonicalRoot(rootDir: string, targetDir: string): boolean {
  try {
    const canonicalRoot = realpathSync(resolve(rootDir));
    const canonicalTarget = realpathSync(resolve(targetDir));
    const rel = relative(canonicalRoot, canonicalTarget);
    if (!rel) return true;
    return !rel.startsWith('..') && rel !== '..' && !rel.includes(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

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
    const maxChars = Math.max(8_192, Math.min(this.options.getMaxOutputChars?.() ?? MAX_OUTPUT_CHARS, 1024 * 1024));
    const combined = session.summary.output + chunk;
    session.summary.output =
      combined.length > maxChars
        ? combined.slice(combined.length - maxChars)
        : combined;
    this.options.onOutput?.({ sessionId: session.summary.id, stream, chunk });
  }

  private settleExit(live: LiveSession): void {
    if (live.timeoutHandle) {
      clearTimeout(live.timeoutHandle);
      live.timeoutHandle = undefined;
    }
    const resolvers = live.exitResolvers.splice(0, live.exitResolvers.length);
    for (const r of resolvers) r();
  }

  /**
   * Strict fail-closed ownership check:
   *  - Owned sessions require an exact matching `ownerId`. Missing `ownerId` is DENIED.
   *  - Unscoped legacy sessions are only accessible without a conflicting owner.
   */
  private checkOwnership(live: LiveSession, ownerId?: string): boolean {
    if (live.summary.ownerId) {
      return Boolean(ownerId) && live.summary.ownerId === ownerId;
    }
    return !ownerId || ownerId === 'user';
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
    cwdOrOptions?: string | TerminalRunOptions,
  ): Promise<{ ok: boolean; session?: TerminalSessionSummary; error?: string }> {
    const opts: TerminalRunOptions =
      typeof cwdOrOptions === 'string' ? { cwd: cwdOrOptions } : (cwdOrOptions ?? {});
    const trimmed = command.trim();
    if (!trimmed) return { ok: false, error: 'Command cannot be empty.' };
    if (trimmed.length > 4096) return { ok: false, error: 'Command exceeds maximum length (4096 chars).' };
    if (this.options.isEmergencyStopped?.()) {
      return { ok: false, error: 'Emergency Stop is active. Clear Emergency Stop before running commands.' };
    }

    const configuredRoot = this.options.getAuthorizedRoot?.() ?? this.options.authorizedRoot ?? null;
    const rawCwd = opts.cwd || configuredRoot || this.options.defaultCwd;
    if (!rawCwd) {
      return { ok: false, error: 'No workspace directory is configured for the active project.' };
    }
    const cwd = resolve(rawCwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return { ok: false, error: 'Working directory does not exist.' };
    }
    if (configuredRoot && !isWithinCanonicalRoot(configuredRoot, cwd)) {
      return { ok: false, error: 'Requested working directory escapes the authorized project root.' };
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
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
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
        ? ['-NoLogo', '-NoProfile', '-Command', trimmed]
        : ['-c', trimmed];

    let proc: ChildProcess;
    try {
      proc = spawn(shell, args, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to start command process.',
      };
    }

    summary.pid = proc.pid ?? null;
    const live: LiveSession = { summary, proc, exitResolvers: [] };
    this.sessions.set(id, live);
    this.pruneOldSessions();

    const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : this.options.getDefaultTimeoutMs?.();
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      live.timeoutHandle = setTimeout(() => {
        if (live.summary.status === 'running') {
          this.appendOutput(live, 'stderr', `\n[Process timed out after ${timeoutMs}ms]\n`);
          this.cancelInternal(id, true);
        }
      }, Math.min(timeoutMs, 600_000));
    }

    proc.stdout?.on('data', (buf: Buffer) => this.appendOutput(live, 'stdout', buf));
    proc.stderr?.on('data', (buf: Buffer) => this.appendOutput(live, 'stderr', buf));

    proc.on('error', (err) => {
      if (live.summary.status !== 'running') return;
      this.appendOutput(live, 'stderr', `\n${err.message}\n`);
      live.summary.status = 'failed';
      live.summary.endedAt = Date.now();
      live.proc = null;
      this.settleExit(live);
      this.options.onExit?.({ sessionId: id, status: 'failed', exitCode: null });
    });

    proc.on('close', (code) => {
      if (live.summary.status === 'running') {
        live.summary.exitCode = typeof code === 'number' ? code : null;
        live.summary.status = code === 0 ? 'completed' : 'failed';
        live.summary.endedAt = Date.now();
        live.proc = null;
        this.settleExit(live);
        this.options.onExit?.({
          sessionId: id,
          status: live.summary.status,
          exitCode: live.summary.exitCode,
        });
      }
    });

    return { ok: true, session: { ...summary } };
  }

  /** Send interactive standard input to a running process. */
  writeStdin(
    sessionId: string,
    input: string,
    ownerId?: string,
  ): { ok: boolean; error?: string } {
    const live = this.sessions.get(sessionId);
    if (!live) return { ok: false, error: 'Process session not found.' };
    if (!this.checkOwnership(live, ownerId)) {
      return { ok: false, error: 'Process session belongs to another owner.' };
    }
    if (live.summary.status !== 'running' || !live.proc?.stdin || live.proc.stdin.destroyed) {
      return { ok: false, error: 'Process is not accepting standard input.' };
    }
    try {
      live.proc.stdin.write(input);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to write to stdin.' };
    }
  }

  /** Wait up to `timeoutMs` for a process session to exit. */
  async wait(
    sessionId: string,
    timeoutMs = 15_000,
    ownerId?: string,
  ): Promise<{ ok: boolean; timedOut?: boolean; session?: TerminalSessionSummary; error?: string }> {
    const live = this.sessions.get(sessionId);
    if (!live) return { ok: false, error: 'Process session not found.' };
    if (!this.checkOwnership(live, ownerId)) {
      return { ok: false, error: 'Process session belongs to another owner.' };
    }
    if (live.summary.status !== 'running') {
      return { ok: true, timedOut: false, session: { ...live.summary } };
    }
    const bounded = Math.min(Math.max(timeoutMs, 100), 120_000);
    const timedOut = await new Promise<boolean>((res) => {
      const timer = setTimeout(() => res(true), bounded);
      live.exitResolvers.push(() => {
        clearTimeout(timer);
        res(false);
      });
    });
    return { ok: true, timedOut, session: { ...live.summary } };
  }

  /**
   * Open a persistent interactive shell session (PowerShell, cmd, pwsh, or sh)
   * with full stdin/stdout/stderr streaming, resize tracking, and strict ownerId isolation.
   */
  async openShell(
    opts: TerminalShellOptions,
  ): Promise<{ ok: boolean; session?: TerminalSessionSummary; error?: string }> {
    if (this.options.isEmergencyStopped?.()) {
      return { ok: false, error: 'Emergency Stop is active. Clear Emergency Stop before opening a shell.' };
    }
    if (!opts.ownerId || !opts.ownerId.trim()) {
      return { ok: false, error: 'A trusted ownerId is required to open a persistent shell session.' };
    }

    const configuredRoot = this.options.getAuthorizedRoot?.() ?? this.options.authorizedRoot ?? null;
    const rawCwd = opts.cwd || configuredRoot || this.options.defaultCwd;
    if (!rawCwd) {
      return { ok: false, error: 'No workspace directory is configured for the active project.' };
    }
    const cwd = resolve(rawCwd);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return { ok: false, error: 'Working directory does not exist.' };
    }
    if (configuredRoot && !isWithinCanonicalRoot(configuredRoot, cwd)) {
      return { ok: false, error: 'Requested working directory escapes the authorized project root.' };
    }

    const shellKind: TerminalShellKind =
      opts.shell ?? this.options.getDefaultShell?.() ?? (process.platform === 'win32' ? 'powershell' : 'sh');
    const cols = Math.max(20, Math.min(opts.cols ?? 120, 400));
    const rows = Math.max(5, Math.min(opts.rows ?? 32, 200));

    if (this.options.authorize) {
      const auth = await this.options.authorize(`interactive-shell:${shellKind}`, cwd);
      if (!auth.allowed) {
        return { ok: false, error: auth.reason || 'Interactive shell session was not approved.' };
      }
    }

    const exeAndArgs: [string, string[]] =
      shellKind === 'cmd'
        ? ['cmd.exe', ['/Q', '/K']]
        : shellKind === 'pwsh'
          ? ['pwsh', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']]
          : shellKind === 'sh'
            ? ['sh', []]
            : ['powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']];

    let proc: ChildProcess;
    try {
      proc = spawn(exeAndArgs[0], exeAndArgs[1], {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          COLUMNS: String(cols),
          LINES: String(rows),
          TERM: 'xterm-256color',
        },
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : `Failed to spawn ${shellKind} shell.`,
      };
    }

    const id = `shell_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const summary: TerminalSessionSummary = {
      id,
      command: `interactive:${shellKind}`,
      cwd,
      ownerId: opts.ownerId,
      persistent: true,
      shell: shellKind,
      cols,
      rows,
      status: 'running',
      pid: proc.pid ?? null,
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      output: '',
    };

    const live: LiveSession = { summary, proc, exitResolvers: [] };
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
      this.settleExit(live);
      this.options.onExit?.({ sessionId: id, status: 'failed', exitCode: null });
    });
    proc.on('close', (code) => {
      if (live.summary.status === 'running') {
        live.summary.exitCode = typeof code === 'number' ? code : null;
        live.summary.status = code === 0 ? 'completed' : 'failed';
        live.summary.endedAt = Date.now();
        live.proc = null;
        this.settleExit(live);
        this.options.onExit?.({ sessionId: id, status: live.summary.status, exitCode: live.summary.exitCode });
      }
    });

    return { ok: true, session: { ...summary } };
  }

  /** Resize a persistent terminal session's tracked dimensions. */
  resize(
    sessionId: string,
    cols: number,
    rows: number,
    ownerId?: string,
  ): { ok: boolean; cols?: number; rows?: number; error?: string } {
    const live = this.sessions.get(sessionId);
    if (!live) return { ok: false, error: 'Process session not found.' };
    if (!this.checkOwnership(live, ownerId)) {
      return { ok: false, error: 'Process session belongs to another owner.' };
    }
    const nextCols = Math.max(20, Math.min(Math.round(cols), 400));
    const nextRows = Math.max(5, Math.min(Math.round(rows), 200));
    live.summary.cols = nextCols;
    live.summary.rows = nextRows;
    return { ok: true, cols: nextCols, rows: nextRows };
  }

  /** Send an interrupt sequence (Ctrl+C) to a running session. */
  sendInterrupt(sessionId: string, ownerId?: string): { ok: boolean; error?: string } {
    return this.writeStdin(sessionId, '\x03', ownerId);
  }

  /** Read buffered output from an offset (for incremental terminal/process polling). */
  readOutput(
    sessionId: string,
    offset = 0,
    ownerId?: string,
  ): { ok: boolean; output?: string; nextOffset?: number; status?: TerminalSessionStatus; error?: string } {
    const live = this.sessions.get(sessionId);
    if (!live) return { ok: false, error: 'Process session not found.' };
    if (!this.checkOwnership(live, ownerId)) {
      return { ok: false, error: 'Process session belongs to another owner.' };
    }
    const safeOffset = Math.max(0, Math.min(offset, live.summary.output.length));
    return {
      ok: true,
      output: live.summary.output.slice(safeOffset),
      nextOffset: live.summary.output.length,
      status: live.summary.status,
    };
  }

  private cancelInternal(sessionId: string, admin: boolean, ownerId?: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live || live.summary.status !== 'running') return false;
    if (!admin && !this.checkOwnership(live, ownerId)) return false;
    live.summary.status = 'cancelled';
    live.summary.endedAt = Date.now();
    const pid = live.proc?.pid ?? live.summary.pid;
    try {
      live.proc?.stdin?.end();
    } catch {
      // Ignore already-closed stdin.
    }
    live.proc = null;
    this.settleExit(live);
    if (pid) terminateProcessTree(pid);
    this.options.onExit?.({ sessionId, status: 'cancelled', exitCode: null });
    return true;
  }

  cancel(sessionId: string, ownerId?: string): boolean {
    return this.cancelInternal(sessionId, false, ownerId);
  }

  /** Remove a finished session from the registry. */
  close(sessionId: string, ownerId?: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live || live.summary.status === 'running') return false;
    if (!this.checkOwnership(live, ownerId)) return false;
    return this.sessions.delete(sessionId);
  }

  /** Explicitly authorized administrative cleanup for Emergency Stop and app shutdown. */
  adminKillAll(): number {
    let killed = 0;
    for (const [id, live] of this.sessions.entries()) {
      if (live.summary.status === 'running') {
        if (this.cancelInternal(id, true)) killed += 1;
      }
    }
    return killed;
  }

  killAll(): number {
    return this.adminKillAll();
  }

  get(sessionId: string, ownerId?: string): TerminalSessionSummary | null {
    const live = this.sessions.get(sessionId);
    if (!live || !this.checkOwnership(live, ownerId)) return null;
    return { ...live.summary };
  }

  list(ownerId?: string): TerminalSessionSummary[] {
    return [...this.sessions.values()]
      .filter((s) => this.checkOwnership(s, ownerId))
      .map((s) => ({ ...s.summary }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }
}
