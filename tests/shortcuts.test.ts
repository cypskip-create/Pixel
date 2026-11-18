import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
}));

import { globalShortcut } from 'electron';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { ShortcutManager, isSupportedPushToTalkAccelerator } from '../src/main/shortcuts';
import type { PushToTalkReleaseReason } from '../src/main/services/pushToTalkReleaseWatcher';

const settings = (): typeof DEFAULT_SETTINGS => structuredClone(DEFAULT_SETTINGS);

describe('global push-to-talk shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the configured exact chord and suppresses repeats during a hold', async () => {
    const handlers = new Map<string, () => void>();
    vi.mocked(globalShortcut.register).mockImplementation((accelerator, callback) => {
      handlers.set(accelerator, callback);
      return true;
    });
    let finish!: (reason: PushToTalkReleaseReason) => void;
    const watcher = {
      available: () => true,
      watch: vi.fn((accelerator: string) => {
        expect(accelerator).toBe('CommandOrControl+Shift+Space');
        return new Promise<PushToTalkReleaseReason>((resolve) => { finish = resolve; });
      }),
      cancel: vi.fn(async () => undefined),
    };
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const manager = new ShortcutManager({ onToggle: vi.fn(), onEmergencyStop: vi.fn(), onPushToTalkStart: onStart, onPushToTalkEnd: onEnd }, watcher);

    const status = manager.apply(settings());
    expect(status.pushToTalk.ok).toBe(true);
    handlers.get('CommandOrControl+Shift+Space')?.();
    handlers.get('CommandOrControl+Shift+Space')?.();
    expect(onStart).toHaveBeenCalledOnce();
    expect(watcher.watch).toHaveBeenCalledOnce();

    finish('released');
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith('released'));
  });

  it('cancels recording once on emergency or shutdown', async () => {
    const handlers = new Map<string, () => void>();
    vi.mocked(globalShortcut.register).mockImplementation((accelerator, callback) => {
      handlers.set(accelerator, callback);
      return true;
    });
    let finish!: (reason: PushToTalkReleaseReason) => void;
    const watcher = {
      available: () => true,
      watch: vi.fn(() => new Promise<PushToTalkReleaseReason>((resolve) => { finish = resolve; })),
      cancel: vi.fn(async () => undefined),
    };
    const onEnd = vi.fn();
    const manager = new ShortcutManager({ onToggle: vi.fn(), onEmergencyStop: vi.fn(), onPushToTalkEnd: onEnd }, watcher);
    manager.apply(settings());
    handlers.get('CommandOrControl+Shift+Space')?.();
    manager.cancelPushToTalk();
    finish('cancelled');
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(onEnd).toHaveBeenCalledWith('cancelled');
    expect(watcher.cancel).toHaveBeenCalledOnce();
  });

  it('reports a conflict without starting microphone work', () => {
    const handlers = new Map<string, () => void>();
    vi.mocked(globalShortcut.register).mockImplementation((accelerator, callback) => {
      handlers.set(accelerator, callback);
      return accelerator !== 'CommandOrControl+Shift+Space';
    });
    const start = vi.fn();
    const watcher = { available: () => true, watch: vi.fn(async () => 'released' as const), cancel: vi.fn(async () => undefined) };
    const manager = new ShortcutManager({ onToggle: vi.fn(), onEmergencyStop: vi.fn(), onPushToTalkStart: start }, watcher);
    const result = manager.apply(settings());
    expect(result.pushToTalk.ok).toBe(false);
    expect(result.pushToTalk.reason).toMatch(/another application/i);
    handlers.get('CommandOrControl+Shift+Space')?.();
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses unsupported combinations and duplicate Pixel shortcuts', () => {
    expect(isSupportedPushToTalkAccelerator('Control+Shift+Space')).toBe(true);
    expect(isSupportedPushToTalkAccelerator('Space')).toBe(false);
    expect(isSupportedPushToTalkAccelerator('Control+Control+P')).toBe(false);
    expect(isSupportedPushToTalkAccelerator('Control+Shift+Ctrl+P')).toBe(false);
    expect(isSupportedPushToTalkAccelerator('Control+Shift+Ctrl')).toBe(false);

    const config = settings();
    config.voice.pushToTalkAccelerator = config.workspaceAccelerator;
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    const watcher = { available: () => true, watch: vi.fn(async () => 'released' as const), cancel: vi.fn(async () => undefined) };
    const result = new ShortcutManager({ onToggle: vi.fn(), onEmergencyStop: vi.fn() }, watcher).apply(config);
    expect(result.pushToTalk.ok).toBe(false);
    expect(result.pushToTalk.reason).toMatch(/conflicts/i);
    expect(watcher.watch).not.toHaveBeenCalled();
  });

  it('reports aliased modifier combinations as internal conflicts', () => {
    const config = settings();
    config.voice.pushToTalkAccelerator = 'Control+Shift+C';
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    const watcher = { available: () => true, watch: vi.fn(async () => 'released' as const), cancel: vi.fn(async () => undefined) };
    const result = new ShortcutManager({ onToggle: vi.fn(), onEmergencyStop: vi.fn() }, watcher).apply(config);
    expect(result.pushToTalk.ok).toBe(false);
    expect(result.pushToTalk.reason).toMatch(/conflicts/i);
  });
});
