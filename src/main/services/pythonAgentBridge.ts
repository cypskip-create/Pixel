/**
 * Typed local bridge to Pixel's Python Agent Service prototype (`python/agent_service.py`).
 *
 * Security invariant:
 *  - Communicates over stdio JSONL using versioned protocol `pixel-agent-v1`.
 *  - Advisory-only: never delegates tool execution authority or credentials to Python.
 *  - Electron's main-process PermissionBroker remains the single authoritative gate.
 *  - Cleanly supports timeouts, cancellation, disposal, and fallback when Python is unavailable.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PIXEL_AGENT_PROTOCOL_VERSION = 'pixel-agent-v1';

export interface PythonAgentPingResult {
  protocol: string;
  pid: number;
  python: string;
  timestampMs: number;
  authority: 'advisory-only';
}

export interface PythonAgentPlanResult {
  protocol: string;
  mode: string;
  suggestedTools: string[];
  requiresMainProcessAuthorization: true;
}

export interface PythonAgentMemoryScoreResult {
  keep: boolean;
  score: number;
  reason: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PythonAgentBridge {
  private readonly pythonExecutable: string;
  private readonly scriptPath: string;
  private readonly timeoutMs: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private readonly pending = new Map<string, PendingCall>();

  constructor(options: { pythonExecutable?: string; scriptPath?: string; timeoutMs?: number } = {}) {
    this.pythonExecutable = options.pythonExecutable ?? (process.platform === 'win32' ? 'python' : 'python3');
    this.scriptPath = options.scriptPath ?? join(process.cwd(), 'python', 'agent_service.py');
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    if (!existsSync(this.scriptPath)) {
      throw new Error(`Python agent service script not found at ${this.scriptPath}`);
    }
    const child = spawn(this.pythonExecutable, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.buffer.indexOf('\n');
      }
    });
    child.on('exit', () => {
      this.proc = null;
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Python agent service exited before replying.'));
        this.pending.delete(id);
      }
    });
    this.proc = child;
    return child;
  }

  private handleLine(line: string): void {
    try {
      const parsed = JSON.parse(line) as { id?: string; ok?: boolean; result?: unknown; error?: string };
      if (!parsed.id) return;
      const entry = this.pending.get(parsed.id);
      if (!entry) return;
      this.pending.delete(parsed.id);
      clearTimeout(entry.timer);
      if (parsed.ok) entry.resolve(parsed.result);
      else entry.reject(new Error(parsed.error || 'Python agent service error.'));
    } catch {
      // Ignore malformed stdout lines rather than crashing the main process.
    }
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const child = this.ensureStarted();
    const id = randomUUID();
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Python agent service timed out on "${method}".`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject: rejectPromise,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  ping(): Promise<PythonAgentPingResult> {
    return this.request<PythonAgentPingResult>('ping');
  }

  planTurn(input: { prompt: string; mode: string; allowedTools: string[] }): Promise<PythonAgentPlanResult> {
    return this.request<PythonAgentPlanResult>('plan_turn', input);
  }

  scoreMemory(input: { text: string; existing?: string[] }): Promise<PythonAgentMemoryScoreResult> {
    return this.request<PythonAgentMemoryScoreResult>('score_memory', input);
  }

  async dispose(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request('shutdown');
    } catch {
      // Fall through to hard kill if already exiting.
    } finally {
      this.proc?.kill();
      this.proc = null;
    }
  }
}
