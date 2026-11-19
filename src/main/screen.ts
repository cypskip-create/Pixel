/**
 * Explicit, in-memory screen capture.
 *
 * Window captures use the opaque HWND identity maintained by PixelNative and
 * fail closed if it cannot capture that exact window. Display/region captures
 * use an exact Electron display id. Regions use virtual-desktop Electron DIP;
 * a crop that intersects more than one monitor is rejected rather than
 * assembled with an ambiguous mixed-DPI mapping.
 */

import { randomUUID } from 'node:crypto';
import { desktopCapturer, screen } from 'electron';
import type { NativeImage } from 'electron';
import type {
  CaptureResult,
  CypsErrorCode,
  ImageAttachment,
  ScreenCaptureMetadata,
  ScreenWindowTarget,
} from '../shared/types';
import type { LastExternalWindowResult, NativeHelper, NativeWindowCapture, WindowInfo } from './services/nativeHelper';

const MAX_REGION = 16_384;

export interface CaptureDeps {
  /** Must be true before any capture runs; set only for an explicit approved request. */
  isAuthorized: () => boolean;
  nativeHelper: Pick<NativeHelper, 'call' | 'lastExternalForegroundWindow' | 'listExternalWindows'>;
  ownProcessIds?: () => number[];
  now?: () => number;
}

export class ScreenCapture {
  private readonly deps: CaptureDeps;

  constructor(deps: CaptureDeps) {
    this.deps = deps;
  }

  listDisplays(): Array<{
    id: string;
    width: number;
    height: number;
    scaleFactor: number;
    label: string;
    bounds: { x: number; y: number; width: number; height: number };
  }> {
    return screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      label: display.label && display.label.length > 0 ? display.label : `Display ${display.id}`,
      bounds: { ...display.bounds },
    }));
  }

  async listExternalWindows(): Promise<{ windows: ScreenWindowTarget[]; truncated: boolean }> {
    const result = await this.deps.nativeHelper.listExternalWindows();
    return {
      windows: result.windows.map(({ windowId, title, processName, pid }) => ({ windowId, title, processName, pid })),
      truncated: result.truncated,
    };
  }

  /** Captures only the actual foreground app and refuses Pixel's own windows. */
  async captureActiveWindow(): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;
    try {
      const window = await this.deps.nativeHelper.call('foreground_window', {});
      if (!window) return this.fail('No foreground application is available.', 'UNKNOWN');
      if (this.isPixel(window)) {
        return this.fail('Pixel is foreground. Select an external window or request the last external foreground window; Pixel will not guess.', 'MODEL_CAPABILITY');
      }
      return await this.captureWindowInternal(window, true);
    } catch (error) {
      return this.fail(`Foreground window capture failed: ${message(error)}`, errorCode(error));
    }
  }

  /** Captures Pixel's last external foreground target only after tracker validation. */
  async captureLastExternalWindow(): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;
    try {
      const result: LastExternalWindowResult = await this.deps.nativeHelper.lastExternalForegroundWindow();
      if (result.status !== 'available') {
        return this.fail(result.status === 'stale'
          ? `The last external window is stale: ${result.reason} Re-observe and select a current window.`
          : `No trustworthy external window is available: ${result.reason}`, 'BAD_REQUEST');
      }
      return await this.captureWindowInternal(result.window, false);
    } catch (error) {
      return this.fail(`Last external window capture failed: ${message(error)}`, errorCode(error));
    }
  }

  /** Captures one explicit opaque target without activating or switching to it. */
  async captureSelectedWindow(target: ScreenWindowTarget): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;
    if (!isWindowTarget(target)) return this.fail('The selected window identity is incomplete. Re-list windows and select one exact target.', 'BAD_REQUEST');
    try {
      return await this.captureWindowInternal(target, false);
    } catch (error) {
      return this.fail(`Selected window capture failed: ${message(error)}`, errorCode(error));
    }
  }

  async captureDisplay(displayId?: string): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;
    const displays = screen.getAllDisplays();
    const display = displayId === undefined
      ? screen.getPrimaryDisplay()
      : displays.find((display) => String(display.id) === displayId);
    if (!display) return this.fail('The selected display is no longer connected. Refresh the display list and select again.', 'BAD_REQUEST');
    const target = snapshotDisplay(display);

    try {
      const size = requestedThumbnailSize(target);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size, fetchWindowIcons: false });
      if (!displayUnchanged(target)) return this.fail('The monitor layout or DPI changed during capture. Select the display again and retry.', 'BAD_REQUEST');
      // Source order is unspecified. Never substitute another display.
      const source = sources.find((candidate) => candidate.display_id === String(target.id));
      if (!source) return this.fail('Windows did not return a capture source for the selected display.', 'MODEL_CAPABILITY');
      const imageSize = source.thumbnail.getSize();
      const bounds = { ...target.bounds };
      const metadata = this.metadata({
        targetType: 'display', bounds, displayId: String(target.id), scaleFactor: target.scaleFactor,
        pixelScale: { x: imageSize.width / bounds.width, y: imageSize.height / bounds.height },
        source: 'electron_display_capture',
      });
      return this.toResult(source.thumbnail, { label: displayName(target), displayLabel: target.label }, metadata);
    } catch (error) {
      return this.fail(`Display capture failed: ${message(error)}`, 'UNKNOWN');
    }
  }

  /**
   * Capture a global virtual-desktop rectangle in Electron DIP. A partially
   * off-screen rectangle is clipped to its one intersecting display; a region
   * crossing monitors is rejected so mixed-DPI coordinates are never guessed.
   */
  async captureRegion(region: { x: number; y: number; width: number; height: number }): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
      region.width <= 0 || region.height <= 0 || region.width > MAX_REGION || region.height > MAX_REGION) {
      return this.fail('The selected region has invalid or unsupported dimensions.', 'BAD_REQUEST');
    }

    const intersections = screen.getAllDisplays().map((candidate) => ({
      display: snapshotDisplay(candidate),
      bounds: intersect(region, candidate.bounds),
    })).filter((item): item is { display: Electron.Display; bounds: Rect } => item.bounds !== null);
    if (intersections.length === 0) return this.fail('The selected region is outside every connected display.', 'BAD_REQUEST');
    if (intersections.length > 1) return this.fail('The selected region crosses monitors. Select a rectangle within one display and try again.', 'BAD_REQUEST');

    const { display, bounds } = intersections[0];
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: requestedThumbnailSize(display), fetchWindowIcons: false,
      });
      if (!displayUnchanged(display)) return this.fail('The monitor layout or DPI changed during capture. Re-select the region and retry.', 'BAD_REQUEST');
      const source = sources.find((candidate) => candidate.display_id === String(display.id));
      if (!source) return this.fail('Windows did not return a capture source for the display containing the selected region.', 'MODEL_CAPABILITY');

      const sourceSize = source.thumbnail.getSize();
      if (sourceSize.width <= 0 || sourceSize.height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
        return this.fail('The display returned an empty image for the selected region.', 'MODEL_CAPABILITY');
      }
      const pxPerDipX = sourceSize.width / display.bounds.width;
      const pxPerDipY = sourceSize.height / display.bounds.height;
      const left = clamp(Math.floor((bounds.x - display.bounds.x) * pxPerDipX), 0, sourceSize.width);
      const top = clamp(Math.floor((bounds.y - display.bounds.y) * pxPerDipY), 0, sourceSize.height);
      const right = clamp(Math.ceil((bounds.x + bounds.width - display.bounds.x) * pxPerDipX), 0, sourceSize.width);
      const bottom = clamp(Math.ceil((bounds.y + bounds.height - display.bounds.y) * pxPerDipY), 0, sourceSize.height);
      if (right <= left || bottom <= top) return this.fail('The clipped region contains no display pixels.', 'BAD_REQUEST');

      const cropped = source.thumbnail.crop({ x: left, y: top, width: right - left, height: bottom - top });
      const imageSize = cropped.getSize();
      const metadata = this.metadata({
        targetType: 'region', bounds, displayId: String(display.id), scaleFactor: display.scaleFactor,
        pixelScale: { x: imageSize.width / bounds.width, y: imageSize.height / bounds.height },
        source: 'electron_display_capture',
      });
      return this.toResult(cropped, { label: `Selected region (${imageSize.width}x${imageSize.height})`, displayLabel: display.label }, metadata);
    } catch (error) {
      return this.fail(`Region capture failed: ${message(error)}`, 'UNKNOWN');
    }
  }

  private async captureWindowInternal(target: WindowInfo | ScreenWindowTarget, requireForeground: boolean): Promise<CaptureResult> {
    if (this.isPixel(target)) return this.fail('Pixel windows cannot be captured as application targets.', 'BAD_REQUEST');
    const request = {
      targetWindowId: target.windowId,
      expectedWindowTitle: target.title,
      expectedProcessId: target.pid,
      expectedProcessName: target.processName,
      requireForeground,
    };
    const captured: NativeWindowCapture = await this.deps.nativeHelper.call('capture_window', request);
    if (captured.window.windowId !== target.windowId || captured.window.pid !== target.pid ||
      captured.window.processName.toLowerCase() !== target.processName.toLowerCase() || captured.window.title !== target.title ||
      captured.width <= 0 || captured.height <= 0 || !captured.base64) {
      return this.fail('The native capture did not match the selected window identity. Re-observe the target.', 'UNKNOWN');
    }
    const bounds = screen.screenToDipRect(null, captured.window.rect);
    const display = screen.getDisplayMatching(bounds);
    const dataUrl = `data:${captured.format};base64,${captured.base64}`;
    const image: ImageAttachment = {
      dataUrl,
      mimeType: 'image/png',
      width: captured.width,
      height: captured.height,
      source: 'screenshot',
      label: `Window: ${captured.window.title || captured.window.processName}`,
    };
    const metadata = this.metadata({
      targetType: 'window', targetWindow: toTarget(captured.window), bounds,
      displayId: String(display.id), scaleFactor: display.scaleFactor,
      pixelScale: { x: captured.width / bounds.width, y: captured.height / bounds.height },
      source: 'native_print_window',
    });
    return { ok: true, image, metadata, windowTitle: captured.window.title, displayLabel: display.label };
  }

  private isPixel(window: Pick<WindowInfo, 'pid'>): boolean {
    return (this.deps.ownProcessIds?.() ?? [process.pid]).includes(window.pid);
  }

  private checkAuthorization(): CaptureResult | null {
    if (this.deps.isAuthorized()) return null;
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Pixel is not allowed to look at your screen right now. Ask it to look, then approve the request.',
        retryable: false,
      },
    };
  }

  private metadata(input: Omit<ScreenCaptureMetadata, 'captureId' | 'capturedAt' | 'coordinateSpace' | 'cached' | 'status'>): ScreenCaptureMetadata {
    return {
      ...input,
      captureId: randomUUID(),
      capturedAt: this.deps.now?.() ?? Date.now(),
      coordinateSpace: 'electron_dip',
      cached: false,
      status: 'captured',
    };
  }

  private toResult(
    image: NativeImage,
    meta: { label?: string; displayLabel?: string },
    metadata: ScreenCaptureMetadata,
  ): CaptureResult {
    if (image.isEmpty()) return this.fail('The captured image was empty.', 'UNKNOWN');
    const size = image.getSize();
    const attachment: ImageAttachment = {
      dataUrl: image.toDataURL(), mimeType: 'image/png', width: size.width, height: size.height,
      source: 'screenshot', ...(meta.label ? { label: meta.label } : {}),
    };
    return { ok: true, image: attachment, metadata, ...(meta.displayLabel ? { displayLabel: meta.displayLabel } : {}) };
  }

  private fail(messageValue: string, code: CypsErrorCode): CaptureResult {
    return { ok: false, error: { code, message: messageValue, retryable: false } };
  }
}

type Rect = { x: number; y: number; width: number; height: number };

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function requestedThumbnailSize(display: Electron.Display): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };
}

function snapshotDisplay(display: Electron.Display): Electron.Display {
  return {
    ...display,
    size: { ...display.size },
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
    workAreaSize: { ...display.workAreaSize },
  };
}

function displayName(display: Electron.Display): string {
  return display.label ? `${display.label} (${display.size.width}x${display.size.height})` : `Display ${display.id}`;
}

function displayUnchanged(display: Electron.Display): boolean {
  const current = screen.getAllDisplays().find((candidate) => String(candidate.id) === String(display.id));
  return Boolean(current &&
    current.scaleFactor === display.scaleFactor &&
    current.size.width === display.size.width &&
    current.size.height === display.size.height &&
    current.bounds.x === display.bounds.x &&
    current.bounds.y === display.bounds.y &&
    current.bounds.width === display.bounds.width &&
    current.bounds.height === display.bounds.height);
}

function toTarget(window: WindowInfo): ScreenWindowTarget {
  return { windowId: window.windowId, title: window.title, processName: window.processName, pid: window.pid };
}

function isWindowTarget(value: ScreenWindowTarget): boolean {
  return Boolean(value && typeof value.windowId === 'string' && value.windowId.length > 0 &&
    typeof value.title === 'string' && value.title.length > 0 && typeof value.processName === 'string' &&
    value.processName.length > 0 && Number.isInteger(value.pid) && value.pid > 0);
}

function errorCode(error: unknown): CypsErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'TIMEOUT') return 'TIMEOUT';
    if (code === 'CANCELLED') return 'ABORTED';
    if (code === 'UNAVAILABLE') return 'MODEL_CAPABILITY';
  }
  return 'UNKNOWN';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
