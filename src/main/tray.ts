/**
 * Tray icon.
 *
 * The icon is drawn at runtime rather than shipped as a binary asset, so the
 * repository stays free of opaque blobs and the icon cannot go missing from the
 * package. Every step is defensive: a tray that fails to appear must not stop
 * Cyps from running.
 */

import { Menu, Tray, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { buildPng } from './icon/png';
import type { Mode } from '../shared/types';
import { MODES, getModeDescriptor } from '../shared/types';

export interface TrayCallbacks {
  onToggle: () => void;
  onSetMode: (mode: Mode) => void;
  onOpenSettings: () => void;
  onEmergencyStop: () => void;
  onQuit: () => void;
  getMode: () => Mode;
  isVisible: () => boolean;
}

export class TrayController {
  private tray: Tray | null = null;
  private readonly callbacks: TrayCallbacks;
  /** Set once the icon fails to build, so we do not retry on every rebuild. */
  private iconFailed = false;

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
  }

  /** Create the tray. Returns false (without throwing) if the OS refuses. */
  create(): boolean {
    try {
      const image = buildTrayIcon();
      this.tray = new Tray(image);
      this.tray.setToolTip('Cyps');
      this.rebuild();
      this.tray.on('click', () => this.callbacks.onToggle());
      this.tray.on('double-click', () => this.callbacks.onToggle());
      return true;
    } catch {
      this.tray = null;
      this.iconFailed = true;
      return false;
    }
  }

  /** Recreate the menu; call when mode or visibility changes. */
  rebuild(): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    try {
      this.tray.setContextMenu(this.buildMenu());
    } catch {
      // A failed menu update is not fatal.
    }
  }

  private buildMenu(): Menu {
    const mode = this.callbacks.getMode();
    return Menu.buildFromTemplate([
      {
        label: this.callbacks.isVisible() ? 'Hide Cyps' : 'Show Cyps',
        click: () => this.callbacks.onToggle(),
      },
      { type: 'separator' },
      {
        label: 'Mode',
        submenu: MODES.map((id) => {
          const descriptor = getModeDescriptor(id);
          return {
            label: descriptor.label,
            type: 'radio' as const,
            checked: id === mode,
            click: () => this.callbacks.onSetMode(id),
          };
        }),
      },
      { type: 'separator' },
      { label: 'Settings...', click: () => this.callbacks.onOpenSettings() },
      {
        label: 'Emergency Stop',
        click: () => this.callbacks.onEmergencyStop(),
      },
      { type: 'separator' },
      { label: 'Quit Cyps', click: () => this.callbacks.onQuit() },
    ]);
  }

  destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }

  /** True when a usable tray exists. */
  isReady(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  /** Exposed for diagnostics: did icon construction fail? */
  hasIconFailure(): boolean {
    return this.iconFailed;
  }
}

/* -------------------------------------------------------------------- *
 * Icon generation
 * -------------------------------------------------------------------- */

/**
 * Build a 32x32 RGBA icon and encode it as a PNG.
 *
 * Deliberately dependency-free: PNG container written by hand, pixel data
 * deflated with Node's zlib. The mark is a soft ring with a bright dot, which
 * reads clearly at 16px in the notification area.
 */
/** Build a 32x32 RGBA icon and decode it into a nativeImage. */
export function buildTrayIcon(size = 32): NativeImage {
  const png = buildPng(size);
  const image = nativeImage.createFromBuffer(png);
  if (image.isEmpty()) throw new Error('Tray icon could not be decoded.');
  return image;
}