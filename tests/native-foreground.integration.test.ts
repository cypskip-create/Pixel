import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NativeHelper } from '../src/main/services/nativeHelper';

const enabled = process.platform === 'win32' && process.env.PIXEL_FOREGROUND_INTEGRATION === '1';
const hostProcessIds = [
  process.pid,
  ...(process.env.PIXEL_HOST_PIDS ?? '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0),
];
const helper = enabled
  ? new NativeHelper({
    executablePath: resolve('native/bin/PixelNative.exe'),
    hostProcessIds,
  })
  : null;

describe.skipIf(!enabled)('Windows foreground tracking integration', () => {
  afterAll(async () => {
    helper?.dispose();
    await helper?.whenStopped();
  });

  it('reads real desktop metadata, excludes configured Pixel processes and keeps HWND private', async () => {
    if (!helper) throw new Error('Windows foreground helper was not initialized.');
    await helper.startForegroundTracking();
    const status = await helper.call('ping', {});
    expect(['win-event', 'polling-fallback']).toContain(status.trackingMode);

    const foreground = await helper.call('foreground_window', {});
    expect(foreground).not.toBeNull();
    if (!foreground) throw new Error('Windows did not return a foreground window.');
    expect(foreground).toMatchObject({
      windowId: expect.any(String),
      title: expect.any(String),
      processName: expect.any(String),
      pid: expect.any(Number),
      observedAt: expect.any(Number),
      rect: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) },
      isMinimized: expect.any(Boolean),
    });
    expect(Object.keys(foreground).join(' ')).not.toMatch(/handle|hwnd/i);

    const external = await helper.listExternalWindows();
    expect(external.windows.length).toBeLessThanOrEqual(50);
    expect(external.windows.some((window) => hostProcessIds.includes(window.pid))).toBe(false);
    for (const window of external.windows) {
      expect(Object.keys(window).join(' ')).not.toMatch(/handle|hwnd/i);
    }

    const last = await helper.lastExternalForegroundWindow();
    if (last.status === 'available') {
      expect(hostProcessIds).not.toContain(last.window.pid);
      expect(last.window.observedAt).toBeGreaterThan(0);
    }
    if (last.status === 'stale') {
      expect(last.window.observedAt).toBeGreaterThan(0);
      expect(last.reason).toMatch(/closed|process identity/i);
    }
    expect(['available', 'stale', 'unavailable']).toContain(last.status);
  });

  it('resolves a selected target only while that exact window is foreground', async () => {
    if (!helper) throw new Error('Windows foreground helper was not initialized.');
    const foreground = await helper.call('foreground_window', {});
    if (!foreground) throw new Error('Windows did not return a foreground window.');
    const resolved = await helper.resolveWindowTarget({
      targetWindowId: foreground.windowId,
      expectedWindowTitle: foreground.title,
      expectedProcessId: foreground.pid,
      expectedProcessName: foreground.processName,
    });
    expect(resolved.handle).toMatch(/^[0-9A-F]+$/i);
    expect(resolved.processStartTicks).toMatch(/^\d+$/);
    expect(resolved.window.windowId).toBe(foreground.windowId);
  });

  it('captures only the exact harmless foreground window and returns in-memory PNG bytes', async () => {
    if (!helper) throw new Error('Windows foreground helper was not initialized.');
    const foreground = await helper.call('foreground_window', {});
    if (!foreground) throw new Error('Windows did not return a foreground window.');
    if (hostProcessIds.includes(foreground.pid)) throw new Error('Focus a harmless external fixture window before running this capture test.');
    const captured = await helper.call('capture_window', {
      targetWindowId: foreground.windowId,
      expectedWindowTitle: foreground.title,
      expectedProcessId: foreground.pid,
      expectedProcessName: foreground.processName,
      requireForeground: true,
    });
    expect(captured.window.windowId).toBe(foreground.windowId);
    expect(captured.width).toBeGreaterThan(0);
    expect(captured.height).toBeGreaterThan(0);
    expect(captured.format).toBe('image/png');
    expect(Buffer.from(captured.base64, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(Object.keys(captured.window).join(' ')).not.toMatch(/handle|hwnd/i);
  });
});
