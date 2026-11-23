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
  AssistantState,
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
  MemoryRevisionView,
  PixelMemoryKind,
  ProjectView,
  ProductivityNoteView,
  ProductivityDocumentLinkView,
  ProductivityTaskView,
  ProductivityChecklistView,
  DocumentLibraryItem,
  DocumentLibraryIndexResult,
  DocumentLibraryOpenResult,
  DocumentLibraryRead,
  PluginView,
  WorkspaceWindowState,
  ToolCatalogEntry,
  ScreenWindowTarget,
  VisualGuidanceSnapshot,
  VoiceModelInfo,
  VoiceModelProgress,
} from '../shared/types';
import type { BoardOperation, BoardSnapshot, PixelBoardDocument } from '../shared/drawingBoard';

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
    setCursorAssistantState: (state: AssistantState) =>
      ipcRenderer.invoke(CH.windowSetCursorState, state) as Promise<void>,
    cursorRendererReady: () => ipcRenderer.invoke(CH.windowCursorRendererReady) as Promise<void>,
    getCursorSettings: () => ipcRenderer.invoke(CH.windowCursorSettingsGet) as Promise<{ reducedMotion: boolean }>,
    onCursorAssistantState: (handler: (state: AssistantState) => void) =>
      subscribe(CH.windowCursorState, handler),
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

  board: {
    getState: () => ipcRenderer.invoke(CH.boardGetState) as Promise<BoardSnapshot>,
    apply: (operations: BoardOperation[], expectedRevision?: number) =>
      ipcRenderer.invoke(CH.boardApply, operations, expectedRevision) as Promise<BoardSnapshot>,
    create: (title: string, replace = false, expectedRevision?: number) =>
      ipcRenderer.invoke(CH.boardCreate, title, replace, expectedRevision) as Promise<BoardSnapshot>,
    importLegacyDraft: (document: PixelBoardDocument) =>
      ipcRenderer.invoke(CH.boardImportLegacyDraft, document) as Promise<BoardSnapshot>,
    undo: (expectedRevision?: number) => ipcRenderer.invoke(CH.boardUndo, expectedRevision) as Promise<BoardSnapshot>,
    redo: (expectedRevision?: number) => ipcRenderer.invoke(CH.boardRedo, expectedRevision) as Promise<BoardSnapshot>,
    open: () => ipcRenderer.invoke(CH.boardOpen) as Promise<{ ok: boolean; cancelled?: boolean; snapshot?: BoardSnapshot; error?: string }>,
    save: (format: 'pixelboard' | 'svg') => ipcRenderer.invoke(CH.boardSave, format) as Promise<{ ok: boolean; cancelled?: boolean; path?: string; bytes?: number; error?: string }>,
    onChanged: (handler: (snapshot: BoardSnapshot) => void) => subscribe(CH.boardChanged, handler),
    onFocusRequested: (handler: (payload: undefined) => void) => subscribe<undefined>(CH.boardFocusRequested, handler),
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
    revokeGrant: (grantId: string) => ipcRenderer.invoke(CH.permissionsRevokeGrant, grantId) as Promise<boolean>,
    clearExpired: () => ipcRenderer.invoke(CH.permissionsClearExpired) as Promise<number>,
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
    run: (skillId: string, inputs: Record<string, string>) => ipcRenderer.invoke(CH.skillsRun, skillId, inputs) as Promise<TaskRecord>,
    createDraft: (draft: SkillDraftRequest) =>
      ipcRenderer.invoke(CH.skillsCreateDraft, draft) as Promise<SkillRecord>,
    recordTask: (taskId: string) => ipcRenderer.invoke(CH.skillsRecordTask, taskId) as Promise<SkillRecord>,
    activate: (skillId: string) => ipcRenderer.invoke(CH.skillsActivate, skillId) as Promise<SkillRecord>,
    delete: (skillId: string) => ipcRenderer.invoke(CH.skillsDelete, skillId) as Promise<boolean>,
  },

  routines: {
    list: () => ipcRenderer.invoke(CH.routinesList) as Promise<RoutineRecord[]>,
    create: (input: { skillId: string; name: string; localTime: string; timezone: string; inputValues: Record<string, string> }) =>
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
    history: (id: string) => ipcRenderer.invoke(CH.memoryHistory, id) as Promise<MemoryRevisionView[]>,
    export: () => ipcRenderer.invoke(CH.memoryExport) as Promise<MemoryExportView>,
  },

  productivity: {
    listNotes: () => ipcRenderer.invoke(CH.productivityNotesList) as Promise<ProductivityNoteView[]>,
    createNote: (title: string, body: string) => ipcRenderer.invoke(CH.productivityNotesCreate, title, body) as Promise<ProductivityNoteView>,
    updateNote: (id: string, patch: { title?: string; body?: string }) => ipcRenderer.invoke(CH.productivityNotesUpdate, id, patch) as Promise<ProductivityNoteView | null>,
    deleteNote: (id: string) => ipcRenderer.invoke(CH.productivityNotesDelete, id) as Promise<boolean>,
    importMarkdown: () => ipcRenderer.invoke(CH.productivityNotesImportMarkdown) as Promise<ProductivityNoteView | null>,
    exportMarkdown: (id: string) => ipcRenderer.invoke(CH.productivityNotesExportMarkdown, id) as Promise<{ ok: boolean; cancelled?: boolean; verified?: boolean }>,
    listNoteDocuments: (noteId: string) => ipcRenderer.invoke(CH.productivityNoteDocumentsList, noteId) as Promise<ProductivityDocumentLinkView[]>,
    linkNoteDocument: (noteId: string) => ipcRenderer.invoke(CH.productivityNoteDocumentsLink, noteId) as Promise<ProductivityDocumentLinkView | null>,
    openNoteDocument: (noteId: string, linkId: string) => ipcRenderer.invoke(CH.productivityNoteDocumentsOpen, noteId, linkId) as Promise<{ ok: boolean }>,
    unlinkNoteDocument: (noteId: string, linkId: string) => ipcRenderer.invoke(CH.productivityNoteDocumentsUnlink, noteId, linkId) as Promise<boolean>,
    listChecklists: () => ipcRenderer.invoke(CH.productivityChecklistsList) as Promise<ProductivityChecklistView[]>,
    createChecklist: (title: string) => ipcRenderer.invoke(CH.productivityChecklistsCreate, title) as Promise<ProductivityChecklistView>,
    listTasks: () => ipcRenderer.invoke(CH.productivityTasksList) as Promise<ProductivityTaskView[]>,
    createTask: (title: string, description?: string, dueAt?: string, checklistId?: string) => ipcRenderer.invoke(CH.productivityTasksCreate, title, description, dueAt, checklistId) as Promise<ProductivityTaskView>,
    updateTask: (id: string, patch: { title?: string; description?: string; status?: ProductivityTaskView['status']; dueAt?: string | null; checklistId?: string | null }) => ipcRenderer.invoke(CH.productivityTasksUpdate, id, patch) as Promise<ProductivityTaskView | null>,
  },

  documents: {
    listLibrary: () => ipcRenderer.invoke(CH.documentsLibraryList) as Promise<DocumentLibraryItem[]>,
    readLibraryDocument: (documentId: string, startChunk = 0) =>
      ipcRenderer.invoke(CH.documentsLibraryRead, documentId, startChunk) as Promise<DocumentLibraryRead | null>,
    openLibraryDocument: (documentId: string) =>
      ipcRenderer.invoke(CH.documentsLibraryOpen, documentId) as Promise<DocumentLibraryOpenResult>,
    openLibraryFolder: (folderId: string) =>
      ipcRenderer.invoke(CH.documentsLibraryOpenFolder, folderId) as Promise<DocumentLibraryOpenResult>,
    indexLibraryFolder: () => ipcRenderer.invoke(CH.documentsLibraryIndex) as Promise<DocumentLibraryIndexResult>,
  },

  audit: {
    list: (limit?: number) => ipcRenderer.invoke(CH.auditList, limit) as Promise<AuditEntry[]>,
  },

  tools: {
    list: () => ipcRenderer.invoke(CH.toolsList) as Promise<ToolCatalogEntry[]>,
  },

  plugins: {
    list: () => ipcRenderer.invoke(CH.pluginsList) as Promise<PluginView[]>,
    install: (pluginId: string) => ipcRenderer.invoke(CH.pluginsInstall, pluginId) as Promise<PluginView[]>,
    update: (pluginId: string) => ipcRenderer.invoke(CH.pluginsUpdate, pluginId) as Promise<PluginView[]>,
    uninstall: (pluginId: string) => ipcRenderer.invoke(CH.pluginsUninstall, pluginId) as Promise<PluginView[]>,
    setEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke(CH.pluginsSetEnabled, pluginId, enabled) as Promise<PluginView[]>,
    setProjectAvailability: (pluginId: string, availability: 'inherit' | 'enabled' | 'disabled') =>
      ipcRenderer.invoke(CH.pluginsSetProjectAvailability, pluginId, availability) as Promise<PluginView[]>,
    setSetting: (pluginId: string, key: string, value: string) =>
      ipcRenderer.invoke(CH.pluginsSetSetting, pluginId, key, value) as Promise<PluginView[]>,
    githubStatus: () =>
      ipcRenderer.invoke(CH.pluginsGitHubStatus) as Promise<import('../shared/types').GitHubConnectionStatus>,
    githubConnect: (token: string) =>
      ipcRenderer.invoke(CH.pluginsGitHubConnect, token) as Promise<import('../shared/types').GitHubConnectionStatus>,
    githubDisconnect: () =>
      ipcRenderer.invoke(CH.pluginsGitHubDisconnect) as Promise<import('../shared/types').GitHubConnectionStatus>,
    googleCalendarStatus: () =>
      ipcRenderer.invoke(CH.googleCalendarStatus) as Promise<import('../shared/types').GoogleCalendarConnectionStatus>,
    googleCalendarDisconnect: () =>
      ipcRenderer.invoke(CH.googleCalendarDisconnect) as Promise<import('../shared/types').GoogleCalendarConnectionStatus>,
  },

  mcp: {
    list: () => ipcRenderer.invoke(CH.mcpServersList) as Promise<import('../shared/types').McpServerSummaryView[]>,
    add: (input: { id: string; name: string; transport: 'stdio' | 'http'; command?: string[]; url?: string; allowedProjects?: string[] }) =>
      ipcRenderer.invoke(CH.mcpServersAdd, input) as Promise<import('../shared/types').McpServerSummaryView>,
    enable: (id: string) => ipcRenderer.invoke(CH.mcpServersEnable, id) as Promise<import('../shared/types').McpServerSummaryView>,
    disable: (id: string) => ipcRenderer.invoke(CH.mcpServersDisable, id) as Promise<import('../shared/types').McpServerSummaryView>,
    setProjects: (id: string, allowedProjects: string[]) =>
      ipcRenderer.invoke(CH.mcpServersSetProjects, id, allowedProjects) as Promise<import('../shared/types').McpServerSummaryView>,
    remove: (id: string) => ipcRenderer.invoke(CH.mcpServersRemove, id) as Promise<boolean>,
  },

  proceduralSkills: {
    list: () => ipcRenderer.invoke(CH.proceduralSkillsList) as Promise<import('../shared/types').ProceduralSkillView[]>,
    createDraft: (markdown: string) =>
      ipcRenderer.invoke(CH.proceduralSkillsCreateDraft, markdown) as Promise<import('../shared/types').ProceduralSkillView>,
    activate: (id: string) =>
      ipcRenderer.invoke(CH.proceduralSkillsActivate, id) as Promise<import('../shared/types').ProceduralSkillView>,
    disable: (id: string) =>
      ipcRenderer.invoke(CH.proceduralSkillsDisable, id) as Promise<import('../shared/types').ProceduralSkillView>,
    setPinned: (id: string, pinned: boolean) =>
      ipcRenderer.invoke(CH.proceduralSkillsSetPinned, id, pinned) as Promise<import('../shared/types').ProceduralSkillView>,
    delete: (id: string) => ipcRenderer.invoke(CH.proceduralSkillsDelete, id) as Promise<boolean>,
  },

  terminal: {
    run: (command: string, cwd?: string) => ipcRenderer.invoke(CH.terminalRun, command, cwd),
    cancel: (sessionId: string) => ipcRenderer.invoke(CH.terminalCancel, sessionId) as Promise<boolean>,
    list: () => ipcRenderer.invoke(CH.terminalList),
    onOutput: (handler: (event: { sessionId: string; stream: 'stdout' | 'stderr'; chunk: string }) => void) =>
      subscribe(CH.terminalOutput, handler),
    onExit: (handler: (event: { sessionId: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; exitCode: number | null }) => void) =>
      subscribe(CH.terminalExit, handler),
  },

  workspaceFs: {
    listDir: (relativePath?: string) => ipcRenderer.invoke(CH.workspaceFsListDir, relativePath),
    readFile: (relativePath: string) => ipcRenderer.invoke(CH.workspaceFsReadFile, relativePath),
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
  /** Actual local audio playback transitions, broadcast to Pixel windows. */
  onVoicePlaybackState: (handler: (speaking: boolean) => void): (() => void) =>
    subscribe(CH.voicePlaybackState, handler),
  voicePlaybackActive: () => ipcRenderer.invoke(CH.voicePlaybackGet) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('cypsShell', shell);
