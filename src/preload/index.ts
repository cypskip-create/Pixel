/**
 * The preload bridge.
 *
 * This is the ONLY place where the renderer is granted access to native
 * capability. It exposes a narrow, typed facade on `window.cyps` and nothing
 * else: no `ipcRenderer`, no Node globals, no raw event objects.
 *
 * Keeping this surface narrow is what makes the renderer portable: the React
 * code calls `window.cyps.*` and never touches an Electron API, so the shell can
 * later be replaced by Tauri without rewriting the UI.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  Mode,
  AuditEntry,
  CaptureResult,
  ChatMessage,
  ChatRequest,
  ConnectionTestResult,
  CypsBridge,
  DeepSeekSettingsPatch,
  DiagnosticsSnapshot,
  EmergencyStopReport,
  PermissionDecision,
  PermissionGrant,
  PermissionRequest,
  StreamEvent,
  Surface,
  TaskRecord,
} from '../shared/types';

export { CHANNELS } from '../shared/channels';
import { CHANNELS as CH } from '../shared/channels';

/**
 * Wrap a subscription so the renderer never sees an IpcRendererEvent (which
 * carries `sender`, a door back into the main process). Returns an unsubscribe
 * function that is idempotent.
 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  let active = true;
  const listener = (_event: unknown, payload: T): void => {
    if (active) handler(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: CypsBridge = {
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet) as Promise<AppSettings>,
    set: (patch: DeepSeekSettingsPatch) =>
      ipcRenderer.invoke(CH.settingsSet, patch) as Promise<AppSettings>,
    setApiKey: (key: string) =>
      ipcRenderer.invoke(CH.settingsSetApiKey, key) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    hasApiKey: () => ipcRenderer.invoke(CH.settingsHasApiKey) as Promise<boolean>,
    clearApiKey: () => ipcRenderer.invoke(CH.settingsClearApiKey) as Promise<void>,
    testConnection: (model?: string) =>
      ipcRenderer.invoke(CH.settingsTestConnection, model) as Promise<ConnectionTestResult>,
  },

  window: {
    setSurface: (surface: Surface) =>
      ipcRenderer.invoke(CH.windowSetSurface, surface) as Promise<void>,
    setExpanded: (expanded: boolean) =>
      ipcRenderer.invoke(CH.windowSetExpanded, expanded) as Promise<void>,
    setPosition: (x: number, y: number) =>
      ipcRenderer.invoke(CH.windowSetPosition, x, y) as Promise<void>,
    getPosition: () =>
      ipcRenderer.invoke(CH.windowGetPosition) as Promise<{ x: number; y: number }>,
    getWorkArea: () =>
      ipcRenderer.invoke(CH.windowGetWorkArea) as Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
        scaleFactor: number;
      }>,
    hide: () => ipcRenderer.invoke(CH.windowHide) as Promise<void>,
    show: () => ipcRenderer.invoke(CH.windowShow) as Promise<void>,
    openSettings: () => ipcRenderer.invoke(CH.windowOpenSettings) as Promise<void>,
    closeSettings: () => ipcRenderer.invoke(CH.windowCloseSettings) as Promise<void>,
    setIgnoreMouseEvents: (ignore: boolean) =>
      ipcRenderer.invoke(CH.windowSetIgnoreMouseEvents, ignore) as Promise<void>,
  },

  chat: {
    send: (request: ChatRequest) =>
      ipcRenderer.invoke(CH.chatSend, request) as Promise<{ requestId: string }>,
    cancel: (requestId: string) =>
      ipcRenderer.invoke(CH.chatCancel, requestId) as Promise<void>,
    onStream: (handler: (event: StreamEvent) => void) => subscribe(CH.chatStream, handler),
  },

  history: {
    list: (limit?: number) =>
      ipcRenderer.invoke(CH.historyList, limit) as Promise<ChatMessage[]>,
    clear: () => ipcRenderer.invoke(CH.historyClear) as Promise<void>,
  },

  screen: {
    listDisplays: () =>
      ipcRenderer.invoke(CH.screenListDisplays) as Promise<
        DiagnosticsSnapshot['displays']
      >,
    captureActiveWindow: () =>
      ipcRenderer.invoke(CH.screenCaptureActiveWindow) as Promise<CaptureResult>,
    captureDisplay: (displayId?: string) =>
      ipcRenderer.invoke(CH.screenCaptureDisplay, displayId) as Promise<CaptureResult>,
    captureRegion: (region: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(CH.screenCaptureRegion, region) as Promise<CaptureResult>,
  },

  system: {
    diagnostics: () =>
      ipcRenderer.invoke(CH.systemDiagnostics) as Promise<DiagnosticsSnapshot>,
    emergencyStop: () =>
      ipcRenderer.invoke(CH.systemEmergencyStop) as Promise<EmergencyStopReport>,
    onEmergencyStop: (handler: (report: EmergencyStopReport) => void) =>
      subscribe(CH.systemEmergencyStopEvent, handler),
  },

  permissions: {
    onRequest: (handler: (request: PermissionRequest) => void) =>
      subscribe(CH.permissionsRequest, handler),
    respond: (decision: PermissionDecision) =>
      ipcRenderer.invoke(CH.permissionsRespond, decision) as Promise<void>,
    listActiveGrants: () =>
      ipcRenderer.invoke(CH.permissionsListActiveGrants) as Promise<PermissionGrant[]>,
    revokeAll: () => ipcRenderer.invoke(CH.permissionsRevokeAll) as Promise<number>,
  },

  tasks: {
    onUpdate: (handler: (task: TaskRecord) => void) => subscribe(CH.tasksUpdate, handler),
    pause: (taskId: string) => ipcRenderer.invoke(CH.tasksPause, taskId) as Promise<void>,
    resume: (taskId: string) => ipcRenderer.invoke(CH.tasksResume, taskId) as Promise<void>,
    cancel: (taskId: string) => ipcRenderer.invoke(CH.tasksCancel, taskId) as Promise<void>,
  },

  audit: {
    list: (limit?: number) => ipcRenderer.invoke(CH.auditList, limit) as Promise<AuditEntry[]>,
  },

  app: {
    getVersion: () => ipcRenderer.invoke(CH.appGetVersion) as Promise<string>,
    quit: () => ipcRenderer.invoke(CH.appQuit) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('cyps', bridge);

/**
 * A second, deliberately tiny surface for shell-originated events that are not
 * part of the CypsBridge data contract (currently just the tray changing mode).
 * Kept separate so CypsBridge stays exactly as specified.
 */
const shell = {
  onModeChanged: (handler: (mode: Mode) => void): (() => void) =>
    subscribe(CH.modeChanged, handler),
};

contextBridge.exposeInMainWorld('cypsShell', shell);
