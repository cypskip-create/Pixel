/**
 * Typed local bridge to Pixel's Python Agent Runtime (`python/agent_service.py`, protocol: pixel-agent-v2).
 *
 * Security & lifecycle invariants:
 *  - Communicates over NDJSON stdio (stdout strictly protocol frames; stderr diagnostics only).
 *  - Every `tool.request` from Python is routed to Electron main's PermissionBroker — Python
 *    never executes privileged Windows, file, Git, browser, or UIA actions directly.
 *  - Tracks backend ownership (`pid`, `startMarker`, `instanceId`, `parentPid`) with corrupt-file
 *    quarantine (`.corrupt`) and safe orphan reaping so unrelated Python/Hermes processes are never touched.
 *  - Caps stdout buffer size (4 MiB) to prevent unbounded memory growth on malformed frames.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PIXEL_AGENT_PROTOCOL_VERSION = 'pixel-agent-v2';
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface PythonAgentOwnershipEntry {
  instanceId: string;
  pid: number;
  startMarker: string;
  parentPid: number;
  parentStartMarker: string;
}

export interface PythonAgentPingResult {
  protocol: string;
  supportedProtocols?: string[];
  pid: number;
  python: string;
  timestampMs: number;
  authority: string;
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

export interface PythonToolRequest {
  requestId: string;
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PythonToolResponse {
  ok: boolean;
  content: string;
  denied?: boolean;
}

export interface PythonTurnStartOptions {
  requestId: string;
  messages: Array<Record<string, unknown>>;
  tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  provider: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string | null;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    thinking?: Record<string, unknown>;
    fallbacks?: Array<{
      provider: string;
      model: string;
      baseUrl?: string;
      apiKey?: string | null;
    }>;
  };
  budgets?: {
    maxIterations?: number;
    maxToolCalls?: number;
    maxWallMs?: number;
    maxContextTokens?: number;
    toolTimeoutMs?: number;
  };
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onStep?: (step: { id: string; title: string; status: string; toolName?: string }) => void;
  onToolRequest: (request: PythonToolRequest) => Promise<PythonToolResponse>;
}

export interface PythonTurnCompleteResult {
  ok: boolean;
  content: string;
  reasoning: string;
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  steps: Array<{ id?: string; tool: string; status: string; detail?: string }>;
  compression?: { prunedTools: number; compressedMiddle: number; usedAuxSummary: boolean };
  error?: { code: string; message: string; retryable: boolean; detail?: string };
  crashed?: boolean;
}

interface PendingRpcCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveTurnState {
  options: PythonTurnStartOptions;
  resolve: (result: PythonTurnCompleteResult) => void;
  cancelled: boolean;
}

export function parseOwnershipFile(raw: string): { ok: true; entry: PythonAgentOwnershipEntry } | { ok: false } {
  try {
    const parsed = JSON.parse(raw) as Partial<PythonAgentOwnershipEntry>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.instanceId === 'string' &&
      parsed.instanceId.length > 0 &&
      Number.isInteger(parsed.pid) &&
      Number(parsed.pid) > 0 &&
      typeof parsed.startMarker === 'string' &&
      Number.isInteger(parsed.parentPid)
    ) {
      return { ok: true, entry: parsed as PythonAgentOwnershipEntry };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export class PythonAgentBridge {
  private readonly pythonExecutable: string;
  private readonly scriptPath: string;
  private readonly timeoutMs: number;
  private readonly ownershipPath: string | null;
  private readonly crashLogPath: string | null;
  private readonly parentStartMarker = `${process.pid}:${Date.now()}`;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private currentOwnership: PythonAgentOwnershipEntry | null = null;
  private buffer = '';
  private readonly pendingRpc = new Map<string, PendingRpcCall>();
  private readonly activeTurns = new Map<string, ActiveTurnState>();
  private lastStderrLines: string[] = [];

  constructor(options: {
    pythonExecutable?: string;
    scriptPath?: string;
    timeoutMs?: number;
    ownershipPath?: string;
    crashLogPath?: string;
  } = {}) {
    this.pythonExecutable = options.pythonExecutable ?? process.env.PIXEL_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    this.scriptPath = options.scriptPath ?? join(process.cwd(), 'python', 'agent_service.py');
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.ownershipPath = options.ownershipPath ?? null;
    this.crashLogPath = options.crashLogPath ?? null;
  }

  getHealth(): { running: boolean; pid: number | null; instanceId: string | null; recentStderr: string[] } {
    const running = Boolean(this.proc && !this.proc.killed && this.proc.exitCode === null);
    return {
      running,
      pid: running && this.proc?.pid ? this.proc.pid : null,
      instanceId: this.currentOwnership?.instanceId ?? null,
      recentStderr: [...this.lastStderrLines],
    };
  }

  /** Inspect and quarantine any corrupt ownership record; never kills unrelated processes. */
  inspectAndCleanOwnership(): { status: 'none' | 'valid' | 'quarantined'; entry?: PythonAgentOwnershipEntry } {
    if (!this.ownershipPath || !existsSync(this.ownershipPath)) return { status: 'none' };
    try {
      const raw = readFileSync(this.ownershipPath, 'utf8');
      const parsed = parseOwnershipFile(raw);
      if (!parsed.ok) {
        const quarantinePath = `${this.ownershipPath}.corrupt`;
        try {
          renameSync(this.ownershipPath, quarantinePath);
        } catch {
          // Best-effort quarantine
        }
        return { status: 'quarantined' };
      }
      return { status: 'valid', entry: parsed.entry };
    } catch {
      return { status: 'none' };
    }
  }

  private writeOwnership(entry: PythonAgentOwnershipEntry): void {
    this.currentOwnership = entry;
    if (!this.ownershipPath) return;
    try {
      mkdirSync(dirname(this.ownershipPath), { recursive: true });
      writeFileSync(this.ownershipPath, JSON.stringify(entry, null, 2), 'utf8');
    } catch {
      // Non-fatal; runtime continues.
    }
  }

  private clearOwnership(): void {
    this.currentOwnership = null;
    if (!this.ownershipPath || !existsSync(this.ownershipPath)) return;
    try {
      unlinkSync(this.ownershipPath);
    } catch {
      // Ignore cleanup race
    }
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    if (!existsSync(this.scriptPath)) {
      throw new Error(`Python agent service script not found at ${this.scriptPath}`);
    }
    this.inspectAndCleanOwnership();

    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1' };
    if (this.crashLogPath) env.PIXEL_AGENT_CRASH_LOG = this.crashLogPath;

    const child = spawn(this.pythonExecutable, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });

    if (child.pid) {
      this.writeOwnership({
        instanceId: randomUUID(),
        pid: child.pid,
        startMarker: `${child.pid}:${Date.now()}`,
        parentPid: process.pid,
        parentStartMarker: this.parentStartMarker,
      });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.buffer.length + chunk.length > MAX_BUFFER_BYTES) {
        this.buffer = '';
        return;
      }
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.buffer.indexOf('\n');
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        this.lastStderrLines = [...this.lastStderrLines, ...lines].slice(-12);
      }
    });

    const failPendingAndActive = (reason: string, code: string) => {
      this.proc = null;
      this.clearOwnership();
      for (const [id, entry] of this.pendingRpc) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
        this.pendingRpc.delete(id);
      }
      for (const [reqId, turn] of this.activeTurns) {
        this.activeTurns.delete(reqId);
        turn.resolve({
          ok: false,
          content: '',
          reasoning: '',
          finishReason: 'crashed',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          steps: [],
          crashed: true,
          error: { code, message: reason, retryable: false },
        });
      }
    };

    child.on('error', (err) => {
      failPendingAndActive(`Failed to spawn Python agent process: ${err.message}`, 'SPAWN_ERROR');
    });

    child.on('exit', (code, signal) => {
      failPendingAndActive(
        `Python agent process exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
        'PROCESS_CRASH',
      );
    });

    this.proc = child;
    return child;
  }

  private handleLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : '';

    // 1. Streaming pixel-agent-v2 turn events
    if (requestId && this.activeTurns.has(requestId)) {
      const turn = this.activeTurns.get(requestId)!;
      if (type === 'turn.delta' && typeof parsed.delta === 'string') {
        if (!turn.cancelled) turn.options.onDelta?.(parsed.delta);
        return;
      }
      if (type === 'turn.reasoning' && typeof parsed.delta === 'string') {
        if (!turn.cancelled) turn.options.onReasoning?.(parsed.delta);
        return;
      }
      if (type === 'task.step' && parsed.step && typeof parsed.step === 'object') {
        if (!turn.cancelled) {
          turn.options.onStep?.(parsed.step as { id: string; title: string; status: string; toolName?: string });
        }
        return;
      }
      if (type === 'tool.request') {
        const callId = typeof parsed.callId === 'string' ? parsed.callId : '';
        const name = typeof parsed.name === 'string' ? parsed.name : '';
        const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
          ? parsed.args as Record<string, unknown>
          : {};
        if (turn.cancelled) {
          this.sendFrame({ type: 'tool.response', requestId, callId, ok: false, content: 'Turn was cancelled.' });
          return;
        }
        void turn.options.onToolRequest({ requestId, callId, name, args })
          .then((resp) => {
            if (!turn.cancelled) {
              this.sendFrame({
                type: 'tool.response',
                requestId,
                callId,
                ok: resp.ok,
                content: resp.content,
                denied: resp.denied === true,
              });
            }
          })
          .catch((err) => {
            this.sendFrame({
              type: 'tool.response',
              requestId,
              callId,
              ok: false,
              content: err instanceof Error ? err.message : 'Tool execution failed in Electron.',
            });
          });
        return;
      }
      if (type === 'turn.error') {
        this.activeTurns.delete(requestId);
        const err = (parsed.error && typeof parsed.error === 'object'
          ? parsed.error
          : { code: 'UNKNOWN', message: 'Python agent turn failed.', retryable: false }) as {
            code: string; message: string; retryable: boolean; detail?: string;
          };
        turn.resolve({
          ok: false,
          content: '',
          reasoning: '',
          finishReason: 'error',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          steps: [],
          error: err,
        });
        return;
      }
      if (type === 'turn.complete') {
        this.activeTurns.delete(requestId);
        const usage = (parsed.usage && typeof parsed.usage === 'object'
          ? parsed.usage
          : { promptTokens: 0, completionTokens: 0, totalTokens: 0 }) as {
            promptTokens: number; completionTokens: number; totalTokens: number;
          };
        turn.resolve({
          ok: parsed.finishReason !== 'cancelled',
          content: typeof parsed.content === 'string' ? parsed.content : '',
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
          finishReason: typeof parsed.finishReason === 'string' ? parsed.finishReason : 'stop',
          usage,
          steps: Array.isArray(parsed.steps)
            ? parsed.steps as Array<{ id?: string; tool: string; status: string; detail?: string }>
            : [],
          compression: parsed.compression && typeof parsed.compression === 'object'
            ? parsed.compression as { prunedTools: number; compressedMiddle: number; usedAuxSummary: boolean }
            : undefined,
        });
        return;
      }
    }

    // 2. Request-response RPC frames (ping, plan_turn, score_memory, cancel, shutdown)
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    if (!id) return;
    const entry = this.pendingRpc.get(id);
    if (!entry) return;
    this.pendingRpc.delete(id);
    clearTimeout(entry.timer);
    if (parsed.ok) entry.resolve(parsed.result);
    else entry.reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'Python agent service error.'));
  }

  private sendFrame(frame: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed || this.proc.exitCode !== null) return;
    this.proc.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const child = this.ensureStarted();
    const id = randomUUID();
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        rejectPromise(new Error(`Python agent service timed out on "${method}".`));
      }, this.timeoutMs);
      this.pendingRpc.set(id, {
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

  runTurn(options: PythonTurnStartOptions): Promise<PythonTurnCompleteResult> {
    const child = this.ensureStarted();
    return new Promise<PythonTurnCompleteResult>((resolve) => {
      this.activeTurns.set(options.requestId, { options, resolve, cancelled: false });
      child.stdin.write(`${JSON.stringify({
        type: 'turn.start',
        protocol: PIXEL_AGENT_PROTOCOL_VERSION,
        requestId: options.requestId,
        params: {
          messages: options.messages,
          tools: options.tools,
          provider: options.provider,
          budgets: options.budgets ?? {},
        },
      })}\n`);
    });
  }

  cancelTurn(requestId: string): void {
    const turn = this.activeTurns.get(requestId);
    if (turn) turn.cancelled = true;
    this.sendFrame({ type: 'turn.cancel', requestId });
  }

  /** Test/emergency helper: forcefully terminates the running Python child process. */
  killProcess(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }

  async dispose(): Promise<void> {
    if (!this.proc) {
      this.clearOwnership();
      return;
    }
    try {
      await this.request('shutdown');
    } catch {
      // Fall through to hard kill if already exiting.
    } finally {
      this.proc?.kill();
      this.proc = null;
      this.clearOwnership();
    }
  }
}
