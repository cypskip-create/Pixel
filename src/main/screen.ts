/**
 * Screen capture.
 *
 * Capture is the most privacy-sensitive capability in Cyps, so the rules are
 * enforced here rather than left to the UI:
 *
 *  - Nothing is captured unless `isAuthorized()` returns true. The caller must
 *    set that flag only after an explicit user action (a click, or an approved
 *    permission request). There is no timer, no polling, and no automatic
 *    capture path in this file.
 *  - Capture never runs silently in the background: the main process wires this
 *    to a permission request, and the user sees and approves it.
 *  - Images are returned as in-memory data URLs; nothing is written to disk.
 */

import { desktopCapturer, screen } from 'electron';
import type { NativeImage } from 'electron';
import type { CaptureResult, CypsErrorCode, ImageAttachment } from '../shared/types';

export interface CaptureDeps {
  /** Must be true before any capture runs. Set only on explicit user action. */
  isAuthorized: () => boolean;
}

export interface CaptureTarget {
  kind: 'screen' | 'window';
  /** Display or window id, when a specific one is requested. */
  id?: string;
}

export class ScreenCapture {
  private readonly deps: CaptureDeps;

  constructor(deps: CaptureDeps) {
    this.deps = deps;
  }

  /** Display descriptors for the settings/overlay UI. */
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
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      },
    }));
  }

  /** Capture a single monitor, in physical pixels for correct DPI. */
  async captureDisplay(displayId?: string): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;

    const displays = screen.getAllDisplays();
    const target =
      (displayId !== undefined
        ? displays.find((d) => String(d.id) === displayId)
        : undefined) ?? screen.getPrimaryDisplay();

    try {
      const thumbnailSize = {
        width: Math.round(target.size.width * target.scaleFactor),
        height: Math.round(target.size.height * target.scaleFactor),
      };

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false,
      });

      const source =
        sources.find((candidate) => candidate.display_id === String(target.id)) ?? sources[0];

      if (!source) {
        return this.fail('No screen was available to capture.', 'UNKNOWN');
      }

      return this.toResult(source.thumbnail, {
        label:
          target.label && target.label.length > 0
            ? `${target.label} (${target.size.width}x${target.size.height})`
            : `Display ${target.id} (${target.size.width}x${target.size.height})`,
        displayLabel: target.label,
      });
    } catch (error) {
      return this.fail(`Screen capture failed: ${message(error)}`, 'UNKNOWN');
    }
  }

  /** Capture the frontmost window. */
  async captureActiveWindow(): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;

    const display = screen.getPrimaryDisplay();
    const thumbnailSize = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    };

    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize,
        fetchWindowIcons: false,
      });

      if (sources.length === 0) {
        return this.fail(
          'No window was available to capture. On Windows, capture of elevated windows is blocked by the OS.',
          'UNKNOWN',
        );
      }

      // desktopCapturer does not guarantee ordering; prefer a named, non-minimised
      // source and fall back to the first entry.
      const source = sources.find((candidate) => candidate.name.length > 0) ?? sources[0];

      return this.toResult(source.thumbnail, {
        label: `Window: ${source.name}`,
        windowTitle: source.name,
      });
    } catch (error) {
      return this.fail(`Window capture failed: ${message(error)}`, 'UNKNOWN');
    }
  }

  /**
   * Capture a rectangle of the primary display.
   *
   * The region is in logical (DIP) coordinates, matching what the UI measures;
   * it is scaled to physical pixels before cropping so the crop is not shifted
   * on a display with a scale factor other than 1.
   */
  async captureRegion(region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<CaptureResult> {
    const denial = this.checkAuthorization();
    if (denial) return denial;

    if (region.width <= 0 || region.height <= 0) {
      return this.fail('The selected region is empty.', 'BAD_REQUEST');
    }

    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor;

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * scale),
          height: Math.round(display.size.height * scale),
        },
        fetchWindowIcons: false,
      });

      const source = sources.find((c) => c.display_id === String(display.id)) ?? sources[0];
      if (!source) return this.fail('No screen was available to capture.', 'UNKNOWN');

      const size = source.thumbnail.getSize();
      // Translate from display-local logical coordinates into absolute pixels.
      const left = Math.round((region.x - display.bounds.x) * scale);
      const top = Math.round((region.y - display.bounds.y) * scale);
      const width = Math.round(region.width * scale);
      const height = Math.round(region.height * scale);

      const clamped = {
        x: Math.min(Math.max(0, left), Math.max(0, size.width - 1)),
        y: Math.min(Math.max(0, top), Math.max(0, size.height - 1)),
        width: Math.min(width, size.width),
        height: Math.min(height, size.height),
      };

      if (clamped.width <= 0 || clamped.height <= 0) {
        return this.fail('The selected region is outside the screen.', 'BAD_REQUEST');
      }

      const cropped = source.thumbnail.crop(clamped);
      return this.toResult(cropped, {
        label: `Region ${region.width}x${region.height}`,
        displayLabel: display.label,
      });
    } catch (error) {
      return this.fail(`Region capture failed: ${message(error)}`, 'UNKNOWN');
    }
  }

  /* ------------------------------ helpers ----------------------------- */

  private checkAuthorization(): CaptureResult | null {
    if (this.deps.isAuthorized()) return null;
    return {
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message:
          'Cyps is not allowed to look at your screen right now. Ask it to look, then approve the request.',
        retryable: false,
      },
    };
  }

  private toResult(
    image: NativeImage,
    meta: { label?: string; windowTitle?: string; displayLabel?: string },
  ): CaptureResult {
    if (image.isEmpty()) {
      return this.fail('The captured image was empty.', 'UNKNOWN');
    }

    const size = image.getSize();
    const dataUrl = image.toDataURL(); // data:image/png;base64,...
    const attachment: ImageAttachment = {
      dataUrl,
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
      source: 'screenshot',
      ...(meta.label ? { label: meta.label } : {}),
    };

    return {
      ok: true,
      image: attachment,
      ...(meta.windowTitle ? { windowTitle: meta.windowTitle } : {}),
      ...(meta.displayLabel ? { displayLabel: meta.displayLabel } : {}),
    };
  }

  private fail(message: string, code: CypsErrorCode): CaptureResult {
    return {
      ok: false,
      error: { code, message, retryable: false },
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
