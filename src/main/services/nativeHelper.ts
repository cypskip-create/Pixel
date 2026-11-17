import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Rect } from '../../shared/companion/geometry';
import { hasProcessExited, terminateProcessTreeAndWait } from './process';

/**
 * Client for PixelNative.exe, the small C# helper that reads the Windows UI
 * Automation tree.
 *
 * Why a separate process: UI Automation is a Windows COM API with first-class
 * support in .NET and none in Node. Doing it natively gives exact element
 * rectangles, which are far more reliable than estimating positions from a
 * screenshot.
 *
 * The helper observes window metadata and elements, and has one bounded
 * InvokePattern action for an exact unique control in a selected window with an
 * explicit UIA postcondition. Pixel's permission gateway must approve it, and the
 * helper rechecks the selected window and process identity before invoking. It
 * has no coordinate click, typing, or arbitrary script API.
 *
 * Lifecycle: the metadata-only foreground observer starts before Pixel's
 * windows. Other native operations share its process and the executor stops it
 * during shutdown/emergency handling.
 */

export interface WindowInfo {
  /** Opaque per-helper-session target identifier; never contains the HWND. */
  windowId: string;
  title: string;
  processName: string;
  pid: number;
  observedAt: number;
  /** Physical screen pixels. Convert with the display's scale before drawing. */
  rect: Rect;
  isMinimized: boolean;
}

export type LastExternalWindowResult =
  | { status: 'available'; window: WindowInfo }
  | { status: 'stale'; window: WindowInfo; reason: string }
  | { status: 'unavailable'; reason: string };

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
  /** Optional explicit target from a recent foreground/list observation. */
  targetWindowId?: string;
  expectedWindowTitle?: string;
  expectedProcessId?: number;
  expectedProcessName?: string;
}

export interface VerifyElementStateQuery {
  selector: string;
  targetWindowId: string;
  expectedWindowTitle: string;
  expectedProcessId: number;
  expectedProcessName: string;
  state: 'present' | 'absent';
  role?: string;
}

export interface NativeCommands {
  ping: { args: Record<string, never>; result: { version: string; trackingMode?: string } };
  foreground_window: { args: Record<string, never>; result: WindowInfo | null };
  last_external_foreground_window: { args: Record<string, never>; result: LastExternalWindowResult };
  list_external_windows: { args: Record<string, never>; result: { windows: WindowInfo[]; truncated: boolean } };
  resolve_window_target: {
    args: { targetWindowId: string; expectedWindowTitle: string; expectedProcessId: number; expectedProcessName: string };
    /** HWND stays inside the main process and is never returned to React or the model. */
    result: { handle: string; processStartTicks: string; window: WindowInfo };
  };
  find_elements: { args: FindElementsQuery; result: { window: WindowInfo; elements: UiElement[]; truncated: boolean } };
  verify_element_state: { args: VerifyElementStateQuery; result: { window: WindowInfo; matches: boolean; matchedCount: number; element?: UiElement } };
  invoke_element: {
    args: { selector: string; targetWindowId: string; expectedWindowTitle: string; expectedProcessId: number; expectedProcessName: string; role?: string; expectedResult: { selector: string; state: 'present' | 'absent'; role?: string } };
    result: { window: WindowInfo; element: UiElement; invoked: true };
  };
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
  /** Grace period for tree termination, followed by a direct force-kill attempt. */
  terminationGraceMs?: number;
  /** Stop the helper after this long without a request. */
  idleStopMs?: number;
  /** Pixel-owned process IDs whose windows the observer must ignore. */
  hostProcessIds?: number[];
  spawnFn?: SpawnFn;
  /** Does the executable exist? Injected so tests need no filesystem. */
  exists?: (path: string) => boolean;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: NativeHelperError) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class NativeHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping: Promise<boolean> | null = null;
  private quarantined = false;
  private trackingRequested = false;
  private readonly stoppedWaiters = new Set<() => void>();
  private readonly options: Required<Omit<NativeHelperOptions, 'spawnFn' | 'exists'>> & {
    spawnFn: SpawnFn;
    exists: (path: string) => boolean;
    hostProcessIds: number[];
  };

  constructor(options: NativeHelperOptions) {
    const hostProcessIds = [...new Set((options.hostProcessIds ?? [process.pid]).filter((pid) => Number.isInteger(pid) && pid > 0))];
    this.options = {
      executablePath: options.executablePath,
      platform: options.platform ?? process.platform,
      requestTimeoutMs: options.requestTimeoutMs ?? 5000,
      terminationGraceMs: options.terminationGraceMs ?? 1500,
      idleStopMs: options.idleStopMs ?? 60_000,
      hostProcessIds,
      spawnFn: options.spawnFn ?? ((file) => spawn(file, [], {
        windowsHide: true,
        stdio: 'pipe',
        env: { ...process.env, PIXEL_HOST_PIDS: hostProcessIds.join(',') },
      })),
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
    if (this.stopping || this.quarantined) {
      throw new NativeHelperError('PixelNative.exe is still stopping after an interrupted request; no new request was sent.', 'UNAVAILABLE');
    }

    const child = this.ensureStarted();
    this.touchIdle();

    const id = this.nextId++;
    return new Promise<NativeCommands[K]['result']>((resolve, reject) => {
      const onAbort = (): void => {
        const entry = this.pending.get(id);
        if (!entry) return;
        void this.stopForPending(
          id,
          new NativeHelperError(`"${command}" was cancelled. PixelNative.exe is being stopped; the action may have partly completed.`, 'CANCELLED'),
          new NativeHelperError('PixelNative.exe was stopped because another request was cancelled; this request result is unknown.', 'CRASHED'),
        );
      };
      const timer = setTimeout(() => {
        const entry = this.pending.get(id);
        if (!entry) return;
        void this.stopForPending(
          id,
          new NativeHelperError(`"${command}" timed out. PixelNative.exe is being stopped before the desktop input lease can be released; the action outcome may be unknown.`, 'TIMEOUT'),
          new NativeHelperError('PixelNative.exe was stopped after another request timed out; this request result is unknown.', 'CRASHED'),
        );
      }, this.options.requestTimeoutMs);
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        child.stdin.write(`${JSON.stringify({ id, cmd: command, args })}\n`, (error) => {
          if (error) {
            void this.stopForPending(
              id,
              new NativeHelperError('Could not talk to PixelNative.exe; its process is being stopped.', 'CRASHED'),
              new NativeHelperError('PixelNative.exe stopped while another request was pending; this request result is unknown.', 'CRASHED'),
            );
          }
        });
      } catch {
        void this.stopForPending(
          id,
          new NativeHelperError('Could not talk to PixelNative.exe; its process is being stopped.', 'CRASHED'),
          new NativeHelperError('PixelNative.exe stopped while another request was pending; this request result is unknown.', 'CRASHED'),
        );
      }
    });
  }

  /** Start the in-memory observer before Pixel's own windows are created. */
  async startForegroundTracking(): Promise<void> {
    this.trackingRequested = true;
    await this.call('ping', {});
  }

  async lastExternalForegroundWindow(signal?: AbortSignal): Promise<LastExternalWindowResult> {
    await this.ensureForegroundTracking(signal);
    return this.call('last_external_foreground_window', {}, signal);
  }

  async listExternalWindows(signal?: AbortSignal): Promise<{ windows: WindowInfo[]; truncated: boolean }> {
    await this.ensureForegroundTracking(signal);
    return this.call('list_external_windows', {}, signal);
  }

  async resolveWindowTarget(
    args: NativeCommands['resolve_window_target']['args'],
    signal?: AbortSignal,
  ): Promise<NativeCommands['resolve_window_target']['result']> {
    await this.ensureForegroundTracking(signal);
    return this.call('resolve_window_target', args, signal);
  }

  /** Stop the helper. Pending calls settle only after termination is confirmed or bounded killing fails. */
  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const stopped = new NativeHelperError('PixelNative.exe was stopped; an in-flight action may have partly completed.', 'CANCELLED');
    void this.stopForPending(undefined, stopped, stopped);
  }

  /** True while a helper process is running. */
  get running(): boolean {
    return this.child !== null;
  }

  /** True while the helper is being stopped or its termination is unconfirmed. */
  get terminating(): boolean {
    return this.stopping !== null || this.quarantined;
  }

  /** Resolves only after the native process is confirmed stopped. */
  whenStopped(): Promise<void> {
    if (!this.terminating && this.child === null) return Promise.resolve();
    return new Promise<void>((resolve) => this.stoppedWaiters.add(resolve));
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !hasProcessExited(this.child)) return this.child;
    if (this.child) {
      this.child = null;
      this.quarantined = false;
      if (!this.stopping) {
        this.failAll(new NativeHelperError('PixelNative.exe exited unexpectedly.', 'CRASHED'));
        this.resolveStoppedWaiters();
      }
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.options.spawnFn(this.options.executablePath);
    } catch (error) {
      throw new NativeHelperError(`PixelNative.exe could not be started: ${error instanceof Error ? error.message : String(error)}`, 'UNAVAILABLE');
    }
    this.child = child;

    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) return;
      this.quarantined = false;
      this.failAll(new NativeHelperError('PixelNative.exe stopped unexpectedly.', 'CRASHED'));
      this.resolveStoppedWaiters();
    });
    child.on('error', (error) => {
      if (this.child !== child) return;
      const failure = new NativeHelperError(
        `PixelNative.exe reported a process error: ${error.message}`,
        'UNAVAILABLE',
      );

      // An `error` event (for example, a failed kill) does not prove the OS
      // process is gone. Keep its identity and the input lease quarantined until
      // an `exit` event or an explicit process-state check confirms termination.
      if (hasProcessExited(child) || child.pid == null) {
        this.child = null;
        this.quarantined = false;
        this.failAll(failure);
        if (!this.stopping) this.resolveStoppedWaiters();
        return;
      }

      if (!this.stopping) {
        void this.stopForPending(undefined, failure, failure);
      }
    });
    return child;
  }

  private onLine(line: string): void {
    if (this.stopping || this.quarantined) return;
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
    entry.cleanup();
    if (message.ok === true) entry.resolve(message.result);
    else entry.reject(new NativeHelperError(String(message.error ?? 'The helper reported an error.'), 'FAILED'));
  }

  private failAll(error: NativeHelperError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.cleanup();
      entry.reject(error);
    }
    this.pending.clear();
  }

  private failPending(
    triggerId: number | undefined,
    triggerError: NativeHelperError,
    otherError: NativeHelperError,
  ): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.cleanup();
      entry.reject(triggerId === undefined || triggerId === id ? triggerError : otherError);
    }
    this.pending.clear();
  }

  private stopForPending(
    triggerId: number | undefined,
    triggerError: NativeHelperError,
    otherError: NativeHelperError,
  ): Promise<boolean> {
    if (this.stopping) return this.stopping;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.child;
    if (!child) {
      this.failPending(triggerId, triggerError, otherError);
      this.resolveStoppedWaiters();
      return Promise.resolve(true);
    }

    let finish!: (terminated: boolean) => void;
    const stopped = new Promise<boolean>((resolve) => { finish = resolve; });
    this.stopping = stopped;
    void terminateProcessTreeAndWait(child, this.options.terminationGraceMs).then((terminated) => {
      const confirmedStopped = terminated || this.child !== child || hasProcessExited(child);
      if (confirmedStopped) {
        if (this.child === child) this.child = null;
        this.quarantined = false;
        this.failPending(triggerId, triggerError, otherError);
        this.stopping = null;
        this.resolveStoppedWaiters();
        finish(true);
        return;
      }

      // The action's caller receives its timeout/cancellation, but calls remain
      // disabled and the input lease stays held until the exit event arrives.
      this.quarantined = true;
      const uncertainError = triggerError.code === 'TIMEOUT'
        ? new NativeHelperError(`${triggerError.message} Termination could not be confirmed within the bounded kill window; the action outcome is unknown and desktop input remains locked.`, 'TIMEOUT')
        : new NativeHelperError(`${triggerError.message} Termination could not be confirmed within the bounded kill window; desktop input remains locked.`, triggerError.code);
      this.failPending(triggerId, uncertainError, otherError);
      this.stopping = null;
      finish(false);
    }).catch((error: unknown) => {
      this.quarantined = this.child === child && !hasProcessExited(child);
      this.failPending(
        triggerId,
        new NativeHelperError(`PixelNative.exe termination failed: ${error instanceof Error ? error.message : String(error)}. Desktop input remains locked until exit is confirmed.`, triggerError.code),
        otherError,
      );
      this.stopping = null;
      if (!this.quarantined) this.resolveStoppedWaiters();
      finish(false);
    });
    return stopped;
  }

  private resolveStoppedWaiters(): void {
    if (this.child !== null || this.stopping !== null || this.quarantined) return;
    for (const resolve of this.stoppedWaiters) resolve();
    this.stoppedWaiters.clear();
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    // Keep only the small native event observer alive while Pixel is running.
    if (this.trackingRequested) return;
    this.idleTimer = setTimeout(() => this.dispose(), this.options.idleStopMs);
    // Never keep the app alive just to stop an idle helper.
    this.idleTimer.unref?.();
  }

  private async ensureForegroundTracking(signal?: AbortSignal): Promise<void> {
    this.trackingRequested = true;
    if (signal?.aborted) throw new NativeHelperError('The request was cancelled.', 'CANCELLED');
    // The helper installs the event hook and snapshots the current foreground
    // before reading commands. Ping is a bounded readiness/restart handshake.
    await this.call('ping', {}, signal);
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
