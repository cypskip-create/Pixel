import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Rect } from '../../shared/companion/geometry';

/**
 * Client for PixelNative.exe, the small C# helper that reads the Windows UI
 * Automation tree.
 *
 * Why a separate process: UI Automation is a Windows COM API with first-class
 * support in .NET and none in Node. Doing it natively gives exact element
 * rectangles, which are far more reliable than estimating positions from a
 * screenshot.
 *
 * The helper is strictly READ-ONLY. It can describe windows and elements; it has
 * no command that clicks, types or moves anything. Acting on what it finds still
 * goes through Pixel's normal tools and approvals.
 *
 * Lifecycle: it is started on first use and stopped after a short idle period,
 * so an idle Pixel runs no extra process.
 */

export interface WindowInfo {
  title: string;
  processName: string;
  pid: number;
  /** Physical screen pixels. Convert with the display's scale before drawing. */
  rect: Rect;
  isMinimized: boolean;
}

export interface UiElement {
  name: string;
  /** UI Automation control type, e.g. "Button", "Edit", "MenuItem". */
  role: string;
  automationId: string;
  /** Physical screen pixels. */
  rect: Rect;
  enabled: boolean;
}

export interface FindElementsQuery {
  /** Case-insensitive text to look for in the element's accessible name. */
  text: string;
  /** Optionally restrict to certain control types. */
  roles?: string[];
  maxResults?: number;
}

export interface NativeCommands {
  ping: { args: Record<string, never>; result: { version: string } };
  foreground_window: { args: Record<string, never>; result: WindowInfo | null };
  find_elements: { args: FindElementsQuery; result: { window: WindowInfo; elements: UiElement[]; truncated: boolean } };
}

export class NativeHelperError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'FAILED' | 'CRASHED',
  ) {
    super(message);
    this.name = 'NativeHelperError';
  }
}

export type SpawnFn = (file: string) => ChildProcessWithoutNullStreams;

export interface NativeHelperOptions {
  /** Absolute path to PixelNative.exe. */
  executablePath: string;
  platform?: NodeJS.Platform;
  requestTimeoutMs?: number;
  /** Stop the helper after this long without a request. */
  idleStopMs?: number;
  spawnFn?: SpawnFn;
  /** Does the executable exist? Injected so tests need no filesystem. */
  exists?: (path: string) => boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: NativeHelperError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NativeHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: Required<Omit<NativeHelperOptions, 'spawnFn' | 'exists'>> & {
    spawnFn: SpawnFn;
    exists: (path: string) => boolean;
  };

  constructor(options: NativeHelperOptions) {
    this.options = {
      executablePath: options.executablePath,
      platform: options.platform ?? process.platform,
      requestTimeoutMs: options.requestTimeoutMs ?? 5000,
      idleStopMs: options.idleStopMs ?? 60_000,
      spawnFn: options.spawnFn ?? ((file) => spawn(file, [], { windowsHide: true, stdio: 'pipe' })),
      exists: options.exists ?? (() => true),
    };
  }

  /** Is the native helper usable on this machine? */
  available(): { available: true } | { available: false; reason: string } {
    if (this.options.platform !== 'win32') {
      return { available: false, reason: 'Windows UI Automation is only available on Windows.' };
    }
    if (!this.options.exists(this.options.executablePath)) {
      return {
        available: false,
        reason: 'PixelNative.exe has not been built yet. Run scripts/build-native.ps1.',
      };
    }
    return { available: true };
  }

  async call<K extends keyof NativeCommands>(
    command: K,
    args: NativeCommands[K]['args'],
    signal?: AbortSignal,
  ): Promise<NativeCommands[K]['result']> {
    const status = this.available();
    if (!status.available) throw new NativeHelperError(status.reason, 'UNAVAILABLE');
    if (signal?.aborted) throw new NativeHelperError('The request was cancelled.', 'CANCELLED');

    const child = this.ensureStarted();
    this.touchIdle();

    const id = this.nextId++;
    return new Promise<NativeCommands[K]['result']>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NativeHelperError(`"${command}" took too long.`, 'TIMEOUT'));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });

      signal?.addEventListener(
        'abort',
        () => {
          const entry = this.pending.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.reject(new NativeHelperError('The request was cancelled.', 'CANCELLED'));
        },
        { once: true },
      );

      child.stdin.write(`${JSON.stringify({ id, cmd: command, args })}\n`, (error) => {
        if (error) this.failAll(new NativeHelperError('Could not talk to PixelNative.exe.', 'CRASHED'));
      });
    });
  }

  /** Stop the helper and fail anything still waiting. */
  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.failAll(new NativeHelperError('The helper was stopped.', 'CANCELLED'));
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill();
  }

  /** True while a helper process is running. */
  get running(): boolean {
    return this.child !== null;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;

    const child = this.options.spawnFn(this.options.executablePath);
    this.child = child;

    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.failAll(new NativeHelperError('PixelNative.exe stopped unexpectedly.', 'CRASHED'));
    });
    child.on('error', () => {
      if (this.child === child) this.child = null;
      this.failAll(new NativeHelperError('PixelNative.exe could not be started.', 'UNAVAILABLE'));
    });
    return child;
  }

  private onLine(line: string): void {
    let message: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return; // Ignore stray output; only well-formed responses count.
    }
    if (typeof message.id !== 'number') return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok === true) entry.resolve(message.result);
    else entry.reject(new NativeHelperError(String(message.error ?? 'The helper reported an error.'), 'FAILED'));
  }

  private failAll(error: NativeHelperError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.dispose(), this.options.idleStopMs);
    // Never keep the app alive just to stop an idle helper.
    this.idleTimer.unref?.();
  }
}

/**
 * Turn physical-pixel UI Automation rectangles into the DIP rectangles the rest of
 * the companion uses. The conversion is injected because it must come from
 * Electron's screen API (screenToDipPoint), which knows each display's scale.
 */
export function toDipRect(
  rect: Rect,
  screenToDip: (point: { x: number; y: number }) => { x: number; y: number },
): Rect {
  const topLeft = screenToDip({ x: rect.x, y: rect.y });
  const bottomRight = screenToDip({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}