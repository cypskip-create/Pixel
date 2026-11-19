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
  ChatRequest,
  ConversationRecordView,
  ConversationSummary,
  ConnectionTestResult,
  CypsBridge,
  DeepSeekSettingsPatch,
  DiagnosticsSnapshot,
  EmergencyStopReport,
  HistoryQuery,
  PermissionDecision,
  PermissionGrant,
  PermissionRequest,
  StreamEvent,
  Surface,
  TaskRecord,
  SkillRecord,
  SkillDraftRequest,
  RoutineRecord,
  RoutineRunRecord,
  MemoryRecordView,
  MemoryExportView,
  PixelMemoryKind,
  ProjectView,
  WorkspaceWindowState,
  ToolCatalogEntry,
  ScreenWindowTarget,
  VisualGuidanceSnapshot,
  VoiceModelInfo,
  VoiceModelProgress,
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
    onChanged: (handler: (settings: AppSettings) => void) => subscribe(CH.settingsChanged, handler),
    onApiKeyStatus: (handler: (configured: boolean) => void) => subscribe(CH.settingsApiKeyStatusChanged, handler),
  },

  window: {
    setSurface: (surface: Surface) =>
      ipcRenderer.invoke(CH.windowSetSurface, surface) as Promise<void>,
    setLayout: (surface: Surface, size: { width: number; height: number }) =>
      ipcRenderer.invoke(CH.windowSetLayout, surface, size) as Promise<void>,
    setExpanded: (expanded: boolean) =>
      ipcRenderer.invoke(CH.windowSetExpanded, expanded) as Promise<void>,
    hide: () => ipcRenderer.invoke(CH.windowHide) as Promise<void>,
    show: () => ipcRenderer.invoke(CH.windowShow) as Promise<void>,
    openSettings: () => ipcRenderer.invoke(CH.windowOpenSettings) as Promise<void>,
    closeSettings: () => ipcRenderer.invoke(CH.windowCloseSettings) as Promise<void>,
    openWorkspace: () => ipcRenderer.invoke(CH.workspaceOpen) as Promise<void>,
    closeWorkspace: () => ipcRenderer.invoke(CH.workspaceClose) as Promise<void>,
    minimizeWorkspace: () => ipcRenderer.invoke(CH.workspaceMinimize) as Promise<void>,
    toggleWorkspaceMaximize: () => ipcRenderer.invoke(CH.workspaceToggleMaximize) as Promise<boolean>,
    setWorkspaceFullscreen: (fullscreen: boolean) => ipcRenderer.invoke(CH.workspaceSetFullscreen, fullscreen) as Promise<void>,
    getWorkspaceState: () => ipcRenderer.invoke(CH.workspaceGetState) as Promise<WorkspaceWindowState>,
    onWorkspaceState: (handler: (state: WorkspaceWindowState) => void) => subscribe(CH.workspaceState, handler),
    setIgnoreMouseEvents: (ignore: boolean) =>
      ipcRenderer.invoke(CH.windowSetIgnoreMouseEvents, ignore) as Promise<void>,
    onFocusLost: (handler: () => void) => subscribe(CH.windowFocusLost, handler),
    onSummon: (handler: () => void) => subscribe(CH.windowSummon, handler),
    onCursorMotion: (handler: (reducedMotion: boolean) => void) =>
      subscribe(CH.windowCursorMotion, handler),
    onCursorPlacement: (handler: (orientation: { flipX: boolean; flipY: boolean }) => void) =>
      subscribe(CH.windowCursorPlacement, handler),
  },

  chat: {
    send: (request: ChatRequest) =>
      ipcRenderer.invoke(CH.chatSend, request) as Promise<{ requestId: string; persistence?: 'persistent' | 'session' }>,
    cancel: (requestId: string) =>
      ipcRenderer.invoke(CH.chatCancel, requestId) as Promise<void>,
    onStream: (handler: (event: StreamEvent) => void) => subscribe(CH.chatStream, handler),
  },

  history: {
    list: (query?: HistoryQuery) =>
      ipcRenderer.invoke(CH.historyList, query) as Promise<ConversationSummary[]>,
    open: (id: string) =>
      ipcRenderer.invoke(CH.historyOpen, id) as Promise<ConversationRecordView | null>,
    create: () => ipcRenderer.invoke(CH.historyCreate) as Promise<ConversationRecordView>,
    rename: (id: string, title: string) =>
      ipcRenderer.invoke(CH.historyRename, id, title) as Promise<ConversationSummary | null>,
    delete: (id: string) => ipcRenderer.invoke(CH.historyDelete, id) as Promise<boolean>,
    clear: () => ipcRenderer.invoke(CH.historyClear) as Promise<void>,
    getActive: () => ipcRenderer.invoke(CH.historyGetActive) as Promise<ConversationRecordView | null>,
    onActiveChanged: (handler: (record: ConversationRecordView | null) => void) => subscribe(CH.historyActiveChanged, handler),
  },

  browser: {
    openSearch: (query: string, requestText: string, conversationId: string) =>
      ipcRenderer.invoke(CH.browserOpenSearch, query, requestText, conversationId) as Promise<{ query: string; provider: import('../shared/types').SearchProvider }>,
  },

  screen: {
    listDisplays: () =>
      ipcRenderer.invoke(CH.screenListDisplays) as Promise<
        DiagnosticsSnapshot['displays']
      >,
    listExternalWindows: () =>
      ipcRenderer.invoke(CH.screenListExternalWindows) as Promise<{ windows: ScreenWindowTarget[]; truncated: boolean }>,
    captureActiveWindow: () =>
      ipcRenderer.invoke(CH.screenCaptureActiveWindow) as Promise<CaptureResult>,
    captureLastExternalWindow: () =>
      ipcRenderer.invoke(CH.screenCaptureLastExternalWindow) as Promise<CaptureResult>,
    captureSelectedWindow: (target: ScreenWindowTarget) =>
      ipcRenderer.invoke(CH.screenCaptureSelectedWindow, target) as Promise<CaptureResult>,
    captureDisplay: (displayId?: string) =>
      ipcRenderer.invoke(CH.screenCaptureDisplay, displayId) as Promise<CaptureResult>,
    captureRegion: (region: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(CH.screenCaptureRegion, region) as Promise<CaptureResult>,
    onGuidanceUpdate: (handler: (snapshot: VisualGuidanceSnapshot) => void) =>
      subscribe(CH.screenGuidanceUpdate, handler),
  },

  system: {
    diagnostics: () =>
      ipcRenderer.invoke(CH.systemDiagnostics) as Promise<DiagnosticsSnapshot>,
    isEmergencyStopped: () => ipcRenderer.invoke(CH.systemIsEmergencyStopped) as Promise<boolean>,
    emergencyStop: () =>
      ipcRenderer.invoke(CH.systemEmergencyStop) as Promise<EmergencyStopReport>,
    emergencyClear: () => ipcRenderer.invoke(CH.systemEmergencyClear) as Promise<void>,
    onEmergencyStop: (handler: (report: EmergencyStopReport) => void) =>
      subscribe(CH.systemEmergencyStopEvent, handler),
  },

  permissions: {
    onRequest: (handler: (request: PermissionRequest) => void) =>
      subscribe(CH.permissionsRequest, handler),
    listPending: () => ipcRenderer.invoke(CH.permissionsListPending) as Promise<PermissionRequest[]>,
    onResolved: (handler: (requestId: string) => void) => subscribe(CH.permissionsResolved, handler),
    respond: (decision: PermissionDecision) =>
      ipcRenderer.invoke(CH.permissionsRespond, decision) as Promise<void>,
    listActiveGrants: () =>
      ipcRenderer.invoke(CH.permissionsListActiveGrants) as Promise<PermissionGrant[]>,
    revokeAll: () => ipcRenderer.invoke(CH.permissionsRevokeAll) as Promise<number>,
  },

  tasks: {
    list: () => ipcRenderer.invoke(CH.tasksList) as Promise<TaskRecord[]>,
    onUpdate: (handler: (task: TaskRecord) => void) => subscribe(CH.tasksUpdate, handler),
    pause: (taskId: string) => ipcRenderer.invoke(CH.tasksPause, taskId) as Promise<void>,
    resume: (taskId: string) => ipcRenderer.invoke(CH.tasksResume, taskId) as Promise<void>,
    cancel: (taskId: string) => ipcRenderer.invoke(CH.tasksCancel, taskId) as Promise<void>,
    continueAfterHandoff: (taskId: string) => ipcRenderer.invoke(CH.tasksContinueAfterHandoff, taskId) as Promise<boolean>,
  },

  skills: {
    list: () => ipcRenderer.invoke(CH.skillsList) as Promise<SkillRecord[]>,
    createDraft: (draft: SkillDraftRequest) =>
      ipcRenderer.invoke(CH.skillsCreateDraft, draft) as Promise<SkillRecord>,
    activate: (skillId: string) => ipcRenderer.invoke(CH.skillsActivate, skillId) as Promise<SkillRecord>,
    delete: (skillId: string) => ipcRenderer.invoke(CH.skillsDelete, skillId) as Promise<boolean>,
  },

  routines: {
    list: () => ipcRenderer.invoke(CH.routinesList) as Promise<RoutineRecord[]>,
    create: (input: { skillId: string; name: string; localTime: string; timezone: string }) =>
      ipcRenderer.invoke(CH.routinesCreate, input) as Promise<RoutineRecord>,
    setEnabled: (routineId: string, enabled: boolean) =>
      ipcRenderer.invoke(CH.routinesSetEnabled, routineId, enabled) as Promise<boolean>,
    delete: (routineId: string) => ipcRenderer.invoke(CH.routinesDelete, routineId) as Promise<boolean>,
    history: (routineId: string, limit?: number) =>
      ipcRenderer.invoke(CH.routinesHistory, routineId, limit) as Promise<RoutineRunRecord[]>,
    cancel: (routineId: string) => ipcRenderer.invoke(CH.routinesCancel, routineId) as Promise<boolean>,
    retry: (routineId: string) => ipcRenderer.invoke(CH.routinesRetry, routineId) as Promise<boolean>,
  },

  memory: {
    list: () => ipcRenderer.invoke(CH.memoryList) as Promise<MemoryRecordView[]>,
    listProjects: () => ipcRenderer.invoke(CH.memoryProjectsList) as Promise<ProjectView[]>,
    setActiveProject: (name: string) => ipcRenderer.invoke(CH.memorySetActiveProject, name) as Promise<ProjectView>,
    onProjectChanged: (handler: (project: ProjectView) => void) => subscribe(CH.memoryProjectChanged, handler),
    update: (id: string, patch: { content?: string; kind?: PixelMemoryKind; tags?: string[] }) =>
      ipcRenderer.invoke(CH.memoryUpdate, id, patch) as Promise<MemoryRecordView>,
    delete: (id: string) => ipcRenderer.invoke(CH.memoryDelete, id) as Promise<boolean>,
    export: () => ipcRenderer.invoke(CH.memoryExport) as Promise<MemoryExportView>,
  },

  audit: {
    list: (limit?: number) => ipcRenderer.invoke(CH.auditList, limit) as Promise<AuditEntry[]>,
  },

  tools: {
    list: () => ipcRenderer.invoke(CH.toolsList) as Promise<ToolCatalogEntry[]>,
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

  getPushToTalkStatus: () =>
    ipcRenderer.invoke(CH.shortcutsGetStatus) as Promise<{
      accelerator: string;
      ok: boolean;
      reason?: string;
    } | null>,

  onPushToTalkState: (handler: (event: {
    state: 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting' | 'failed' | 'cancelled';
    error?: string;
    sessionId?: number;
  }) => void): (() => void) => subscribe(CH.voicePttState, handler),

  onPushToTalkStopCapture: (handler: (event: { sessionId: number; action: 'submit' | 'cancel' }) => void): (() => void) =>
    subscribe(CH.voicePttStopCapture, handler),

  voicePttCaptureReady: (sessionId: number, error?: string) =>
    ipcRenderer.invoke(CH.voicePttCaptureReady, sessionId, error) as Promise<boolean>,

  voicePttTranscribe: (sessionId: number, audio: Uint8Array) =>
    ipcRenderer.invoke(CH.voicePttTranscribe, sessionId, audio) as Promise<{ ok: boolean; error?: string }>,

  voiceTranscribeWav: (audio: Uint8Array) =>
    ipcRenderer.invoke(CH.voiceTranscribeWav, audio) as Promise<{
      ok: boolean;
      text: string;
      confidence?: number;
      error?: string;
      noSpeech?: boolean;
      backend?: string;
      model?: string;
      processingMs?: number;
      audioSeconds?: number;
    }>,

  /** Save only a short, user-approved diagnostic WAV through the native dialog. */
  voiceSaveDiagnosticWav: (audio: Uint8Array) => ipcRenderer.invoke(CH.voiceSaveDiagnosticWav, audio) as Promise<{
    ok: boolean; cancelled?: boolean; error?: string;
  }>,

  voiceModelsList: () => ipcRenderer.invoke(CH.voiceModelsList) as Promise<VoiceModelInfo[]>,
  voiceVoicesList: () => ipcRenderer.invoke(CH.voiceVoicesList) as Promise<string[]>,
  voiceModelDownload: (id: VoiceModelInfo['id']) =>
    ipcRenderer.invoke(CH.voiceModelDownload, id) as Promise<{ ok: boolean; error?: string }>,
  voiceModelCancelDownload: () => ipcRenderer.invoke(CH.voiceModelCancelDownload) as Promise<boolean>,
  voiceModelRemove: (id: VoiceModelInfo['id']) =>
    ipcRenderer.invoke(CH.voiceModelRemove, id) as Promise<{ ok: boolean; error?: string }>,
  onVoiceModelsProgress: (handler: (progress: VoiceModelProgress | null) => void): (() => void) =>
    subscribe(CH.voiceModelsProgress, handler),

  voiceCaptureAcquire: () => ipcRenderer.invoke(CH.voiceCaptureAcquire) as Promise<boolean>,
  voiceCaptureRelease: () => ipcRenderer.invoke(CH.voiceCaptureRelease) as Promise<boolean>,
  onVoiceCaptureCancel: (handler: () => void): (() => void) => subscribe(CH.voiceCaptureCancel, handler),

  /** The main companion routes this one-shot transcript through chat.send. */
  onPushToTalkSubmit: (handler: (request: { sessionId: number; text: string }) => void): (() => void) =>
    subscribe(CH.voicePttSubmit, handler),

  /** Windows speech capability. Reports honestly when speech is unavailable. */
  voiceCapability: () =>
    ipcRenderer.invoke(CH.voiceCapability) as Promise<{
      speechToText: boolean;
      textToSpeech: boolean;
      reason?: string;
    }>,

  /** Listen once. Resolves with the recognised text or a precise error. */
  voiceListen: (timeoutMs?: number) =>
    ipcRenderer.invoke(CH.voiceListen, timeoutMs) as Promise<{
      ok: boolean;
      text: string;
      confidence?: number;
      error?: string;
      noSpeech?: boolean;
    }>,
  voiceCancel: () => ipcRenderer.invoke(CH.voiceCancel) as Promise<number>,

  /** Speak text aloud with the installed Windows voice. */
  voiceSpeak: (text: string) =>
    ipcRenderer.invoke(CH.voiceSpeak, text) as Promise<{ ok: boolean; error?: string; backend?: string; generationMs?: number; playbackMs?: number; elapsedMs?: number }>,
};

contextBridge.exposeInMainWorld('cypsShell', shell);
