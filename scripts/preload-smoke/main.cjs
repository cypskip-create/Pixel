const { app, BrowserWindow, ipcMain } = require('electron');
const { join, resolve } = require('node:path');
const { writeFileSync } = require('node:fs');

process.stdout.write('[preload-smoke] Electron main entry loaded\n');
const projectRoot = resolve(__dirname, '../..');
const { CHANNELS } = require(join(projectRoot, 'dist/main/shared/channels.js'));
const resultPath = process.env.CYPS_PRELOAD_SMOKE_RESULT;
const eventChannels = new Set([
  CHANNELS.chatStream,
  CHANNELS.systemEmergencyStopEvent,
  CHANNELS.permissionsRequest,
  CHANNELS.tasksUpdate,
  CHANNELS.modeChanged,
]);
let completed = false;

function finish(report, exitCode) {
  if (completed) return;
  completed = true;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (resultPath) writeFileSync(resultPath, serialized, 'utf8');
  process.stdout.write(serialized);
  app.exit(exitCode);
}

for (const channel of Object.values(CHANNELS)) {
  if (eventChannels.has(channel)) continue;
  ipcMain.handle(channel, (event, ...args) => {
    const response = { marker: 'pixel-preload-sandbox-smoke', channel, argumentCount: args.length };
    if (channel === CHANNELS.tasksList) {
      setTimeout(() => event.sender.send(CHANNELS.tasksUpdate, { id: 'smoke-task-1', state: 'running' }), 0);
    }
    if (channel === CHANNELS.permissionsListActiveGrants) {
      setTimeout(() => event.sender.send(CHANNELS.permissionsRequest, { id: 'smoke-permission-1', operation: 'read' }), 0);
    }
    if (channel === CHANNELS.appGetVersion) {
      setTimeout(() => event.sender.send(CHANNELS.modeChanged, 'agent'), 0);
    }
    return response;
  });
}

app.whenReady().then(async () => {
  process.stdout.write('[preload-smoke] app ready; creating sandboxed BrowserWindow\n');
  const preload = join(projectRoot, 'dist/main/preload/index.js');
  const win = new BrowserWindow({
    width: 420,
    height: 240,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.webContents.on('preload-error', (_event, failedPath, error) => {
    finish({ ok: false, stage: 'preload', failedPath, error: error.stack ?? error.message }, 1);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    process.stderr.write(`[preload-smoke] renderer process gone: ${JSON.stringify(details)}\n`);
  });
  win.webContents.once('did-finish-load', async () => {
    process.stdout.write('[preload-smoke] renderer loaded; checking bridge and IPC\n');
    try {
      const report = await win.webContents.executeJavaScript(`(async () => {
        const assert = (condition, message) => {
          if (!condition) throw new Error(message);
        };
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const cyps = window.cyps;
        const shell = window.cypsShell;
        assert(cyps && typeof cyps.settings.get === 'function', 'window.cyps.settings.get is unavailable');
        assert(cyps.tasks && typeof cyps.tasks.onUpdate === 'function', 'task subscription is unavailable');
        assert(cyps.permissions && typeof cyps.permissions.respond === 'function', 'permission bridge is unavailable');
        assert(shell && typeof shell.voiceCapability === 'function', 'window.cypsShell is unavailable');
        assert(typeof window.require === 'undefined', 'Node require leaked into the page');
        assert(typeof window.process === 'undefined', 'Node process leaked into the page');
        assert(typeof window.ipcRenderer === 'undefined', 'ipcRenderer leaked into the page');

        const calls = [];
        const settings = await cyps.settings.get();
        calls.push(settings.channel);
        assert(settings.channel === 'settings:get', 'settings.get reached the wrong IPC channel');
        const keyResult = await cyps.settings.setApiKey('test-only-placeholder');
        calls.push(keyResult.channel);
        assert(keyResult.channel === 'settings:setApiKey', 'settings.setApiKey reached the wrong IPC channel');

        let taskUpdates = [];
        let resolveTaskUpdate;
        const taskUpdate = new Promise((resolve) => { resolveTaskUpdate = resolve; });
        const unsubscribeTask = cyps.tasks.onUpdate((payload) => {
          taskUpdates.push(payload);
          resolveTaskUpdate(payload);
        });
        const tasksResult = await cyps.tasks.list();
        calls.push(tasksResult.channel);
        const taskPayload = await Promise.race([taskUpdate, delay(1500).then(() => null)]);
        assert(taskPayload?.id === 'smoke-task-1', 'task update subscription did not receive its payload');
        assert(!Object.prototype.hasOwnProperty.call(taskPayload, 'sender'), 'IPC event details leaked to the page');
        unsubscribeTask();
        unsubscribeTask();
        await cyps.tasks.list();
        await delay(40);
        assert(taskUpdates.length === 1, 'task unsubscribe was not idempotent or left a listener active');

        let permissionRequest;
        const permissionPayload = new Promise((resolve) => {
          const unsubscribe = cyps.permissions.onRequest((payload) => {
            permissionRequest = payload;
            unsubscribe();
            resolve(payload);
          });
        });
        const grants = await cyps.permissions.listActiveGrants();
        calls.push(grants.channel);
        assert((await Promise.race([permissionPayload, delay(1500).then(() => null)]))?.id === 'smoke-permission-1',
          'permission request subscription did not receive its payload');
        const decision = await cyps.permissions.respond({ requestId: 'smoke-permission-1', choice: 'deny' });
        calls.push(decision.channel);
        assert(decision.channel === 'permissions:respond', 'permission response reached the wrong IPC channel');
        const revoked = await cyps.permissions.revokeAll();
        calls.push(revoked.channel);
        assert(revoked.channel === 'permissions:revokeAll', 'permission revoke reached the wrong IPC channel');

        let changedMode;
        const modePromise = new Promise((resolve) => {
          const unsubscribe = shell.onModeChanged((mode) => {
            changedMode = mode;
            unsubscribe();
            resolve(mode);
          });
        });
        const version = await cyps.app.getVersion();
        calls.push(version.channel);
        assert((await Promise.race([modePromise, delay(1500).then(() => null)])) === 'agent',
          'cypsShell mode event subscription failed');
        const voice = await shell.voiceCapability();
        calls.push(voice.channel);
        assert(voice.channel === 'voice:capability', 'voice capability reached the wrong IPC channel');
        assert(changedMode === 'agent', 'shell event payload did not survive the bridge');

        return {
          ok: true,
          sandboxedBridge: true,
          noRawNodeOrIpc: true,
          exposedGlobals: ['cyps', 'cypsShell'],
          calls,
          taskSubscription: taskPayload,
          permissionSubscription: permissionRequest,
          shellModeSubscription: changedMode,
        };
      })()`);
      finish(report, report?.ok ? 0 : 1);
    } catch (error) {
      finish({ ok: false, stage: 'renderer-bridge', error: error.stack ?? error.message }, 1);
    }
  });

  await win.loadFile(join(__dirname, 'index.html'));
}).catch((error) => finish({ ok: false, stage: 'electron-startup', error: error.stack ?? error.message }, 1));

setTimeout(() => finish({ ok: false, stage: 'timeout', error: 'Sandbox smoke test did not finish within 30 seconds.' }, 1), 30_000).unref();
