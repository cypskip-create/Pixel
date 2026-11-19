import { beforeEach, describe, expect, it, vi } from 'vitest';

const { desktopCapturer, screen } = vi.hoisted(() => ({
  desktopCapturer: { getSources: vi.fn() },
  screen: {
    getAllDisplays: vi.fn(),
    getPrimaryDisplay: vi.fn(),
    getDisplayMatching: vi.fn(),
    screenToDipRect: vi.fn(),
  },
}));

vi.mock('electron', () => ({ desktopCapturer, screen }));

import { ScreenCapture } from '../src/main/screen';
import type { ScreenWindowTarget } from '../src/shared/types';
import type { NativeHelper } from '../src/main/services/nativeHelper';

const primary = {
  id: 1,
  label: 'Primary',
  size: { width: 1280, height: 720 },
  scaleFactor: 1.5,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
};
const left = {
  id: 2,
  label: 'Left',
  size: { width: 1280, height: 720 },
  scaleFactor: 1,
  bounds: { x: -1280, y: 0, width: 1280, height: 720 },
};
const target: ScreenWindowTarget = {
  windowId: 'opaque-window-A',
  title: 'Settings',
  processName: 'SystemSettings',
  pid: 42,
};

function image(width: number, height: number) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    toDataURL: () => 'data:image/png;base64,dGVzdA==',
    crop: vi.fn(function (this: unknown) { return image(1, 1); }),
  };
}

function makeCapture(options?: { displays?: typeof primary[]; ownPid?: number }) {
  const displays = options?.displays ?? [primary, left];
  const nativeCall = vi.fn(async (command: string, args: Record<string, unknown>) => {
    if (command === 'foreground_window') return { ...target, observedAt: 1, rect: { x: 20, y: 30, width: 800, height: 600 }, isMinimized: false };
    if (command === 'capture_window') {
      return {
        window: { ...target, observedAt: 2, rect: { x: 20, y: 30, width: 800, height: 600 }, isMinimized: false },
        width: 800, height: 600, format: 'image/png', base64: 'dGVzdA==',
      };
    }
    void args;
    throw new Error('Unexpected native command: ' + command);
  });
  const nativeHelper = {
    call: nativeCall,
    lastExternalForegroundWindow: vi.fn(async () => ({ status: 'unavailable' as const, reason: 'No external target was observed.' })),
    listExternalWindows: vi.fn(async () => ({ windows: [], truncated: false })),
  } as unknown as NativeHelper;
  screen.getAllDisplays.mockImplementation(() => displays);
  screen.getPrimaryDisplay.mockImplementation(() => displays[0]);
  screen.getDisplayMatching.mockImplementation((bounds: { x: number; y: number; width: number; height: number }) =>
    displays.find((display) => bounds.x >= display.bounds.x && bounds.x < display.bounds.x + display.bounds.width) ?? displays[0]);
  screen.screenToDipRect.mockImplementation((_display: unknown, rect: { x: number; y: number; width: number; height: number }) => ({ ...rect }));
  const capture = new ScreenCapture({
    isAuthorized: () => true,
    nativeHelper,
    ownProcessIds: () => [options?.ownPid ?? 999],
    now: () => 100,
  });
  return { capture, nativeCall, nativeHelper };
}

describe('reliable screen capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    screen.getAllDisplays.mockReturnValue([primary, left]);
    screen.getPrimaryDisplay.mockReturnValue(primary);
  });

  it('captures the exact current foreground identity, not a desktopCapturer source-order guess', async () => {
    const { capture, nativeCall } = makeCapture();
    const result = await capture.captureActiveWindow();
    expect(result.ok).toBe(true);
    expect(result.metadata).toMatchObject({
      targetType: 'window',
      targetWindow: target,
      source: 'native_print_window',
      cached: false,
      status: 'captured',
      capturedAt: 100,
    });
    expect(nativeCall).toHaveBeenNthCalledWith(1, 'foreground_window', {});
    expect(nativeCall).toHaveBeenNthCalledWith(2, 'capture_window', {
      targetWindowId: target.windowId,
      expectedWindowTitle: target.title,
      expectedProcessId: target.pid,
      expectedProcessName: target.processName,
      requireForeground: true,
    });
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('refuses to capture Pixel itself', async () => {
    const { capture, nativeCall } = makeCapture({ ownPid: target.pid });
    const result = await capture.captureActiveWindow();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('Pixel is foreground');
    expect(nativeCall).toHaveBeenCalledTimes(1);
  });

  it('preserves the opaque ID when two windows can share the same title', async () => {
    const { capture, nativeCall } = makeCapture();
    const result = await capture.captureSelectedWindow(target);
    expect(result.ok).toBe(true);
    expect(nativeCall).toHaveBeenCalledWith('capture_window', expect.objectContaining({
      targetWindowId: 'opaque-window-A',
      expectedWindowTitle: 'Settings',
      requireForeground: false,
    }));
    expect(result.metadata?.targetWindow?.windowId).toBe('opaque-window-A');
  });

  it('refuses a stale last-external target instead of substituting a window', async () => {
    const { capture, nativeHelper, nativeCall } = makeCapture();
    nativeHelper.lastExternalForegroundWindow = vi.fn(async () => ({ status: 'stale' as const, window: { ...target, observedAt: 1, rect: { x: 0, y: 0, width: 1, height: 1 }, isMinimized: false }, reason: 'The window closed.' }));
    const result = await capture.captureLastExternalWindow();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('The window closed');
    expect(nativeCall).not.toHaveBeenCalled();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('matches a requested display by ID and never uses source zero as fallback', async () => {
    const { capture } = makeCapture();
    const first = image(1280, 720);
    const selected = image(1920, 1080);
    desktopCapturer.getSources.mockResolvedValue([
      { id: 'screen:2:0', display_id: '2', thumbnail: first },
      { id: 'screen:1:0', display_id: '1', thumbnail: selected },
    ]);
    const result = await capture.captureDisplay('1');
    expect(result.ok).toBe(true);
    expect(result.image?.width).toBe(1920);
    expect(result.metadata).toMatchObject({ targetType: 'display', displayId: '1', pixelScale: { x: 1.5, y: 1.5 } });
  });

  it('discards a display capture when monitor scaling changes while pixels are being requested', async () => {
    const { capture } = makeCapture({ displays: [primary] });
    screen.getAllDisplays
      .mockReturnValueOnce([primary])
      .mockReturnValueOnce([{ ...primary, scaleFactor: 2 }]);
    desktopCapturer.getSources.mockResolvedValue([{ id: 'screen:1:0', display_id: '1', thumbnail: image(1920, 1080) }]);
    const result = await capture.captureDisplay('1');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('changed during capture');
  });

  it('captures a negative-coordinate region on its own monitor with measured pixel scaling', async () => {
    const { capture } = makeCapture();
    const leftImage = image(1280, 720);
    desktopCapturer.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: image(1920, 1080) },
      { id: 'screen:2:0', display_id: '2', thumbnail: leftImage },
    ]);
    const result = await capture.captureRegion({ x: -1200, y: 40, width: 400, height: 150 });
    expect(result.ok).toBe(true);
    expect(leftImage.crop).toHaveBeenCalledWith({ x: 80, y: 40, width: 400, height: 150 });
    expect(result.metadata).toMatchObject({ targetType: 'region', displayId: '2', bounds: { x: -1200, y: 40, width: 400, height: 150 } });
  });

  it('clips region right and bottom edges using the returned image dimensions', async () => {
    const { capture } = makeCapture({ displays: [primary] });
    const source = image(1920, 1080);
    desktopCapturer.getSources.mockResolvedValue([{ id: 'screen:1:0', display_id: '1', thumbnail: source }]);
    const result = await capture.captureRegion({ x: 1260, y: 700, width: 60, height: 50 });
    expect(result.ok).toBe(true);
    expect(source.crop).toHaveBeenCalledWith({ x: 1890, y: 1050, width: 30, height: 30 });
    expect(result.metadata?.bounds).toEqual({ x: 1260, y: 700, width: 20, height: 20 });
  });

  it('rejects regions crossing monitor boundaries and regions outside the virtual desktop', async () => {
    const { capture } = makeCapture();
    const crossing = await capture.captureRegion({ x: -8, y: 20, width: 32, height: 40 });
    const outside = await capture.captureRegion({ x: 3000, y: 3000, width: 80, height: 60 });
    expect(crossing.ok).toBe(false);
    expect(crossing.error?.message).toContain('crosses monitors');
    expect(outside.ok).toBe(false);
    expect(outside.error?.message).toContain('outside every connected display');
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('requires the explicit capture authorization before reading the native target', async () => {
    const { nativeHelper } = makeCapture();
    const capture = new ScreenCapture({ isAuthorized: () => false, nativeHelper });
    const result = await capture.captureActiveWindow();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(nativeHelper.call).not.toHaveBeenCalled();
  });
});
