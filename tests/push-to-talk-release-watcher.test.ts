import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_TO_TALK_SAFETY_TIMEOUT_MS,
  PushToTalkReleaseWatcher,
} from '../src/main/services/pushToTalkReleaseWatcher';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

function fakeChild(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough;
    exitCode: number | null; signalCode: NodeJS.Signals | null; pid: number | undefined;
    killed: boolean; kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = undefined;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0, null);
    return true;
  };
  return child as unknown as ChildProcessWithoutNullStreams;
}

describe('push-to-talk release watcher', () => {
  afterEach(() => vi.useRealTimers());

  it('passes only the configured chord to the short-lived native helper', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const watcher = new PushToTalkReleaseWatcher({
      executablePath: 'PixelNative.exe', platform: 'win32', exists: () => true,
      spawnFn: spawn as never,
    });
    const operation = watcher.watch('Control+Shift+Space');
    expect(spawn).toHaveBeenCalledWith('PixelNative.exe', ['--watch-ptt-release', 'Control+Shift+Space']);
    (child.stdout as PassThrough).write('released\n');
    child.emit('close', 0);
    await expect(operation).resolves.toBe('released');
  });

  it('returns unavailable after synchronous helper spawn failure without leaving a stuck session', async () => {
    const child = fakeChild();
    const spawn = vi.fn().mockImplementationOnce(() => { throw new Error('missing helper'); }).mockReturnValue(child);
    const watcher = new PushToTalkReleaseWatcher({
      executablePath: 'PixelNative.exe', platform: 'win32', exists: () => true,
      spawnFn: spawn as never,
    });
    await expect(watcher.watch('Control+Shift+Space')).resolves.toBe('unavailable');
    const next = watcher.watch('Control+Shift+Space');
    (child.stdout as PassThrough).write('released\n');
    child.emit('close', 0);
    await expect(next).resolves.toBe('released');
  });

  it('reports an unexpected helper crash and allows the next hold to start cleanly', async () => {
    const crashedChild = fakeChild();
    const recoveredChild = fakeChild();
    const children = [crashedChild, recoveredChild];
    const watcher = new PushToTalkReleaseWatcher({
      executablePath: 'PixelNative.exe', platform: 'win32', exists: () => true,
      spawnFn: (() => children.shift() as ChildProcessWithoutNullStreams) as never,
    });

    const failedOperation = watcher.watch('Control+Shift+Space');
    crashedChild.emit('close', 1);
    await expect(failedOperation).resolves.toBe('failed');

    const recoveredOperation = watcher.watch('Control+Shift+Space');
    (recoveredChild.stdout as PassThrough).write('released\n');
    recoveredChild.emit('close', 0);
    await expect(recoveredOperation).resolves.toBe('released');
  });

  it('terminates the watcher on cancellation and applies the safety timeout', async () => {
    const child = fakeChild();
    const watcher = new PushToTalkReleaseWatcher({
      executablePath: 'PixelNative.exe', platform: 'win32', exists: () => true,
      spawnFn: (() => child) as never,
    });
    const operation = watcher.watch('Control+Shift+Space');
    await watcher.cancel();
    await expect(operation).resolves.toBe('cancelled');
    expect(child.killed).toBe(true);

    vi.useFakeTimers();
    const timedChild = fakeChild();
    const timed = new PushToTalkReleaseWatcher({
      executablePath: 'PixelNative.exe', platform: 'win32', exists: () => true,
      spawnFn: (() => timedChild) as never,
    });
    const timedOperation = timed.watch('Control+Shift+Space');
    await vi.advanceTimersByTimeAsync(PUSH_TO_TALK_SAFETY_TIMEOUT_MS + 2_000);
    await expect(timedOperation).resolves.toBe('timeout');
    expect(timedChild.killed).toBe(true);
  });
});
