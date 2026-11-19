import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { hasProcessExited, terminateProcessTreeAndWait } from './process';

export const PUSH_TO_TALK_SAFETY_TIMEOUT_MS = 20_000;
export type PushToTalkReleaseReason = 'released' | 'timeout' | 'cancelled' | 'unavailable' | 'failed';
export type PushToTalkSpawn = (file: string, args: string[]) => ChildProcessWithoutNullStreams;

/**
 * Starts a short-lived native watcher only after the registered PTT chord is
 * pressed. The helper samples only the configured chord, never arbitrary key
 * events. The microphone session is separately bounded to the same duration.
 */
export class PushToTalkReleaseWatcher {
  private child: ChildProcessWithoutNullStreams | null = null;
  private promise: Promise<PushToTalkReleaseReason> | null = null;
  private settle: ((reason: PushToTalkReleaseReason) => void) | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;
  private output = '';
  private requestedTerminal: PushToTalkReleaseReason | null = null;
  private readonly platform: NodeJS.Platform;
  private readonly executablePath: string;
  private readonly exists: (path: string) => boolean;
  private readonly spawnFn: PushToTalkSpawn;

  constructor(options: {
    executablePath: string;
    platform?: NodeJS.Platform;
    exists?: (path: string) => boolean;
    spawnFn?: PushToTalkSpawn;
  }) {
    this.executablePath = options.executablePath;
    this.platform = options.platform ?? process.platform;
    this.exists = options.exists ?? (() => true);
    this.spawnFn = options.spawnFn ?? ((file, args) => spawn(file, args, {
      windowsHide: true,
      stdio: 'pipe',
    }));
  }

  available(): boolean {
    return this.platform === 'win32' && this.exists(this.executablePath);
  }

  watch(accelerator: string): Promise<PushToTalkReleaseReason> {
    if (this.promise) return this.promise;
    if (!this.available()) return Promise.resolve('unavailable');

    this.output = '';
    this.requestedTerminal = null;
    let resolveOperation!: (reason: PushToTalkReleaseReason) => void;
    this.promise = new Promise<PushToTalkReleaseReason>((resolve) => { resolveOperation = resolve; });
    const operation = this.promise;
    this.settle = resolveOperation;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn(this.executablePath, ['--watch-ptt-release', accelerator]);
    } catch {
      this.requestedTerminal = 'unavailable';
      this.finish('unavailable');
      return operation;
    }
    this.child = child;
    child.stdout.on('data', (chunk: Buffer | string) => {
      this.output = (this.output + String(chunk)).slice(-256);
    });
    child.once('error', () => {
      this.requestedTerminal = 'unavailable';
      this.finish('unavailable');
    });
    child.once('close', (code) => {
      if (this.requestedTerminal) {
        this.finish(this.requestedTerminal);
        return;
      }
      const output = this.output.trim().toLowerCase();
      if (output === 'released') this.finish('released');
      else if (output === 'timeout' || code === 2) this.finish('timeout');
      else if (output === 'unavailable' || code === 3) this.finish('unavailable');
      else this.finish('failed');
    });
    this.safetyTimer = setTimeout(() => {
      this.requestedTerminal = 'timeout';
      void this.stopTree().finally(() => this.finish('timeout'));
    }, PUSH_TO_TALK_SAFETY_TIMEOUT_MS + 2_000);
    return operation;
  }

  async cancel(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.finish('cancelled');
      return;
    }
    this.requestedTerminal = 'cancelled';
    const stopped = await this.stopTree();
    if (stopped || this.child !== child || hasProcessExited(child)) this.finish('cancelled');
    else this.finish('failed');
  }

  private async stopTree(): Promise<boolean> {
    const child = this.child;
    if (!child || hasProcessExited(child)) return true;
    try {
      return await terminateProcessTreeAndWait(child, 1_500);
    } catch {
      return false;
    }
  }

  private finish(reason: PushToTalkReleaseReason): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
    const resolve = this.settle;
    this.settle = null;
    this.child = null;
    this.promise = null;
    this.requestedTerminal = null;
    resolve?.(reason);
  }
}
