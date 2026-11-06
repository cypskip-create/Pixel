/**
 * Cyps application entry point.
 *
 * Assembly only: creates the settings store, the floating window, the tray, the
 * global shortcuts and the IPC surface, then keeps them in sync. Platform
 * concerns (single instance, startup, clean quit) also live here.
 */

import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { CHANNELS } from '../shared/channels';
import { registerIpcHandlers } from './ipc';
import { RuntimeProvider } from './providers/runtime';
import { ScreenCapture } from './screen';
import { SettingsStore } from './settings';
import { ShortcutManager } from './shortcuts';
import { TrayController } from './tray';
import { WindowManager } from './window';

/** Set by `npm run dev:electron`. */
const DEV_SERVER_URL = process.env.CYPS_DEV_SERVER_URL ?? null;

/** Globally, only one Cyps may run: two floating orbs would fight over the tray. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Windows uses this to group and identify the app correctly in the taskbar and
// notification area, including in development.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.cyps.companion');
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

async function bootstrap(): Promise<void> {
  // Transparent, always-on-top windows rely on per-pixel alpha being composited
  // by the desktop window manager rather than the GPU path.
  app.commandLine.appendSwitch('enable-transparent-visuals');
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  }

  await app.whenReady();

  // No application menu: Cyps is not a document application and a menu bar in a
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

  // The tray may fail on some desktop configurations; Cyps still runs.
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

  windows.createMainWindow();

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
  // Cyps is a tray-resident companion: closing the window hides it rather than
  // ending the process. Quitting goes through the tray or the app.
  if (quitting) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  shortcuts?.unregisterAll();
  tray?.destroy();
});

app.on('will-quit', () => {
  shortcuts?.unregisterAll();
});

void bootstrap().catch((error: unknown) => {
  // A failed boot is fatal and must be visible rather than a silent no-op.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Cyps failed to start: ${message}`);
  app.exit(1);
});

export { rendererDir, mainDir };
