/**
 * The floating Cyps window.
 *
 * Design rules this module enforces:
 *  - The window is frameless, transparent, and always on top of normal windows
 *    but *below* system dialogs, so it cannot cover an OS permission prompt.
 *  - It starts near the top-centre of the primary display's work area.
 *  - Its position is remembered, and always clamped so it cannot be dragged or
 *    restored off-screen (including when a monitor is unplugged).
 *  - Sizes are driven by the current surface; the window is small by design.
 */

import { BrowserWindow, screen } from 'electron';
import type { Rectangle, Display } from 'electron';
import { join } from 'node:path';
import type { Surface } from '../shared/types';

import { DEFAULT_OFFSET_FROM_TOP, SURFACE_SIZES } from '../shared/surfaces';

export { DEFAULT_OFFSET_FROM_TOP, SURFACE_SIZES };

export interface WindowManagerDeps {
  preloadPath: string;
  /** Dev server URL when running under `npm run dev`. */
  devServerUrl: string | null;
  /** Loads the built renderer when no dev server is in use. */
  rendererIndexPath: string;
  onPositionChange: (position: { x: number; y: number }) => void;
  onVisibilityChange: (visible: boolean) => void;
}

export class WindowManager {
  private main: BrowserWindow | null = null;
  private settings: BrowserWindow | null = null;
  private surface: Surface = 'idle';
  /** True while the UI asked for click-through (guidance overlay). */
  private ignoringMouse = false;
  private readonly deps: WindowManagerDeps;
  private initialPosition: { x: number; y: number } | null;

  constructor(
    initialPosition: { x: number; y: number } | null,
    deps: WindowManagerDeps,
  ) {
    this.initialPosition = initialPosition;
    this.deps = deps;
    this.registerDisplayListeners();
  }

  /* ------------------------------ creation ---------------------------- */

  createMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;

    const size = SURFACE_SIZES[this.surface];
    const target = this.resolveInitialPosition(size);

    const win = new BrowserWindow({
      width: size.width,
      height: size.height,
      x: target.x,
      y: target.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });

    // 'floating' keeps Cyps above normal apps. Deliberately not
    // 'screen-saver', which would cover UAC and system permission dialogs.
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

    win.once('ready-to-show', () => {
      win.showInactive();
      this.deps.onVisibilityChange(true);
    });

    win.on('moved', () => {
      const [x, y] = win.getPosition();
      this.deps.onPositionChange({ x, y });
    });

    win.on('closed', () => {
      this.main = null;
    });

    this.loadRenderer(win);
    this.main = win;
    return win;
  }

  createSettingsWindow(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.focus();
      return this.settings;
    }

    const win = new BrowserWindow({
      width: 560,
      height: 680,
      title: 'Cyps Settings',
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: false,
      backgroundColor: '#0b0d12',
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.settings = null;
    });

    this.loadRenderer(win, '?window=settings');
    this.settings = win;
    return win;
  }

  private loadRenderer(win: BrowserWindow, query = ''): void {
    if (this.deps.devServerUrl) {
      void win.loadURL(`${this.deps.devServerUrl}${query}`);
    } else {
      void win.loadFile(this.deps.rendererIndexPath, {
        search: query.replace(/^\?/, ''),
      });
    }
  }

  /* ------------------------------ geometry ---------------------------- */

  /**
   * Restore the remembered position, or centre horizontally near the top.
   * Always clamped to the work area of the monitor the point falls inside.
   */
  private resolveInitialPosition(size: { width: number; height: number }): { x: number; y: number } {
    const saved = this.initialPosition;
    if (saved) {
      const display = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y });
      return clampToWorkArea(saved, size, display, true);
    }
    const display = screen.getPrimaryDisplay();
    const area = display.workArea;
    return {
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(area.y + DEFAULT_OFFSET_FROM_TOP),
    };
  }

  /** Current surface size in logical pixels. */
  sizeFor(surface: Surface): { width: number; height: number } {
    return SURFACE_SIZES[surface];
  }

  /**
   * Resize for a surface, keeping the top edge and horizontal centre stable so
   * the orb does not jump when it expands into the input bar.
   */
  setSurface(surface: Surface): void {
    this.surface = surface;
    const win = this.main;
    if (!win || win.isDestroyed()) return;

    if (surface === 'hidden') {
      win.hide();
      this.deps.onVisibilityChange(false);
      return;
    }

    const current = win.getBounds();
    const size = SURFACE_SIZES[surface];
    const display = screen.getDisplayMatching(current);
    const centredX = Math.round(current.x + (current.width - size.width) / 2);
    const target = clampToWorkArea(
      { x: centredX, y: current.y },
      size,
      display,
      false,
    );

    win.setBounds({
      x: target.x,
      y: target.y,
      width: size.width,
      height: size.height,
    });

    if (!win.isVisible()) win.showInactive();
    this.deps.onPositionChange({ x: target.x, y: target.y });
  }

  moveTo(x: number, y: number): void {
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    const size = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x, y });
    const target = clampToWorkArea({ x, y }, { width: size.width, height: size.height }, display, true);
    win.setBounds({ x: target.x, y: target.y, width: size.width, height: size.height });
    this.deps.onPositionChange(target);
  }

  currentPosition(): { x: number; y: number } {
    const win = this.main;
    if (!win || win.isDestroyed()) return this.initialPosition ?? { x: 0, y: 0 };
    const [x, y] = win.getPosition();
    return { x, y };
  }

  workAreaFor(position?: { x: number; y: number }): {
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
  } {
    const point = position ?? this.currentPosition();
    const display = screen.getDisplayNearestPoint(point);
    return { ...display.workArea, scaleFactor: display.scaleFactor };
  }

  /* ---------------------------- visibility ---------------------------- */

  show(): void {
    const win = this.createMainWindow();
    if (win.isMinimized()) win.restore();
    win.showInactive();
    this.deps.onVisibilityChange(true);
  }

  hide(): void {
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    win.hide();
    this.deps.onVisibilityChange(false);
  }

  toggle(): void {
    const win = this.main;
    if (win && !win.isDestroyed() && win.isVisible()) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    const win = this.main;
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  }

  /**
   * Click-through for the guidance overlay.
   *
   * When ignoring mouse events, the window must still report itself as
   * transparent-to-hits so the underlying application receives the input.
   */
  setIgnoreMouseEvents(ignore: boolean): void {
    this.ignoringMouse = ignore;
    const win = this.main;
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  isIgnoringMouse(): boolean {
    return this.ignoringMouse;
  }

  getMainWindow(): BrowserWindow | null {
    return this.main;
  }

  getSettingsWindow(): BrowserWindow | null {
    return this.settings;
  }

  closeSettings(): void {
    if (this.settings && !this.settings.isDestroyed()) this.settings.close();
  }

  /* ------------------------------ displays ---------------------------- */

  private registerDisplayListeners(): void {
    const reclamp = () => {
      const win = this.main;
      if (!win || win.isDestroyed()) return;
      const bounds = win.getBounds();
      const display = screen.getDisplayMatching(bounds);
      const target = clampToWorkArea(
        { x: bounds.x, y: bounds.y },
        { width: bounds.width, height: bounds.height },
        display,
        true,
      );
      if (target.x !== bounds.x || target.y !== bounds.y) {
        win.setPosition(target.x, target.y);
      }
    };

    // A monitor being unplugged must never strand the orb off-screen.
    screen.on('display-removed', reclamp);
    screen.on('display-added', reclamp);
    screen.on('display-metrics-changed', reclamp);
  }
}

/**
 * Keep a window fully inside a display's work area.
 *
 * `preferTop` clamps the top edge to the work area's top, which is what the
 * "floats at the top of the screen" behaviour requires; otherwise the existing
 * vertical position is preserved when it is already valid.
 */
export function clampToWorkArea(
  position: { x: number; y: number },
  size: { width: number; height: number },
  display: Display,
  preferTop: boolean,
): { x: number; y: number } {
  const area: Rectangle = display.workArea;
  const maxX = area.x + area.width - size.width;
  const maxY = area.y + area.height - size.height;

  const x = Math.min(Math.max(position.x, area.x), Math.max(area.x, maxX));
  const y = preferTop
    ? Math.min(Math.max(position.y, area.y), Math.max(area.y, maxY))
    : Math.min(Math.max(position.y, area.y), Math.max(area.y, maxY));

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Resolve the asset paths from the compiled main directory.
 * Layout: dist/main/main/main.js, dist/main/preload/index.js, dist/renderer/index.html
 */
export function resolveAssetPaths(mainDir: string): {
  preloadPath: string;
  rendererIndexPath: string;
} {
  return {
    preloadPath: join(mainDir, '..', 'preload', 'index.js'),
    rendererIndexPath: join(mainDir, '..', '..', 'renderer', 'index.html'),
  };
}
