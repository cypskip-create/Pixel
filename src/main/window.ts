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

import { BrowserWindow, screen, shell } from 'electron';
import type { Display, WebContents, WebFrameMain } from 'electron';
import { join } from 'node:path';
import type {
  CompanionSettings,
  AssistantState,
  ScreenWindowTarget,
  ScreenDrawingSceneSnapshot,
  Surface,
  VisualGuidanceAnnotation,
  VisualGuidanceShape,
  VisualGuidanceSnapshot,
  WorkspaceWindowState,
} from '../shared/types';
import { CHANNELS } from '../shared/channels';
import { attachWindowSecurityPolicy, isTrustedRendererUrl } from './windowPolicy';
import type { Point } from '../shared/companion/geometry';

import { DEFAULT_OFFSET_FROM_TOP, SURFACE_SIZES } from '../shared/surfaces';
import {
  anchoredTopCenterBounds,
  fitPresentationSize,
  resolveAnchorDisplayId,
} from '../shared/presentationLayout';
import {
  CURSOR_WINDOW_SIZE,
  createFollower,
  DEFAULT_FOLLOW_CONFIG,
  DEFAULT_PLACE_OPTIONS,
  isSettled,
  placeCursorCompanion,
  settle,
  stepFollowerBounded,
  shouldShowCursorCompanion,
  shouldSnapCursorFollower,
  type CursorPlacement,
  type CursorOrientation,
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
  onCursorDiagnostic?: (message: string, error?: boolean) => void;
  workspaceWindow?: { x: number | null; y: number | null; width: number; height: number; maximized: boolean };
  onWorkspaceBoundsChange?: (state: { x: number; y: number; width: number; height: number; maximized: boolean }) => void;
}

type PresentationSettings = Pick<
  CompanionSettings,
  'monitorId' | 'position' | 'topOffset' | 'cursorCompanionEnabled' | 'followSpeed' | 'cursorOffset' | 'reducedMotion'
>;

export class WindowManager {
  private main: BrowserWindow | null = null;
  private settings: BrowserWindow | null = null;
  private workspace: BrowserWindow | null = null;
  private mainReady = false;
  private workspaceFocused = false;
  private mainVisibleRequested = true;
  private cursorWindow: BrowserWindow | null = null;
  private cursorWindowReady = false;
  private cursorReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorAssistantState: AssistantState = 'idle';
  private cursorVisibilityStatus = '';
  private guidanceWindow: BrowserWindow | null = null;
  private guidanceWindowReady = false;
  private guidanceTimer: ReturnType<typeof setInterval> | null = null;
  private guidanceRefreshPromise: Promise<void> | null = null;
  private guidanceRefreshRequested = false;
  private guidanceGeneration = 0;
  private guidanceTarget: ScreenWindowTarget | null = null;
  private readonly guidanceEntries = new Map<string, {
    selector: string;
    role?: string;
    annotation: VisualGuidanceAnnotation;
    expiresAt: number;
  }>();
  private guidanceValidator: ((target: ScreenWindowTarget, selector: string, role?: string) => Promise<{
    status: 'foreground' | 'background' | 'stale';
    bounds?: { x: number; y: number; width: number; height: number };
  }>) | null = null;
  private guidanceVisible = false;
  private drawingScene: ScreenDrawingSceneSnapshot | null = null;
  private surface: Surface = 'idle';
  private anchorDisplayId: string | null = null;
  private topOffset = DEFAULT_OFFSET_FROM_TOP;
  private cursorCompanionEnabled = false;
  private followSpeed = 1;
  private cursorOffset = { x: 8, y: 8 };
  private reducedMotion = false;
  private followTimer: ReturnType<typeof setInterval> | null = null;
  private follower: FollowState | null = null;
  private followTickAt = 0;
  private previousCursor: Point | null = null;
  private cursorDisplayId: number | null = null;
  private cursorPlacement: CursorPlacement | null = null;
  private sessionLocked = false;
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
    this.hardenWindow(win, 'main', true);

    win.once('ready-to-show', () => {
      this.mainReady = true;
      if (this.mainVisibleRequested && !this.workspaceFocused && this.surface !== 'hidden') {
        win.showInactive();
        this.deps.onVisibilityChange(true);
      }
      this.syncCursorWindow();
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
      this.syncCursorWindow();
    });

    this.loadRenderer(win);
    this.main = win;
    return win;
  }

  setGuidanceTargetValidator(
    validator: (target: ScreenWindowTarget, selector: string, role?: string) => Promise<{
      status: 'foreground' | 'background' | 'stale';
      bounds?: { x: number; y: number; width: number; height: number };
    }>,
  ): void {
    this.guidanceValidator = validator;
  }

  async showVisualGuidance(request: {
    target: ScreenWindowTarget;
    selector: string;
    role?: string;
    shape: VisualGuidanceShape;
    label?: string;
    step?: number;
    durationMs: number;
    bounds: { x: number; y: number; width: number; height: number };
  }): Promise<'visible' | 'waiting_foreground' | 'unavailable'> {
    if (this.sessionLocked || !this.guidanceValidator || !validGuidanceRequest(request)) return 'unavailable';
    if (this.guidanceTarget && !sameTarget(this.guidanceTarget, request.target)) this.clearVisualGuidance();
    if (!this.guidanceEntries.has(request.selector) && this.guidanceEntries.size >= 8) return 'unavailable';
    this.guidanceGeneration += 1;
    this.guidanceTarget = { ...request.target };
    const annotation: VisualGuidanceAnnotation = {
      id: request.selector,
      shape: request.shape,
      bounds: { ...request.bounds },
      ...(request.label ? { label: request.label } : {}),
      ...(request.step ? { step: request.step } : {}),
    };
    this.guidanceEntries.set(request.selector, {
      selector: request.selector,
      ...(request.role ? { role: request.role } : {}),
      annotation,
      expiresAt: Date.now() + Math.max(3_000, Math.min(30_000, request.durationMs)),
    });
    this.createGuidanceWindow();
    if (!this.guidanceTimer) {
      this.guidanceTimer = setInterval(() => { void this.refreshGuidance(); }, 650);
      this.guidanceTimer.unref?.();
    }
    await this.refreshGuidance();
    await this.waitForGuidanceReady(2_000);
    await this.refreshGuidance();
    if (!this.guidanceEntries.has(request.selector)) return 'unavailable';
    return this.guidanceVisible && Boolean(this.guidanceWindow && !this.guidanceWindow.isDestroyed() && this.guidanceWindow.isVisible())
      ? 'visible'
      : 'waiting_foreground';
  }

  clearVisualGuidance(selector?: string): void {
    this.guidanceGeneration += 1;
    if (selector) this.guidanceEntries.delete(selector);
    else this.guidanceEntries.clear();
    if (this.guidanceEntries.size > 0) {
      void this.refreshGuidance();
      return;
    }
    this.guidanceTarget = null;
    this.guidanceVisible = false;
    if (this.guidanceTimer) clearInterval(this.guidanceTimer);
    this.guidanceTimer = null;
    const win = this.guidanceWindow;
    this.guidanceWindow = null;
    this.guidanceWindowReady = false;
    if (win && !win.isDestroyed()) win.close();
  }

  private createGuidanceWindow(): void {
    if (this.guidanceWindow && !this.guidanceWindow.isDestroyed()) return;
    const win = new BrowserWindow({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
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
    // Mirror HeyClicky OverlayWindow WDA_EXCLUDEFROMCAPTURE so Pixel never captures its own drawings.
    win.setContentProtection(true);
    win.setFocusable(false);
    win.setIgnoreMouseEvents(true, { forward: true });
    win.once('ready-to-show', () => {
      if (this.guidanceWindow !== win || win.isDestroyed()) return;
      this.guidanceWindowReady = true;
      void this.refreshGuidance();
      if (this.drawingScene) void this.publishScreenDrawing(this.drawingScene);
    });
    this.hardenWindow(win, 'guidance', false);
    win.on('closed', () => {
      if (this.guidanceWindow !== win) return;
      this.guidanceWindow = null;
      this.guidanceWindowReady = false;
      this.guidanceVisible = false;
      this.guidanceEntries.clear();
      this.guidanceTarget = null;
      if (this.guidanceTimer) clearInterval(this.guidanceTimer);
      this.guidanceTimer = null;
    });
    this.loadRenderer(win, '?window=guidance');
    this.guidanceWindow = win;
  }

  private async waitForGuidanceReady(timeoutMs: number): Promise<boolean> {
    if (this.guidanceWindowReady) return true;
    const win = this.guidanceWindow;
    if (!win || win.isDestroyed()) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        win.removeListener('closed', onClosed);
        resolve(ready);
      };
      const onClosed = (): void => finish(false);
      const timer = setTimeout(() => finish(this.guidanceWindowReady), timeoutMs);
      win.once('ready-to-show', () => finish(true));
      win.once('closed', onClosed);
    });
  }

  private refreshGuidance(): Promise<void> {
    const running = this.guidanceRefreshPromise;
    if (running) {
      this.guidanceRefreshRequested = true;
      return running.then(async () => {
        if (!this.guidanceRefreshRequested) return;
        this.guidanceRefreshRequested = false;
        await this.refreshGuidance();
      });
    }
    const current = this.updateGuidance();
    this.guidanceRefreshPromise = current.finally(() => { this.guidanceRefreshPromise = null; });
    return this.guidanceRefreshPromise;
  }

  private async updateGuidance(): Promise<void> {
    if (this.sessionLocked || !this.guidanceTarget || !this.guidanceValidator || this.guidanceEntries.size === 0) {
      this.clearVisualGuidance();
      return;
    }
    const generation = this.guidanceGeneration;
    const target = { ...this.guidanceTarget };
    const entries = [...this.guidanceEntries.entries()];
    try {
      const now = Date.now();
      for (const [id, entry] of this.guidanceEntries) {
        if (entry.expiresAt <= now) this.guidanceEntries.delete(id);
      }
      if (this.guidanceEntries.size === 0) {
        this.clearVisualGuidance();
        return;
      }

      let allForeground = true;
      for (const [id, entry] of entries) {
        const status = await this.guidanceValidator(target, entry.selector, entry.role);
        if (generation !== this.guidanceGeneration) return;
        if (status.status === 'stale' || !status.bounds || status.bounds.width <= 0 || status.bounds.height <= 0) {
          this.guidanceEntries.delete(id);
          continue;
        }
        entry.annotation.bounds = { ...status.bounds };
        if (status.status !== 'foreground') allForeground = false;
      }
      if (this.guidanceEntries.size === 0) {
        this.clearVisualGuidance();
        return;
      }
      if (generation !== this.guidanceGeneration) return;
      if (!allForeground) {
        this.guidanceVisible = false;
        this.publishGuidance({ visible: false, bounds: null, annotations: [...this.guidanceEntries.values()].map((entry) => entry.annotation) });
        return;
      }
      const annotations = [...this.guidanceEntries.values()].map((entry) => entry.annotation);
      const bounds = boundsForGuidance(annotations);
      this.guidanceVisible = true;
      this.publishGuidance({ visible: true, bounds, annotations });
    } catch {
      // A failed identity/UIA recheck cannot leave a potentially stale outline.
      if (generation === this.guidanceGeneration) this.clearVisualGuidance();
    }
  }

  private publishGuidance(snapshot: VisualGuidanceSnapshot): void {
    const win = this.guidanceWindow;
    if (!win || win.isDestroyed() || !this.guidanceWindowReady) return;
    try {
      if (snapshot.visible && snapshot.bounds) {
        const current = win.getBounds();
        if (!sameBounds(current, snapshot.bounds)) win.setBounds(snapshot.bounds, false);
        win.webContents.send(CHANNELS.screenGuidanceUpdate, snapshot);
        if (!win.isVisible()) {
          win.setIgnoreMouseEvents(true, { forward: true });
          win.showInactive();
        }
      } else {
        win.webContents.send(CHANNELS.screenGuidanceUpdate, snapshot);
        if (win.isVisible()) win.hide();
      }
    } catch {
      this.clearVisualGuidance();
    }
  }

  /**
   * Publish a Python-authored ScreenDrawingSceneSnapshot to the transparent
   * overlay window (reusing `guidanceWindow` with capture exclusion enabled).
   */
  async publishScreenDrawing(snapshot: ScreenDrawingSceneSnapshot): Promise<void> {
    if (this.sessionLocked) {
      this.clearScreenDrawing();
      return;
    }
    const display = this.anchorDisplay();
    const viewport = { ...display.bounds };
    const enriched: ScreenDrawingSceneSnapshot = { ...snapshot, viewport };
    this.drawingScene = enriched;

    if (!enriched.visible) {
      const win = this.guidanceWindow;
      if (win && !win.isDestroyed()) {
        win.setFocusable(false);
        win.setIgnoreMouseEvents(true, { forward: true });
        if (this.guidanceWindowReady) {
          win.webContents.send(CHANNELS.drawingUpdate, enriched);
        }
        if (this.guidanceEntries.size === 0 && win.isVisible()) {
          win.hide();
        }
      }
      return;
    }

    this.createGuidanceWindow();
    await this.waitForGuidanceReady(2_000);
    const win = this.guidanceWindow;
    if (!win || win.isDestroyed() || !this.guidanceWindowReady) return;
    try {
      const current = win.getBounds();
      if (!sameBounds(current, viewport)) win.setBounds(viewport, false);
      if (enriched.interactive) {
        win.setFocusable(true);
        win.setIgnoreMouseEvents(false);
        if (!win.isVisible()) win.show();
        win.focus();
      } else {
        win.setFocusable(false);
        win.setIgnoreMouseEvents(true, { forward: true });
        if (!win.isVisible()) win.showInactive();
      }
      win.webContents.send(CHANNELS.drawingUpdate, enriched);
    } catch {
      this.clearScreenDrawing();
    }
  }

  clearScreenDrawing(): void {
    const empty: ScreenDrawingSceneSnapshot = {
      visible: false,
      interactive: false,
      generation: (this.drawingScene?.generation ?? 0) + 1,
      annotations: [],
      canUndo: false,
      canRedo: false,
      updatedAt: Date.now(),
      viewport: null,
    };
    this.drawingScene = empty;
    const win = this.guidanceWindow;
    if (win && !win.isDestroyed()) {
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true, { forward: true });
      if (this.guidanceWindowReady) {
        win.webContents.send(CHANNELS.drawingUpdate, empty);
      }
      if (this.guidanceEntries.size === 0 && win.isVisible()) {
        win.hide();
      }
    }
  }

  createSettingsWindow(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.focus();
      return this.settings;
    }

    const win = new BrowserWindow({
      width: 1120,
      height: 760,
      title: 'Pixel Settings',
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      backgroundColor: '#0a0b0e',
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    win.once('ready-to-show', () => {
      win.show();
      this.syncCursorWindow();
    });
    this.hardenWindow(win, 'settings', true);
    win.on('closed', () => {
      this.settings = null;
      this.syncCursorWindow(true);
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
      backgroundColor: '#0d0d0d',
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
    this.hardenWindow(win, 'workspace', true);

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

  isCursorSender(sender: WebContents): boolean {
    return Boolean(this.cursorWindow && !this.cursorWindow.isDestroyed() && this.cursorWindow.webContents === sender);
  }

  isTrustedCursorApplicationSender(sender: WebContents, frame: WebFrameMain | null): boolean {
    if (!this.isCursorSender(sender) || !frame || frame !== sender.mainFrame) return false;
    return isTrustedRendererUrl(frame.url, this.deps.rendererIndexPath, this.deps.devServerUrl);
  }

  markCursorRendererReady(sender: WebContents): void {
    if (!this.isCursorSender(sender) || this.cursorWindowReady) return;
    this.cursorWindowReady = true;
    if (this.cursorReadyTimer !== null) clearTimeout(this.cursorReadyTimer);
    this.cursorReadyTimer = null;
    this.reportCursorStatus(`renderer-ready; display=${screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id}; window=${CURSOR_WINDOW_SIZE}x${CURSOR_WINDOW_SIZE}`);
    this.sendCursorState();
    this.sendCursorPlacement();
    this.syncCursorWindow(true);
  }

  setCursorAssistantState(state: AssistantState): void {
    if (this.cursorAssistantState === state) return;
    this.cursorAssistantState = state;
    this.sendCursorState();
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
    this.syncCursorWindow();
  }

  private restoreIslandAfterWorkspace(): void {
    if (this.workspaceFocused) return;
    const win = this.main;
    if (this.mainVisibleRequested && win && !win.isDestroyed() && this.mainReady && this.surface !== 'hidden' && !win.isVisible()) {
      win.showInactive();
      this.deps.onVisibilityChange(true);
    }
    this.syncCursorWindow(true);
  }

  private hardenWindow(
    win: BrowserWindow,
    windowRole: 'main' | 'workspace' | 'settings' | 'cursor' | 'guidance',
    allowExternalLinks: boolean,
  ): void {
    attachWindowSecurityPolicy(win.webContents, {
      windowRole,
      rendererIndexPath: this.deps.rendererIndexPath,
      devServerUrl: this.deps.devServerUrl,
      allowExternalLinks,
      openExternal: allowExternalLinks ? (safeUrl) => { void shell.openExternal(safeUrl); } : undefined,
    });
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
   * Apply one deliberate presentation-state layout. Its fixed size is clamped
   * to the selected display's work area before it reaches native window bounds.
   */
  setLayout(surface: Surface, requestedSize: { width: number; height: number }): void {
    this.surface = surface;
    const win = this.main;
    if (!win || win.isDestroyed()) {
      this.syncCursorWindow();
      return;
    }

    if (surface === 'hidden') {
      win.hide();
      this.deps.onVisibilityChange(false);
      this.syncCursorWindow();
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
    this.syncCursorWindow();
  }

  /** Apply pinned-bar and independent cursor-companion settings. */
  setPresentationSettings(settings: PresentationSettings): void {
    const offsetChanged = this.cursorOffset.x !== settings.cursorOffset.x || this.cursorOffset.y !== settings.cursorOffset.y;
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
    this.syncCursorWindow(offsetChanged);
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
    this.syncCursorWindow(true);
  }

  hide(): void {
    const win = this.main;
    this.mainVisibleRequested = false;
    if (win && !win.isDestroyed()) {
      win.hide();
      this.deps.onVisibilityChange(false);
    }
    this.syncCursorWindow();
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

  private canShowCursorCompanion(): boolean {
    return shouldShowCursorCompanion({
      enabled: this.cursorCompanionEnabled,
      settingsOpen: Boolean(this.settings && !this.settings.isDestroyed() && this.settings.isVisible()),
      workspaceFocused: this.workspaceFocused,
      sessionLocked: this.sessionLocked,
    });
  }

  private reportCursorStatus(status: string, error = false): void {
    if (this.cursorVisibilityStatus === status) return;
    this.cursorVisibilityStatus = status;
    this.deps.onCursorDiagnostic?.(status, error);
  }

  /** Refreshes cursor tracking after a power/display transition or settings change. */
  refreshCursorCompanion(): void {
    this.syncCursorWindow(true);
  }

  setSessionLocked(locked: boolean): void {
    if (this.sessionLocked === locked) return;
    this.sessionLocked = locked;
    if (locked) this.clearVisualGuidance();
    this.syncCursorWindow(true);
  }

  private syncCursorWindow(forceSnap = false): void {
    if (!this.cursorCompanionEnabled) {
      this.reportCursorStatus('disabled');
      this.stopCursorFollow();
      if (this.cursorReadyTimer !== null) clearTimeout(this.cursorReadyTimer);
      this.cursorReadyTimer = null;
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) this.cursorWindow.close();
      this.cursorWindow = null;
      this.cursorWindowReady = false;
      this.cursorPlacement = null;
      this.previousCursor = null;
      this.cursorDisplayId = null;
      return;
    }

    if (!this.canShowCursorCompanion()) {
      this.stopCursorFollow();
      const reason = this.sessionLocked ? 'session-locked'
        : this.settings && !this.settings.isDestroyed() && this.settings.isVisible() ? 'settings-open'
          : 'visibility-policy';
      this.reportCursorStatus(`hidden: ${reason}`);
      if (this.cursorWindow && !this.cursorWindow.isDestroyed() && this.cursorWindow.isVisible()) {
        this.cursorWindow.hide();
      }
      this.previousCursor = null;
      this.cursorDisplayId = null;
      return;
    }

    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
      if (!this.cursorWindowReady) {
        this.reportCursorStatus('waiting: renderer-ready-ack');
        return;
      }
      if (!this.cursorWindow.isVisible() || forceSnap) this.positionCursorCompanion(true);
      if (!this.cursorWindow.isVisible()) {
        this.cursorWindow.showInactive();
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        this.reportCursorStatus(`visible; display=${display.id}; window=${CURSOR_WINDOW_SIZE}x${CURSOR_WINDOW_SIZE}`);
      }
      this.startCursorFollow();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const initial = placeCursorCompanion(cursor, display.workArea, {
      ...DEFAULT_PLACE_OPTIONS,
      offset: this.cursorOffset,
    });
    const win = new BrowserWindow({
      x: Math.round(initial.position.x),
      y: Math.round(initial.position.y),
      width: CURSOR_WINDOW_SIZE,
      height: CURSOR_WINDOW_SIZE,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      ...(process.platform === 'win32' ? { backgroundMaterial: 'none' as const } : {}),
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
    this.hardenWindow(win, 'cursor', false);
    win.webContents.on('did-finish-load', () => {
      if (this.cursorWindow !== win) return;
      this.reportCursorStatus('renderer-loaded; awaiting-ready-ack');
    });
    win.webContents.on('did-fail-load', (_event, code, description) => {
      if (this.cursorWindow === win) this.reportCursorStatus(`renderer-load-failed: ${code} ${description}`, true);
    });
    win.webContents.on('preload-error', (_event, preload, error) => {
      if (this.cursorWindow === win) this.reportCursorStatus(`preload-failed: ${preload} ${error.message}`, true);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      if (this.cursorWindow === win) this.reportCursorStatus(`renderer-crashed: ${details.reason} exit=${details.exitCode}`, true);
    });
    this.cursorReadyTimer = setTimeout(() => {
      if (this.cursorWindow === win && !this.cursorWindowReady) {
        this.reportCursorStatus('renderer-ready-ack timed out after 8s; cursor window remains hidden. Toggle the setting to retry.', true);
      }
    }, 8_000);
    this.cursorReadyTimer.unref?.();
    win.on('closed', () => {
      if (this.cursorWindow === win) {
        if (this.cursorReadyTimer !== null) clearTimeout(this.cursorReadyTimer);
        this.cursorReadyTimer = null;
        this.cursorWindow = null;
        this.cursorWindowReady = false;
        this.stopCursorFollow();
        this.cursorPlacement = null;
        this.previousCursor = null;
        this.cursorDisplayId = null;
        this.reportCursorStatus('window-closed');
      }
    });
    this.loadRenderer(win, '?window=cursor');
    this.cursorWindow = win;
    this.reportCursorStatus(`created; awaiting renderer; display=${display.id}; window=${CURSOR_WINDOW_SIZE}x${CURSOR_WINDOW_SIZE}`);
  }

  private startCursorFollow(): void {
    if (!this.canShowCursorCompanion() || this.followTimer) return;
    const win = this.cursorWindow;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.cursorWindowReady) return;
    if (!this.follower) this.positionCursorCompanion(true);
    this.followTickAt = Date.now();
    // Poll only while the explicitly enabled click-through buddy is visible.
    // Native position writes are skipped while stationary.
    this.followTimer = setInterval(() => this.tickCursorFollow(), 33);
    this.followTimer.unref?.();
  }

  private stopCursorFollow(): void {
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = null;
    this.follower = null;
    this.followTickAt = 0;
  }

  private tickCursorFollow(): void {
    const win = this.cursorWindow;
    if (!this.canShowCursorCompanion() || !win || win.isDestroyed() || !win.isVisible()) {
      this.syncCursorWindow();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const placement = placeCursorCompanion(cursor, display.workArea, {
      ...DEFAULT_PLACE_OPTIONS,
      offset: this.cursorOffset,
    }, this.cursorPlacement ?? undefined);
    const now = Date.now();
    const displayChanged = this.cursorDisplayId !== null && this.cursorDisplayId !== display.id;
    const snap = this.reducedMotion || shouldSnapCursorFollower({
      cursor,
      previousCursor: this.previousCursor,
      elapsedMs: this.followTickAt === 0 ? Number.POSITIVE_INFINITY : now - this.followTickAt,
      displayChanged,
    });
    if (snap || !this.follower) {
      this.follower = createFollower(placement.position);
    } else {
      this.follower = stepFollowerBounded(
        this.follower,
        placement.position,
        Math.min(0.1, Math.max(0, (now - this.followTickAt) / 1000)),
        { ...DEFAULT_FOLLOW_CONFIG, speed: this.followSpeed },
      );
      if (isSettled(this.follower, placement.position)) this.follower = settle(placement.position);
    }
    this.followTickAt = now;
    this.previousCursor = cursor;
    this.cursorDisplayId = display.id;
    this.updateCursorPlacement(placement);
    const nextX = Math.round(this.follower.position.x);
    const nextY = Math.round(this.follower.position.y);
    const [currentX, currentY] = win.getPosition();
    if (nextX !== currentX || nextY !== currentY) win.setPosition(nextX, nextY);
  }

  private positionCursorCompanion(snap: boolean): void {
    const win = this.cursorWindow;
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const placement = placeCursorCompanion(cursor, display.workArea, {
      ...DEFAULT_PLACE_OPTIONS,
      offset: this.cursorOffset,
    }, this.cursorPlacement ?? undefined);
    const x = Math.round(placement.position.x);
    const y = Math.round(placement.position.y);
    const bounds = win.getBounds();
    if (bounds.x !== x || bounds.y !== y) win.setPosition(x, y);
    this.previousCursor = cursor;
    this.cursorDisplayId = display.id;
    if (snap || !this.follower) this.follower = createFollower(placement.position);
    this.followTickAt = Date.now();
    this.updateCursorPlacement(placement);
  }

  private updateCursorPlacement(placement: CursorPlacement): void {
    if (this.cursorPlacement?.flipX === placement.flipX && this.cursorPlacement?.flipY === placement.flipY) return;
    this.cursorPlacement = { ...placement, position: { ...placement.position } };
    this.sendCursorPlacement();
  }

  private sendCursorPlacement(): void {
    const win = this.cursorWindow;
    if (!this.cursorPlacement || !win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) return;
    try {
      const orientation: CursorOrientation = { flipX: this.cursorPlacement.flipX, flipY: this.cursorPlacement.flipY };
      win.webContents.send(CHANNELS.windowCursorPlacement, orientation);
    } catch {
      // The renderer may be shutting down while the pointer is moving.
    }
  }

  private sendCursorState(): void {
    const win = this.cursorWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) return;
    try { win.webContents.send(CHANNELS.windowCursorState, this.cursorAssistantState); }
    catch { /* the passive renderer can be navigating or closing */ }
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
      this.syncCursorWindow(true);
      void this.refreshGuidance();
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
    this.sessionLocked = true;
    this.clearVisualGuidance();
    this.stopCursorFollow();
    this.workspace?.close();
    this.workspace = null;
    this.settings?.close();
    this.settings = null;
    this.main?.close();
    this.main = null;
    this.cursorWindow?.close();
    this.cursorWindow = null;
    this.cursorWindowReady = false;
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

function validGuidanceRequest(request: {
  target: ScreenWindowTarget;
  selector: string;
  shape: VisualGuidanceShape;
  durationMs: number;
  bounds: { x: number; y: number; width: number; height: number };
}): boolean {
  const target = request.target;
  const bounds = request.bounds;
  return Boolean(target && target.windowId && target.title && target.processName && Number.isInteger(target.pid) && target.pid > 0 &&
    request.selector.trim().length > 0 &&
    (request.shape === 'rectangle' || request.shape === 'circle' || request.shape === 'arrow') &&
    Number.isFinite(request.durationMs) && request.durationMs >= 3_000 &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0);
}

function sameTarget(left: ScreenWindowTarget, right: ScreenWindowTarget): boolean {
  return left.windowId === right.windowId && left.title === right.title && left.pid === right.pid &&
    left.processName.toLocaleLowerCase() === right.processName.toLocaleLowerCase();
}

function boundsForGuidance(annotations: VisualGuidanceAnnotation[]): { x: number; y: number; width: number; height: number } {
  const padding = 14;
  const topLabelPadding = annotations.some((item) => item.label || item.step)
    ? 36
    : annotations.some((item) => item.shape === 'arrow') ? 28 : padding;
  let left = Math.min(...annotations.map((item) => item.bounds.x)) - padding;
  let top = Math.min(...annotations.map((item) => item.bounds.y)) - topLabelPadding;
  let right = Math.max(...annotations.map((item) => item.bounds.x + item.bounds.width)) + padding;
  let bottom = Math.max(...annotations.map((item) => item.bounds.y + item.bounds.height)) + padding;

  const display = screen.getDisplayMatching({ x: left, y: top, width: right - left, height: bottom - top });
  left = Math.max(left, display.bounds.x);
  top = Math.max(top, display.bounds.y);
  right = Math.min(right, display.bounds.x + display.bounds.width);
  bottom = Math.min(bottom, display.bounds.y + display.bounds.height);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
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
