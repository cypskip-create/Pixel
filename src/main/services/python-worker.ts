/**
 * Python worker supervisor.
 *
 * One long-lived worker process, started on demand and stopped when idle. Requests
 * are correlated by id over newline-delimited JSON on stdio; nothing listens on a
 * port, so there is no local surface to attack.
 *
 * Responsibilities kept here, not in the worker:
 *  - timeouts and cancellation
 *  - restart with a bounded budget, so a crashing script cannot loop forever
 *  - capability discovery, cached
 *  - stderr capture for diagnostics (never secrets: the worker is given none)
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { terminateProcessTree } from './process';

export const WORKER_PROTOCOL_VERSION = 1;
export const VOICE_MODEL_IDLE_UNLOAD_MS = 10 * 60 * 1000;

export type WorkerErrorCode =
  | 'CAPABILITY_MISSING'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'NO_TEXT'
  | 'TOO_LARGE'
  | 'BAD_REQUEST'
  | 'PROTOCOL_MISMATCH'
  | 'UNKNOWN_OP'
  | 'BAD_JSON'
  | 'INTERNAL'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'WORKER_UNAVAILABLE'
  | 'DECODE_ERROR';

export interface WorkerFailure {
  code: WorkerErrorCode;
  message: string;
}

export type WorkerResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: WorkerFailure };

export interface WorkerCapabilities {
  protocol: number;
  python: string;
  formats: string[];
  optional: Record<string, boolean>;
}

export interface ExtractedDocument {
  path: string;
  kind: string;
  sizeBytes: number;
  modifiedAt: number;
  text: string;
  metadata: Record<string, unknown>;
  pages: number | null;
}

export interface TranscribedAudio {
  text: string;
  language: string;
  audioSeconds?: number;
  processingMs?: number;
  backend?: string;
}

export interface SynthesizedAudio {
  outputPath: string;
  sampleRate: number;
  durationSeconds: number;
  processingMs?: number;
}

export interface PythonWorkerOptions {
  /** Interpreter to run. Defaults to the configured or discovered python. */
  pythonPath?: string;
  /** Directory containing `pixel_worker/worker.py`. */
  workerRoot?: string;
  /** Controlled local model directory passed to the worker. */
  modelRoot?: string;
  /** Frozen worker executable included in packaged releases. */
  packagedWorkerPath?: string;
  /** Packaged releases must never fall back to a global Python interpreter. */
  requirePackagedWorker?: boolean;
  /** Per-request limit. */
  requestTimeoutMs?: number;
  /** How many automatic restarts are allowed before giving up. */
  maxRestarts?: number;
  /** Called for diagnostics; must not log payload contents. */
  onLog?: (line: string) => void;
}

interface Pending {
  resolve: (value: WorkerResult<unknown>) => void;
  timer: NodeJS.Timeout;
  operation: string;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** How the worker can be reached right now. */
export interface WorkerAvailability {
  available: boolean;
  reason?: string;
  pythonPath?: string;
  packagedExecutable?: boolean;
}

export class PythonWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private nextId = 0;
  private restarts = 0;
  private capabilitiesCache: WorkerCapabilities | null = null;
  private starting: Promise<void> | null = null;
  private voiceUnloadTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<Pick<PythonWorkerOptions, 'requestTimeoutMs' | 'maxRestarts'>> &
    PythonWorkerOptions;

  constructor(options: PythonWorkerOptions = {}) {
    this.options = {
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      maxRestarts: options.maxRestarts ?? 2,
      ...options,
    };
  }

  /** Is a usable interpreter present? Checks once per call, cheaply. */
  availability(): WorkerAvailability {
    const python = this.resolvePython();
    if (!python) {
      return {
        available: false,
        reason: this.options.requirePackagedWorker
          ? 'Pixel’s bundled speech worker is missing. Reinstall Pixel to repair the local voice runtime.'
          : 'No Python interpreter was found. Document features need Python 3.10+ with PyMuPDF, python-docx and openpyxl.',
      };
    }
    const script = this.resolveScript();
    if (!this.options.requirePackagedWorker && !existsSync(script)) {
      return { available: false, reason: `Document worker script is missing: ${script}` };
    }
    return { available: true, pythonPath: python, packagedExecutable: this.options.requirePackagedWorker === true };
  }

  /** Start the worker if it is not running, then ask what it can do. */
  async capabilities(): Promise<WorkerResult<WorkerCapabilities>> {
    if (this.capabilitiesCache) return { ok: true, result: this.capabilitiesCache };

    const response = await this.send<WorkerCapabilities>('capabilities', {});
    if (response.ok) this.capabilitiesCache = response.result;
    return response;
  }

  async extract(path: string, signal?: AbortSignal): Promise<WorkerResult<ExtractedDocument>> {
    return this.send<ExtractedDocument>('extract', { path }, this.options.requestTimeoutMs, signal);
  }

  /** Optional offline faster-whisper path. It never downloads a model. */
  async transcribeAudio(path: string, model: string, modelPath: string | null, signal?: AbortSignal): Promise<WorkerResult<TranscribedAudio>> {
    const result = await this.send<TranscribedAudio>('transcribe_audio', { path, model, model_path: modelPath }, 180_000, signal);
    this.scheduleVoiceModelUnload();
    return result;
  }

  async synthesizeKokoro(
    text: string,
    voice: string,
    speed: number,
    modelPath: string,
    voicesPath: string,
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<WorkerResult<SynthesizedAudio>> {
    const result = await this.send<SynthesizedAudio>('synthesize_kokoro', {
      text, voice, speed, model_path: modelPath, voices_path: voicesPath, output_path: outputPath,
    }, 90_000, signal);
    this.scheduleVoiceModelUnload();
    return result;
  }

  async unloadVoiceModels(): Promise<WorkerResult<{ unloaded: boolean }>> {
    if (this.voiceUnloadTimer) clearTimeout(this.voiceUnloadTimer);
    this.voiceUnloadTimer = null;
    return this.send<{ unloaded: boolean }>('unload_voice_models', {}, 5_000);
  }

  get hasPendingRequests(): boolean {
    return this.pending.size > 0;
  }

  /** Stop the worker. Safe to call when it is not running. */
  async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) return;

    if (this.voiceUnloadTimer) clearTimeout(this.voiceUnloadTimer);
    this.voiceUnloadTimer = null;

    try {
      await this.send('shutdown', {}, 2_000);
    } catch {
      // Fall through to the kill below.
    }
    this.child = null;
    this.buffer = '';
    this.failAllPending({ code: 'WORKER_UNAVAILABLE', message: 'The worker was shut down.' });
    terminateProcessTree(child);
  }

  /** True when a worker process is currently running. */
  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /* ------------------------------ internals --------------------------- */

  private async send<T>(
    op: string,
    params: Record<string, unknown>,
    timeoutMs = this.options.requestTimeoutMs,
    signal?: AbortSignal,
  ): Promise<WorkerResult<T>> {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'CANCELLED', message: `The "${op}" request was cancelled before it started.` } };
    }
    const started = await this.ensureStarted();
    if (!started.ok) return started;
    if (signal?.aborted) {
      return { ok: false, error: { code: 'CANCELLED', message: `The "${op}" request was cancelled before it was sent.` } };
    }

    const child = this.child;
    if (!child || child.stdin.destroyed) {
      return {
        ok: false,
        error: { code: 'WORKER_UNAVAILABLE', message: 'The worker is not running.' },
      };
    }

    const id = String(++this.nextId);
    const payload = JSON.stringify({ id, op, protocol: WORKER_PROTOCOL_VERSION, params });

    return new Promise<WorkerResult<T>>((resolve) => {
      let settled = false;
      const finish = (result: WorkerResult<unknown>): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result as WorkerResult<T>);
      };
      const onAbort = (): void => {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
        }
        finish({ ok: false, error: { code: 'CANCELLED', message: `The "${op}" request was cancelled; its worker was stopped.` } });
        this.terminateWorker('The local worker was stopped after cancellation.');
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        finish({
          ok: false,
          error: {
            code: 'TIMEOUT',
            message: `The "${op}" request took longer than ${String(timeoutMs)} ms.`,
          },
        });
        this.terminateWorker('The local worker was stopped after a request timeout.');
      }, timeoutMs);

      this.pending.set(id, {
        resolve: finish,
        timer,
        operation: op,
        signal,
        onAbort,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }

      try {
        child.stdin.write(`${payload}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        finish({
          ok: false,
          error: {
            code: 'WORKER_UNAVAILABLE',
            message: `Could not send the request: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    });
  }

  private async ensureStarted(): Promise<WorkerResult<never> | { ok: true; result: undefined }> {
    if (this.isRunning) return { ok: true, result: undefined };
    if (this.starting) {
      await this.starting;
      return this.isRunning
        ? { ok: true, result: undefined }
        : {
            ok: false,
            error: { code: 'WORKER_UNAVAILABLE', message: 'The worker failed to start.' },
          };
    }

    const availability = this.availability();
    if (!availability.available) {
      return {
        ok: false,
        error: { code: 'CAPABILITY_MISSING', message: availability.reason ?? 'Python unavailable.' },
      };
    }

    this.starting = new Promise<void>((resolve, reject) => {
      const args = availability.packagedExecutable ? [] : ['-u', this.resolveScript()];
      const child = spawn(availability.pythonPath ?? 'python', args, {
        cwd: availability.packagedExecutable ? (this.options.packagedWorkerPath ? join(this.options.packagedWorkerPath, '..') : this.resolveWorkerDir()) : this.resolveWorkerDir(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(this.options.modelRoot ? { PIXEL_VOICE_MODEL_ROOT: this.options.modelRoot } : {}),
        },
      });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim().length > 0) this.options.onLog?.(`worker: ${line.trim()}`);
        }
      });

      child.on('error', (error) => {
        this.child = null;
        reject(
          new Error(`Could not start the Python worker: ${error.message}. Set PIXEL_PYTHON to an interpreter path.`),
        );
      });

      child.on('exit', (code) => {
        this.child = null;
        this.options.onLog?.(`worker exited with code ${String(code)}`);
        this.failAllPending({
          code: 'WORKER_UNAVAILABLE',
          message: `The local worker stopped unexpectedly (exit code ${String(code)}).`,
        });
      });

      this.child = child;
      // The process is considered started once it is spawnable; readiness is
      // proven by the first request (capabilities is sent immediately by callers).
      resolve();
    }).finally(() => {
      this.starting = null;
    });

    try {
      await this.starting;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'WORKER_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    this.restarts += 1;
    if (this.restarts > this.options.maxRestarts + 1) {
      return {
        ok: false,
        error: {
          code: 'WORKER_UNAVAILABLE',
          message: `The local worker restarted more than ${String(this.options.maxRestarts)} times. It is probably misconfigured.`,
        },
      };
    }

    return { ok: true, result: undefined };
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.handleFrame(line);
      newline = this.buffer.indexOf('\n');
    }
    // A malformed stream must not grow without bound.
    if (this.buffer.length > 4 * 1024 * 1024) this.buffer = '';
  }

  private handleFrame(line: string): void {
    let frame: {
      id?: string | null;
      ok?: boolean;
      result?: unknown;
      error?: { code?: string; message?: string };
    };

    try {
      frame = JSON.parse(line) as typeof frame;
    } catch {
      this.options.onLog?.(`worker emitted a non-JSON line: ${line.slice(0, 200)}`);
      return;
    }

    const pending = frame.id ? this.pending.get(frame.id) : undefined;
    if (!pending) return;

    this.pending.delete(frame.id as string);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.onAbort!);

    if (frame.ok) {
      pending.resolve({ ok: true, result: frame.result as unknown });
      return;
    }

    pending.resolve({
      ok: false,
      error: {
        code: (frame.error?.code ?? 'INTERNAL') as WorkerErrorCode,
        message: frame.error?.message ?? 'The worker reported an unspecified error.',
      },
    });
  }

  private failAllPending(error: WorkerFailure): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener('abort', pending.onAbort!);
      pending.resolve({ ok: false, error });
    }
    this.pending.clear();
  }

  private terminateWorker(message: string): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    if (this.voiceUnloadTimer) clearTimeout(this.voiceUnloadTimer);
    this.voiceUnloadTimer = null;
    this.buffer = '';
    this.failAllPending({ code: 'CANCELLED', message });
    terminateProcessTree(child);
  }

  private scheduleVoiceModelUnload(): void {
    if (this.voiceUnloadTimer) clearTimeout(this.voiceUnloadTimer);
    this.voiceUnloadTimer = setTimeout(() => {
      this.voiceUnloadTimer = null;
      if (this.isRunning && this.pending.size === 0) void this.unloadVoiceModels();
    }, VOICE_MODEL_IDLE_UNLOAD_MS);
    this.voiceUnloadTimer.unref();
  }

  private resolvePython(): string | null {
    if (this.options.requirePackagedWorker) {
      const bundled = this.options.packagedWorkerPath;
      return bundled && existsSync(bundled) ? bundled : null;
    }
    const configured = this.options.pythonPath ?? process.env.PIXEL_PYTHON;
    if (configured && configured.trim().length > 0) {
      if (configured === 'python' || configured === 'py') return configured;
      if (existsSync(configured)) return configured;
    }

    const candidates = [
      join(process.resourcesPath ?? '', 'python', 'python.exe'),
      join(process.cwd(), 'python', '.venv', 'Scripts', 'python.exe'),
      'python',
      'py',
    ];
    for (const candidate of candidates) {
      if (candidate === 'python' || candidate === 'py') return candidate;
      if (existsSync(candidate)) return candidate;
    }
    return 'python';
  }

  private resolveWorkerDir(): string {
    return this.options.workerRoot ?? join(process.cwd(), 'python');
  }

  private resolveScript(): string {
    return join(this.resolveWorkerDir(), 'pixel_worker', 'worker.py');
  }
}
