/**
 * Pixel application entry point.
 *
 * Assembly only: creates the settings store, the floating window, the tray, the
 * global shortcuts and the IPC surface, then keeps them in sync. Platform
 * concerns (single instance, startup, clean quit) also live here.
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
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

function createWindowManager(store: SettingsStore): WindowManager {
  const manager = new WindowManager(store.get().companion.position, {
    preloadPath: preloadPath(),
    devServerUrl: DEV_SERVER_URL,
    rendererIndexPath: join(rendererDir(), 'index.html'),
    onPositionChange: (position) => {
      // Persist quietly; a failure here must not interrupt dragging.
      try {
        store.set({ companion: { position } });
      } catch {
        // ignore
      }
    },
    onVisibilityChange: (visible) => {
      tray?.rebuild();
      void visible;
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

  // Transparent, always-on-top windows rely on per-pixel alpha being composited
  // by the desktop window manager rather than the GPU path.
  app.commandLine.appendSwitch('enable-transparent-visuals');
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  }

  boot.stage('waiting for electron ready');
  await app.whenReady();
  boot.stage('electron ready');

  // No application menu: Pixel is not a document application and a menu bar in a
  // floating window would be visual noise.
  Menu.setApplicationMenu(null);

  settings = new SettingsStore(app.getPath('userData'));
  const store = settings;

  windows = createWindowManager(store);

  // Capture is authorized per explicit UI action only.
  let captureAuthorized = false;
  const captures = new ScreenCapture({ isAuthorized: () => captureAuthorized });
  void captureAuthorized;

  const provider = new RuntimeProvider(() => store.getApiKey());

  const controller = registerIpcHandlers({
    settings: store,
    windows,
    provider,
    captures: {
      isAuthorized: () => captureAuthorized,
      listDisplays: () => captures.listDisplays(),
      captureActiveWindow: async () => {
        captureAuthorized = true;
        try {
          return await captures.captureActiveWindow();
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
      const win = windows?.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      const settingsWin = windows?.getSettingsWindow();
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send(channel, payload);
      }
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });

  // The tray may fail on some desktop configurations; Pixel still runs.
  tray = new TrayController({
    onToggle: () => windows?.toggle(),
    onSetMode: (mode) => {
      const next = store.set({ companion: { mode } });
      void next;
      tray?.rebuild();
      const win = windows?.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(CHANNELS.modeChanged, mode);
      }
    },
    onOpenSettings: () => windows?.createSettingsWindow(),
    onEmergencyStop: () => {
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
    onEmergencyStop: () => {
      controller.emergency.trigger();
    },
  });
  shortcuts.apply(store.get());

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
      boot.warn('ready-to-show did not fire within 8s; showing the window anyway.');
      mainWindow.showInactive();
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

  // Open external links in the user's browser, never inside the app window.
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows?.show();
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
  shortcuts?.unregisterAll();
  tray?.destroy();
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
