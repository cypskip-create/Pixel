/**
 * Pixel application entry point.
 *
 * Assembly only: creates the settings store, the floating window, the tray, the
 * global shortcuts and the IPC surface, then keeps them in sync. Platform
 * concerns (single instance, startup, clean quit) also live here.
 */

import { app, BrowserWindow, Menu, powerMonitor, screen, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { join } from 'node:path';
import { CHANNELS } from '../shared/channels';
import { boot, describeError } from './startup/boot';
import {
  APP_NAME,
  LEGACY_APP_NAMES,
  describeMigration,
  migrateLegacyData,
  realFileSystem,
} from './startup/user-data';
import { registerIpcHandlers } from './ipc';
import { RuntimeProvider } from './providers/runtime';
import { ScreenCapture } from './screen';
import { SettingsStore } from './settings';
import { ShortcutManager } from './shortcuts';
import { PushToTalkReleaseWatcher } from './services/pushToTalkReleaseWatcher';
import { NativeHelper } from './services/nativeHelper';
import { TrayController } from './tray';
import { WindowManager } from './window';

/** Set by `npm run dev:electron`. */
const DEV_SERVER_URL = process.env.CYPS_DEV_SERVER_URL ?? null;

/**
 * Pin the data directory instead of letting Electron derive it from the app
 * name. Renaming the product would otherwise relocate settings, credentials,
 * history and task records, which looks to the user like data loss.
 *
 * Legacy Cyps data is copied (never moved, never deleted) on first launch.
 */
function resolveUserDataDir(): string {
  const roaming = app.getPath('appData');
  const target = join(roaming, APP_NAME);
  const legacy = LEGACY_APP_NAMES.map((name) => join(roaming, name));

  boot.stage('user data', `target=${target}`);
  const migration = migrateLegacyData({
    targetDir: target,
    legacyDirs: [...legacy],
    fs: realFileSystem,
  });
  app.setPath('userData', target);

  boot.info(`User data: ${target}`);
  boot.info(describeMigration(migration));
  for (const warning of migration.warnings) boot.warn(warning);

  return target;
}

let windows: WindowManager | null = null;
let shortcuts: ShortcutManager | null = null;
let tray: TrayController | null = null;
let settings: SettingsStore | null = null;
let stopRoutineScheduler: (() => void) | null = null;
let shutdownAgentWorkers: (() => void) | null = null;
let quitting = false;

/** __dirname of the compiled main bundle: <root>/dist/main/main. */
function mainDir(): string {
  return __dirname;
}

/** <root>/dist/renderer - the Vite production build. */
function rendererDir(): string {
  return join(mainDir(), '..', '..', 'renderer');
}

/** <root>/dist/main/preload/index.js - compiled alongside the main bundle. */
function preloadPath(): string {
  return join(mainDir(), '..', 'preload', 'index.js');
}

function nativeHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'PixelNative.exe')
    : join(app.getAppPath(), 'native', 'bin', 'PixelNative.exe');
}

function createWindowManager(store: SettingsStore): WindowManager {
  const manager = new WindowManager(store.get().companion, {
    preloadPath: preloadPath(),
    devServerUrl: DEV_SERVER_URL,
    rendererIndexPath: join(rendererDir(), 'index.html'),
    onAnchorChange: (anchor) => {
      // Persist only the selected display and clear the retired free-form point.
      try {
        store.set({ companion: anchor });
      } catch {
        // ignore
      }
    },
    onVisibilityChange: (visible) => {
      tray?.rebuild();
      void visible;
    },
    onCursorDiagnostic: (message, error = false) => {
      if (error) boot.error(`Cursor companion: ${message}`);
      else boot.info(`Cursor companion: ${message}`);
    },
    workspaceWindow: store.get().workspaceWindow,
    onWorkspaceBoundsChange: (state) => {
      try { store.set({ workspaceWindow: state }); } catch { /* window state is best-effort */ }
    },
  });
  return manager;
}

export async function start(): Promise<void> {
  boot.stage('app module loaded');

  // Only one Pixel may run: two floating orbs would fight over the tray.
  if (!app.requestSingleInstanceLock()) {
    boot.warn('Another Pixel instance holds the single-instance lock; exiting.');
    app.quit();
    return;
  }
  boot.stage('single instance lock acquired');

  // Windows uses this to group and identify the app correctly in the taskbar and
  // notification area. The id is an installation identity and intentionally
  // unchanged across the Cyps -> Pixel rename.
  app.setName(APP_NAME);
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.cyps.companion');
  }
  boot.stage('app identity set', app.getName());

  resolveUserDataDir();

  // Keep production on Electron's normal GPU path. Development can opt in to
  // --disable-gpu for diagnosis; packaged GPU failures are logged independently.
  app.commandLine.appendSwitch('enable-transparent-visuals');
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  }

  boot.stage('waiting for electron ready');
  await app.whenReady();
  boot.stage('electron ready');
  boot.info(`Renderer startup: platform=${process.platform} os=${osRelease()} disableGpu=${app.commandLine.hasSwitch('disable-gpu')}`);

  // No application menu: Pixel is not a document application and a menu bar in a
  // floating window would be visual noise.
  Menu.setApplicationMenu(null);

  /*
   * --diagnostic-window
   *
   * An ordinary, opaque, resizable Electron window that loads the same renderer.
   * It exists to separate "the renderer is broken" from "the floating window is
   * broken": transparency, frameless geometry and always-on-top can each fail on
   * their own, and this window uses none of them.
   *
   * It deliberately skips the tray, global shortcuts and the floating window so a
   * diagnosis cannot be confused by them.
   */
  if (process.argv.includes('--diagnostic-window')) {
    const { join } = await import('node:path');
    const rendererIndex = join(__dirname, '..', '..', 'renderer', 'index.html');
    boot.stage('diagnostic window', `renderer=${rendererIndex}`);

    const diagnostic = new BrowserWindow({
      width: 960,
      height: 680,
      title: 'Pixel diagnostics',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#101319',
      webPreferences: {
        preload: join(__dirname, '..', 'preload', 'index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    const { attachWindowSecurityPolicy } = await import('./windowPolicy');
    attachWindowSecurityPolicy(diagnostic.webContents, {
      windowRole: 'diagnostic',
      rendererIndexPath: rendererIndex,
      devServerUrl: null,
      allowExternalLinks: false,
    });

    diagnostic.once('ready-to-show', () => {
      diagnostic.show();
      boot.info('Diagnostic window is visible.');
    });
    diagnostic.webContents.on('did-fail-load', (_event, code, description, url) => {
      boot.error(`Diagnostic renderer failed to load (${String(code)} ${description}) for ${url}`);
    });
    diagnostic.webContents.on('preload-error', (_event, preload, error) => {
      boot.error(`Diagnostic preload failed (${preload}): ${describeError(error)}`);
    });

    try {
      await diagnostic.loadFile(rendererIndex);
      boot.stage('diagnostic window loaded');
    } catch (error) {
      boot.fatal(error);
      boot.error('The diagnostic window could not load the renderer.');
      app.exit(1);
      return;
    }
    return;
  }

  settings = new SettingsStore(app.getPath('userData'));
  const store = settings;

  windows = createWindowManager(store);
  windows.setPresentationSettings(store.get().companion);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: Array<'audio' | 'video'> }).mediaTypes;
    const audioOnly = permission === 'media' &&
      Array.isArray(mediaTypes) && mediaTypes.length === 1 &&
      mediaTypes[0] === 'audio';
    callback(audioOnly && windows?.isTrustedApplicationSender(contents, contents.mainFrame) === true);
  });

  // Capture is authorized per explicit UI action only.
  let captureAuthorized = false;
  const nativeHelper = new NativeHelper({ executablePath: nativeHelperPath(), exists: existsSync });
  try {
    await nativeHelper.startForegroundTracking();
  } catch (error) {
    boot.warn(`Foreground-window tracking is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  windows.setGuidanceTargetValidator(async (target, selector, role) => {
    const args = {
      targetWindowId: target.windowId,
      expectedWindowTitle: target.title,
      expectedProcessId: target.pid,
      expectedProcessName: target.processName,
    };
    const found = await nativeHelper.call('find_elements', {
      text: selector,
      ...(role ? { roles: [role] } : {}),
      maxResults: 25,
      ...args,
    });
    if (found.window.windowId !== target.windowId || found.window.pid !== target.pid ||
      found.window.title !== target.title || found.window.processName.toLocaleLowerCase() !== target.processName.toLocaleLowerCase()) {
      return { status: 'stale' as const };
    }
    const matches = found.elements.filter((element) =>
      element.automationId === selector || element.name.localeCompare(selector, undefined, { sensitivity: 'accent' }) === 0);
    if (matches.length !== 1 || matches[0].rect.width <= 0 || matches[0].rect.height <= 0) return { status: 'stale' as const };
    const foreground = await nativeHelper.call('foreground_window', {});
    const rect = screen.screenToDipRect(null, matches[0].rect);
    return {
      status: foreground?.windowId === target.windowId ? 'foreground' as const : 'background' as const,
      bounds: rect,
    };
  });
  const captures = new ScreenCapture({
    isAuthorized: () => captureAuthorized,
    nativeHelper,
    ownProcessIds: () => [process.pid],
  });
  void captureAuthorized;

  const provider = new RuntimeProvider(() => store.getApiKey(), {
    getSettings: () => store.get(),
    getProviderApiKey: (providerId) => store.getProviderApiKey(providerId),
  });

  const controller = await registerIpcHandlers({
    settings: store,
    windows,
    provider,
    nativeHelper,
    captures: {
      isAuthorized: () => captureAuthorized,
      listDisplays: () => captures.listDisplays(),
      listExternalWindows: () => captures.listExternalWindows(),
      captureActiveWindow: async () => {
        captureAuthorized = true;
        try {
          return await captures.captureActiveWindow();
        } finally {
          captureAuthorized = false;
        }
      },
      captureLastExternalWindow: async () => {
        captureAuthorized = true;
        try {
          return await captures.captureLastExternalWindow();
        } finally {
          captureAuthorized = false;
        }
      },
      captureSelectedWindow: async (target) => {
        captureAuthorized = true;
        try {
          return await captures.captureSelectedWindow(target);
        } finally {
          captureAuthorized = false;
        }
      },
      captureDisplay: async (displayId?: string) => {
        captureAuthorized = true;
        try {
          return await captures.captureDisplay(displayId);
        } finally {
          captureAuthorized = false;
        }
      },
      captureRegion: async (region) => {
        captureAuthorized = true;
        try {
          return await captures.captureRegion(region);
        } finally {
          captureAuthorized = false;
        }
      },
    },
    sendToRenderer: (channel, payload) => {
      const recipients = [windows?.getMainWindow(), windows?.getSettingsWindow(), windows?.getWorkspaceWindow()];
      for (const win of recipients) {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) continue;
        try { win.webContents.send(channel, payload); } catch { /* a closing window may reject delivery */ }
      }
    },
    sendToMainRenderer: (channel, payload) => {
      const main = windows?.getMainWindow();
      if (main && !main.isDestroyed() && !main.webContents.isDestroyed()) {
        try { main.webContents.send(channel, payload); } catch { /* a closing renderer may reject delivery */ }
      }
    },
    getShortcutStatus: () => shortcuts?.getStatus().pushToTalk ?? null,
    onSettingsChange: (next) => {
      shortcuts?.apply(next);
      tray?.rebuild();
      const recipients = [windows?.getMainWindow(), windows?.getSettingsWindow(), windows?.getWorkspaceWindow()];
      for (const win of recipients) {
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
          try { win.webContents.send(CHANNELS.settingsChanged, next); } catch { /* closing renderer */ }
        }
      }
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });
  stopRoutineScheduler = () => controller.routines.stop();
  shutdownAgentWorkers = controller.shutdown;

  // The tray may fail on some desktop configurations; Pixel still runs.
  tray = new TrayController({
    onToggle: () => windows?.toggle(),
    onSetMode: (mode) => {
      const next = store.set({ companion: { mode } });
      void next;
      tray?.rebuild();
      const win = windows?.getMainWindow();
      const recipients = [win, windows?.getSettingsWindow(), windows?.getWorkspaceWindow()];
      for (const recipient of recipients) {
        if (recipient && !recipient.isDestroyed() && !recipient.webContents.isDestroyed()) {
          try { recipient.webContents.send(CHANNELS.modeChanged, mode); } catch { /* closing renderer */ }
          try { recipient.webContents.send(CHANNELS.settingsChanged, next); } catch { /* closing renderer */ }
        }
      }
    },
    onOpenSettings: () => windows?.createSettingsWindow(),
    onOpenWorkspace: () => windows?.openWorkspace(),
    onEmergencyStop: () => {
      shortcuts?.cancelPushToTalk();
      controller.emergency.trigger();
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
    getMode: () => store.get().companion.mode,
    isVisible: () => windows?.isVisible() ?? false,
  });
  tray.create();

  shortcuts = new ShortcutManager({
    onToggle: () => windows?.toggle(),
    onOpenWorkspace: () => windows?.openWorkspace(),
    onEmergencyStop: () => {
      shortcuts?.cancelPushToTalk();
      controller.emergency.trigger();
    },
    onPushToTalkStart: () => controller.startPushToTalk(),
    onPushToTalkEnd: (reason) => controller.endPushToTalk(reason),
  }, new PushToTalkReleaseWatcher({ executablePath: nativeHelperPath(), exists: existsSync }));
  shortcuts.apply(store.get());
  powerMonitor.on('suspend', () => {
    windows?.setSessionLocked(true);
    shortcuts?.cancelPushToTalk();
    controller.cancelVoiceCapture();
  });
  powerMonitor.on('resume', () => {
    windows?.setSessionLocked(false);
    windows?.refreshCursorCompanion();
  });
  powerMonitor.on('lock-screen', () => {
    windows?.setSessionLocked(true);
    shortcuts?.cancelPushToTalk();
    controller.cancelVoiceCapture();
  });
  powerMonitor.on('unlock-screen', () => {
    windows?.setSessionLocked(false);
    windows?.refreshCursorCompanion();
  });

  const mainWindow = windows.createMainWindow();

  /*
   * A renderer that never finishes loading leaves `ready-to-show` unfired, and
   * the window would stay hidden forever - invisible process, no orb, exactly the
   * reported symptom. Force it visible after a grace period and say so.
   */
  mainWindow.once('ready-to-show', () => {
    const bounds = mainWindow.getBounds();
    boot.info(
      `Window painted: ${String(bounds.width)}x${String(bounds.height)} at ${String(bounds.x)},${String(bounds.y)}`,
    );
  });

  const showFallback = setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      boot.warn('ready-to-show did not fire within 8s; leaving the island hidden to avoid exposing an unpainted transparent window. Check renderer and GPU child-process diagnostics.');
    }
  }, 8000);
  mainWindow.once('closed', () => clearTimeout(showFallback));

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    boot.error(`Renderer failed to load (${String(code)} ${description}) for ${url}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPathValue, error) => {
    boot.error(`Preload failed (${preloadPathValue}): ${describeError(error)}`);
  });
  boot.info('Tray, shortcuts and IPC registered; main window created.');

  // Keep launch-on-startup in sync with settings.
  try {
    app.setLoginItemSettings({ openAtLogin: store.get().launchOnStartup });
  } catch {
    // Unsupported on some managed machines; not fatal.
  }

  // Global defense-in-depth for any WebContents created anywhere in the app:
  // block child popups, webviews, and untrusted external URLs.
  const { validateExternalUrl } = await import('./windowPolicy');
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (webviewEvent) => {
      webviewEvent.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      const safeUrl = validateExternalUrl(url);
      if (safeUrl) void shell.openExternal(safeUrl);
      return { action: 'deny' };
    });
  });

  app.on('activate', () => {
  const main = windows?.getMainWindow();
  if (!main || main.isDestroyed()) windows?.show();
  });
}

app.on('second-instance', () => {
  // A second launch summons the existing companion instead of starting a rival.
  windows?.show();
});

app.on('window-all-closed', () => {
  // Pixel is a tray-resident companion: closing the window hides it rather than
  // ending the process. Quitting goes through the tray or the app.
  if (quitting) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  boot.info('Quitting.');
  stopRoutineScheduler?.();
  stopRoutineScheduler = null;
  shutdownAgentWorkers?.();
  shutdownAgentWorkers = null;
  shortcuts?.unregisterAll();
  tray?.destroy();
  windows?.dispose();
});

app.on('will-quit', () => {
  shortcuts?.unregisterAll();
});

/**
 * Failure reporting.
 *
 * Every fatal path writes to the startup log before exiting, so a launch that
 * never shows a window still leaves evidence in %APPDATA%\Pixel.
 */
process.on('uncaughtException', (error) => {
  boot.error(`Uncaught exception: ${describeError(error)}`);
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  boot.error(`Unhandled rejection: ${describeError(reason)}`);
});

app.on('render-process-gone', (_event, _contents, details) => {
  boot.error(
    `Renderer process gone: reason=${details.reason} exitCode=${String(details.exitCode)}`,
  );
});

app.on('child-process-gone', (_event, details) => {
  boot.error(
    `Child process gone: type=${details.type} reason=${details.reason} exitCode=${String(details.exitCode)}`,
  );
});


export { rendererDir, mainDir };
