/**
 * The floating Pixel window.
 *
 * Design rules this module enforces:
 *  - The window is frameless, transparent, and always on top of normal windows
 *    but *below* system dialogs, so it cannot cover an OS permission prompt.
 *  - The primary bar stays at the selected display's top center; only its
 *    display id and small top offset persist, never arbitrary screen points.
 *  - The optional cursor buddy has its own passive, click-through window.
 *  - Renderer-measured panel sizes are clamped to compact native bounds.
 */

import { BrowserWindow, screen } from 'electron';
import type { Display, WebContents, WebFrameMain } from 'electron';
import { join } from 'node:path';
import type { CompanionSettings, Surface } from '../shared/types';
import type { WorkspaceWindowState } from '../shared/types';
import { CHANNELS } from '../shared/channels';
import { isTrustedRendererUrl } from './windowPolicy';

import { DEFAULT_OFFSET_FROM_TOP, SURFACE_SIZES } from '../shared/surfaces';
import {
  anchoredTopCenterBounds,
  fitPresentationSize,
  resolveAnchorDisplayId,
} from '../shared/presentationLayout';
import {
  companionTarget,
  createFollower,
  DEFAULT_FOLLOW_CONFIG,
  isSettled,
  settle,
  stepFollower,
} from '../shared/companion/cursorFollow';
import type { FollowState } from '../shared/companion/cursorFollow';

export { DEFAULT_OFFSET_FROM_TOP, SURFACE_SIZES, isTrustedRendererUrl };

export interface WindowManagerDeps {
  preloadPath: string;
  /** Dev server URL when running under `npm run dev`. */
  devServerUrl: string | null;
  /** Loads the built renderer when no dev server is in use. */
  rendererIndexPath: string;
  onAnchorChange: (anchor: { monitorId: string; position: null }) => void;
  onVisibilityChange: (visible: boolean) => void;
  workspaceWindow?: { x: number | null; y: number | null; width: number; height: number; maximized: boolean };
  onWorkspaceBoundsChange?: (state: { x: number; y: number; width: number; height: number; maximized: boolean }) => void;
}

type PresentationSettings = Pick<
  CompanionSettings,
  'monitorId' | 'position' | 'topOffset' | 'cursorCompanionEnabled' | 'followSpeed' | 'cursorOffset' | 'reducedMotion'
>;

const CURSOR_WINDOW_SIZE = 64;

export class WindowManager {
  private main: BrowserWindow | null = null;
  private settings: BrowserWindow | null = null;
  private workspace: BrowserWindow | null = null;
  private mainReady = false;
  private workspaceFocused = false;
  private mainVisibleRequested = true;
  private cursorWindow: BrowserWindow | null = null;
  private surface: Surface = 'idle';
  private anchorDisplayId: string | null = null;
  private topOffset = DEFAULT_OFFSET_FROM_TOP;
  private cursorCompanionEnabled = false;
  private followSpeed = 1;
  private cursorOffset = { x: 22, y: 20 };
  private reducedMotion = false;
  private followTimer: ReturnType<typeof setInterval> | null = null;
  private follower: FollowState | null = null;
  private followTickAt = 0;
  /** True while the UI asked for click-through (guidance overlay). */
  private ignoringMouse = false;
  private pendingSummon = false;
  private readonly deps: WindowManagerDeps;
  private legacyPosition: { x: number; y: number } | null;
  private readonly displayListeners: Array<(...args: any[]) => void> = [];

  constructor(
    initialSettings: Pick<PresentationSettings, 'monitorId' | 'position' | 'topOffset'>,
    deps: WindowManagerDeps,
  ) {
    this.anchorDisplayId = initialSettings.monitorId;
    this.legacyPosition = initialSettings.position;
    this.topOffset = initialSettings.topOffset;
    this.deps = deps;
    this.registerDisplayListeners();
  }

  /* ------------------------------ creation ---------------------------- */

  createMainWindow(): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;

    const size = SURFACE_SIZES[this.surface];
    const target = this.anchorBounds(size);

    const win = new BrowserWindow({
      width: size.width,
      height: size.height,
      x: target.x,
      y: target.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
      resizable: false,
      movable: false,
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

    // 'floating' keeps Pixel above normal apps. Deliberately not
    // 'screen-saver', which would cover UAC and system permission dialogs.
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

    win.once('ready-to-show', () => {
      this.mainReady = true;
      if (this.mainVisibleRequested && !this.workspaceFocused && this.surface !== 'hidden') {
        win.showInactive();
        this.deps.onVisibilityChange(true);
      }
    });

    win.on('blur', () => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.windowFocusLost);
    });

    win.webContents.on('did-finish-load', () => {
      if (!this.pendingSummon || win.isDestroyed()) return;
      this.pendingSummon = false;
      win.webContents.send(CHANNELS.windowSummon);
    });

    win.on('closed', () => {
      this.main = null;
      this.mainReady = false;
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
      width: 500,
      height: 540,
      title: 'Pixel Settings',
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

  openWorkspace(): BrowserWindow {
    if (this.workspace && !this.workspace.isDestroyed()) {
      if (this.workspace.isMinimized()) this.workspace.restore();
      if (!this.workspace.isVisible()) this.workspace.show();
      this.workspace.focus();
      return this.workspace;
    }

    const saved = this.deps.workspaceWindow ?? { x: null, y: null, width: 1280, height: 820, maximized: true };
    const primaryArea = screen.getPrimaryDisplay().workArea;
    const preferred = {
      x: saved.x ?? Math.round(primaryArea.x + (primaryArea.width - saved.width) / 2),
      y: saved.y ?? Math.round(primaryArea.y + (primaryArea.height - saved.height) / 2),
      width: saved.width,
      height: saved.height,
    };
    const displayArea = screen.getDisplayMatching(preferred).workArea;
    const initialWidth = Math.min(preferred.width, displayArea.width);
    const initialHeight = Math.min(preferred.height, displayArea.height);
    const initialBounds = {
      ...preferred,
      width: initialWidth,
      height: initialHeight,
      x: Math.round(Math.min(Math.max(preferred.x, displayArea.x), displayArea.x + displayArea.width - initialWidth)),
      y: Math.round(Math.min(Math.max(preferred.y, displayArea.y), displayArea.y + displayArea.height - initialHeight)),
    };
    const win = new BrowserWindow({
      ...initialBounds,
      minWidth: Math.min(960, displayArea.width),
      minHeight: Math.min(640, displayArea.height),
      title: 'Pixel Workspace',
      frame: false,
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
      autoHideMenuBar: true,
      backgroundColor: '#10141d',
      ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
      },
    });

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let restoreBounds = { ...initialBounds };
    const persistBounds = (): void => {
      if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
      restoreBounds = win.getBounds();
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
        const bounds = win.getBounds();
        this.deps.onWorkspaceBoundsChange?.({ ...bounds, maximized: false });
      }, 250);
      saveTimer.unref?.();
    };
    const emitState = (): void => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        const state: WorkspaceWindowState = { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
        try { win.webContents.send(CHANNELS.workspaceState, state); } catch { /* window is closing */ }
      }
      if (!win.isDestroyed() && !win.isMaximized() && !win.isFullScreen()) {
        const bounds = win.getBounds();
        this.deps.onWorkspaceBoundsChange?.({ ...bounds, maximized: false });
      } else if (!win.isDestroyed() && win.isMaximized() && !win.isFullScreen()) {
        this.deps.onWorkspaceBoundsChange?.({ ...restoreBounds, maximized: true });
      }
    };

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      if (saved.maximized) win.maximize();
      win.show();
      win.focus();
      emitState();
    });
    win.on('focus', () => {
      this.workspaceFocused = true;
      this.hideForWorkspace();
      emitState();
    });
    win.on('blur', () => {
      this.workspaceFocused = false;
      this.restoreIslandAfterWorkspace();
      emitState();
    });
    win.on('maximize', emitState);
    win.on('unmaximize', emitState);
    win.on('enter-full-screen', emitState);
    win.on('leave-full-screen', emitState);
    win.on('resize', persistBounds);
    win.on('move', persistBounds);
    win.on('closed', () => {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      if (this.workspace === win) this.workspace = null;
      this.workspaceFocused = false;
      this.restoreIslandAfterWorkspace();
    });

    this.workspace = win;
    this.loadRenderer(win, '?window=workspace');
    return win;
  }

  minimizeWorkspace(): void {
    if (this.workspace && !this.workspace.isDestroyed()) this.workspace.minimize();
  }

  closeWorkspace(): void {
    if (this.workspace && !this.workspace.isDestroyed()) this.workspace.close();
  }

  toggleWorkspaceMaximize(): boolean {
    const win = this.workspace;
    if (!win || win.isDestroyed()) return false;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  }

  setWorkspaceFullscreen(fullscreen: boolean): void {
    const win = this.workspace;
    if (!win || win.isDestroyed()) return;
    win.setFullScreen(fullscreen);
  }

  getWorkspaceState(): WorkspaceWindowState {
    const win = this.workspace;
    return {
      maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()),
      fullscreen: Boolean(win && !win.isDestroyed() && win.isFullScreen()),
    };
  }

  getWorkspaceWindow(): BrowserWindow | null {
    return this.workspace;
  }

  isMainSender(sender: WebContents): boolean {
    return Boolean(this.main && !this.main.isDestroyed() && this.main.webContents === sender);
  }

  isWorkspaceSender(sender: WebContents): boolean {
    return Boolean(this.workspace && !this.workspace.isDestroyed() && this.workspace.webContents === sender);
  }

  isSettingsSender(sender: WebContents): boolean {
    return Boolean(this.settings && !this.settings.isDestroyed() && this.settings.webContents === sender);
  }

  /** Only the main frames of the three intended application windows may use IPC. */
  isTrustedApplicationSender(sender: WebContents, frame: WebFrameMain | null): boolean {
    if (!frame || frame !== sender.mainFrame) return false;
    const owners = [this.main, this.settings, this.workspace];
    if (!owners.some((owner) => owner && !owner.isDestroyed() && owner.webContents === sender)) return false;
    return isTrustedRendererUrl(frame.url, this.deps.rendererIndexPath, this.deps.devServerUrl);
  }

  private hideForWorkspace(): void {
    const win = this.main;
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide();
      this.deps.onVisibilityChange(false);
    }
  }

  private restoreIslandAfterWorkspace(): void {
    if (this.workspaceFocused) return;
    const win = this.main;
    if (this.mainVisibleRequested && win && !win.isDestroyed() && this.mainReady && this.surface !== 'hidden' && !win.isVisible()) {
      win.showInactive();
      this.deps.onVisibilityChange(true);
    }
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

  /** Current surface size in logical pixels. */
  sizeFor(surface: Surface): { width: number; height: number } {
    return SURFACE_SIZES[surface];
  }

  /**
   * Resize for a surface, keeping the top edge and horizontal centre stable so
   * the orb does not jump when it expands into the input bar.
   */
  setSurface(surface: Surface): void {
    this.setLayout(surface, SURFACE_SIZES[surface]);
  }

  /**
   * Apply one renderer-measured panel layout. The measured request is clamped
   * to a compact width and the selected display's work area before it reaches
   * native window bounds.
   */
  setLayout(surface: Surface, requestedSize: { width: number; height: number }): void {
    this.surface = surface;
    const win = this.main;
    if (!win || win.isDestroyed()) {
      this.syncCursorFollow();
      return;
    }

    if (surface === 'hidden') {
      win.hide();
      this.deps.onVisibilityChange(false);
      this.syncCursorFollow();
      return;
    }

    const display = this.anchorDisplay();
    const size = fitPresentationSize(requestedSize, display.workArea);
    const target = anchoredTopCenterBounds(display.workArea, size, this.topOffset);

    const current = win.getBounds();
    if (!sameBounds(current, target)) win.setBounds(target, false);

    if (this.mainReady && !this.workspaceFocused && !win.isVisible()) {
      win.showInactive();
      this.deps.onVisibilityChange(true);
    }
    this.syncCursorFollow();
  }

  /** Apply pinned-bar and independent cursor-companion settings. */
  setPresentationSettings(settings: PresentationSettings): void {
    this.topOffset = settings.topOffset;
    this.followSpeed = settings.followSpeed;
    this.cursorOffset = settings.cursorOffset;
    this.reducedMotion = settings.reducedMotion;
    this.cursorCompanionEnabled = settings.cursorCompanionEnabled;
    this.resolveAnchor(settings.monitorId, settings.position);

    if (this.cursorWindow && !this.cursorWindow.isDestroyed() && !this.cursorWindow.webContents.isDestroyed()) {
      try {
        this.cursorWindow.webContents.send(CHANNELS.windowCursorMotion, this.reducedMotion);
      } catch {
        // A renderer notification must never make a valid Settings save fail.
      }
    }

    const win = this.main;
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds();
      const display = this.anchorDisplay();
      const target = anchoredTopCenterBounds(display.workArea, bounds, this.topOffset);
      if (!sameBounds(bounds, target)) win.setBounds(target, false);
    }
    this.syncCursorWindow();
    this.syncCursorFollow();
  }

  /* ---------------------------- visibility ---------------------------- */

  show(): void {
    const win = this.createMainWindow();
    this.mainVisibleRequested = true;
    if (win.isMinimized()) win.restore();
    this.pendingSummon = true;
    if (this.mainReady && !this.workspaceFocused) {
      if (!win.isVisible()) win.showInactive();
      this.deps.onVisibilityChange(true);
    }
    if (this.mainReady && !win.webContents.isLoading()) {
      this.pendingSummon = false;
      win.webContents.send(CHANNELS.windowSummon);
    }
    this.syncCursorWindow();
    this.syncCursorFollow();
  }

  hide(): void {
    const win = this.main;
    this.mainVisibleRequested = false;
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

  private syncCursorWindow(): void {
    if (!this.cursorCompanionEnabled) {
      this.stopCursorFollow();
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.close();
      this.cursorWindow = null;
      return;
    }
    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const initial = companionTarget(cursor, display.workArea, {
      offset: this.cursorOffset,
      size: { width: CURSOR_WINDOW_SIZE, height: CURSOR_WINDOW_SIZE },
      margin: 8,
    });
    const win = new BrowserWindow({
      x: Math.round(initial.x),
      y: Math.round(initial.y),
      width: CURSOR_WINDOW_SIZE,
      height: CURSOR_WINDOW_SIZE,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      focusable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed() && this.cursorCompanionEnabled) {
        win.showInactive();
        this.cursorWindow = win;
        this.startCursorFollow();
      }
    });
    win.on('closed', () => {
      if (this.cursorWindow === win) {
        this.cursorWindow = null;
        this.stopCursorFollow();
      }
    });
    this.loadRenderer(win, '?window=cursor');
    this.cursorWindow = win;
  }

  private startCursorFollow(): void {
    if (!this.cursorCompanionEnabled || this.surface !== 'idle' || this.followTimer) return;
    const win = this.cursorWindow;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const [x, y] = win.getPosition();
    this.follower = createFollower({ x, y });
    this.followTickAt = Date.now();
    // Poll only while the explicitly enabled click-through buddy is visible.
    this.followTimer = setInterval(() => this.tickCursorFollow(), 33);
    this.followTimer.unref?.();
  }

  private stopCursorFollow(): void {
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = null;
    this.follower = null;
  }

  private tickCursorFollow(): void {
    const win = this.cursorWindow;
    if (!this.cursorCompanionEnabled || this.surface !== 'idle' || !win || win.isDestroyed() || !win.isVisible()) {
      this.stopCursorFollow();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const target = companionTarget(cursor, display.workArea, {
      offset: this.cursorOffset,
      size: { width: CURSOR_WINDOW_SIZE, height: CURSOR_WINDOW_SIZE },
      margin: 8,
    });
    const now = Date.now();
    if (this.reducedMotion || !this.follower) {
      this.follower = createFollower(target);
    } else {
      this.follower = stepFollower(
        this.follower,
        target,
        Math.min(0.1, Math.max(0, (now - this.followTickAt) / 1000)),
        { ...DEFAULT_FOLLOW_CONFIG, speed: this.followSpeed },
      );
      if (isSettled(this.follower, target)) this.follower = settle(target);
    }
    this.followTickAt = now;
    const nextX = Math.round(this.follower.position.x);
    const nextY = Math.round(this.follower.position.y);
    const [currentX, currentY] = win.getPosition();
    if (Math.abs(nextX - currentX) > 1 || Math.abs(nextY - currentY) > 1) win.setPosition(nextX, nextY);
  }

  private syncCursorFollow(): void {
    if (this.cursorCompanionEnabled && this.surface === 'idle') this.startCursorFollow();
    else this.stopCursorFollow();
  }

  /* ------------------------------ displays ---------------------------- */

  private registerDisplayListeners(): void {
    const reclamp = () => {
      const win = this.main;
      this.resolveAnchor(this.anchorDisplayId, this.legacyPosition);
      if (win && !win.isDestroyed()) {
        const bounds = win.getBounds();
        win.setBounds(anchoredTopCenterBounds(this.anchorDisplay().workArea, bounds, this.topOffset));
      }
      this.syncCursorFollow();
    };

    // Re-anchor to the selected display; if it was removed, safely fall back.
    screen.on('display-removed', reclamp);
    screen.on('display-added', reclamp);
    screen.on('display-metrics-changed', reclamp);
    this.displayListeners.push(reclamp);
  }

  private resolveAnchor(monitorId: string | null, legacyPosition: { x: number; y: number } | null): void {
    const displays = screen.getAllDisplays();
    const availableIds = displays.map((display) => String(display.id));
    const primaryId = String(screen.getPrimaryDisplay().id);
    const legacyDisplayId = legacyPosition
      ? String(screen.getDisplayNearestPoint(legacyPosition).id)
      : null;
    const resolvedId = resolveAnchorDisplayId(monitorId, legacyDisplayId, availableIds, primaryId);
    const migrated = monitorId !== resolvedId || legacyPosition !== null;
    this.anchorDisplayId = resolvedId;
    this.legacyPosition = null;
    if (migrated) this.persistAnchor();
  }

  private anchorDisplay(): Display {
    const displays = screen.getAllDisplays();
    const resolvedId = resolveAnchorDisplayId(
      this.anchorDisplayId,
      null,
      displays.map((display) => String(display.id)),
      String(screen.getPrimaryDisplay().id),
    );
    this.anchorDisplayId = resolvedId;
    return displays.find((display) => String(display.id) === resolvedId) ?? screen.getPrimaryDisplay();
  }

  private anchorBounds(size: { width: number; height: number }): ReturnType<typeof anchoredTopCenterBounds> {
    this.resolveAnchor(this.anchorDisplayId, this.legacyPosition);
    const display = this.anchorDisplay();
    return anchoredTopCenterBounds(display.workArea, size, this.topOffset);
  }

  private persistAnchor(): void {
    if (this.anchorDisplayId === null) return;
    this.deps.onAnchorChange({ monitorId: this.anchorDisplayId, position: null });
  }

  dispose(): void {
    this.stopCursorFollow();
    this.workspace?.close();
    this.workspace = null;
    this.settings?.close();
    this.settings = null;
    this.main?.close();
    this.main = null;
    this.cursorWindow?.close();
    this.cursorWindow = null;
    for (const listener of this.displayListeners) {
      screen.removeListener('display-removed', listener);
      screen.removeListener('display-added', listener);
      screen.removeListener('display-metrics-changed', listener);
    }
    this.displayListeners.length = 0;
  }
}

function sameBounds(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
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
