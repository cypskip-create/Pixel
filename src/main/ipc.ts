/**
 * IPC wiring.
 *
 * Every `ipcMain.handle` in Pixel is registered here, and every one of them
 * implements a method of the `CypsBridge` contract from src/shared/types.ts.
 * Keeping them in one file makes the trust boundary reviewable: anything not
 * registered here cannot be reached from the renderer.
 *
 * Security posture:
 *  - The renderer never receives the API key, file paths, or raw errors.
 *  - Screen capture is refused unless the user has just authorized it.
 *  - Emergency stop is enforced in the agent runtime, not in the UI.
 */

import { app, clipboard, dialog, ipcMain, screen, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import type {
  AppSettings,
  AssistantState,
  AuditEntry,
  CaptureResult,
  ChatMessage,
  ChatRequest,
  ConversationRecordView,
  ConversationSummary,
  ConnectionTestResult,
  DeepSeekSettingsPatch,
  DiagnosticsSnapshot,
  HistoryQuery,
  EmergencyStopReport,
  PermissionDecision,
  PermissionGrant,
  PermissionRequest,
  StreamEvent,
  Surface,
  SkillRecord,
  TaskRecord,
  SkillDraftRequest,
  RoutineRecord,
  RoutineRunRecord,
  MemoryRecordView,
  MemoryExportView,
  PixelMemoryKind,
  SearchProvider,
  ToolCatalogEntry,
  ScreenWindowTarget,
  ProductivityChecklistView,
  ProductivityDocumentLinkView,
  DocumentLibraryIndexResult,
  PluginView,
} from '../shared/types';
import type { BoardOperation, PixelBoardDocument } from '../shared/drawingBoard';
import { ASSISTANT_STATES, DEFAULT_THINKING } from '../shared/types';
import { CHANNELS } from '../shared/channels';
import { ConversationEngine } from './agent/conversation';
import { AgentExecutor } from './agent/executor';
import { PythonAgentRunner } from './agent/pythonRunner';
import { buildRoutineToolPlan, buildSkillToolPlan, normalizeSkillInputValues } from './skills/plan';
import { ToolExecutors } from './agent/executors';
import { PermissionGrantStore } from './agent/permissionStore';
import { BrowserSession, validateBrowserUploadFile } from './agent/browser';
import { JsonlAuditSink } from './agent/auditStore';
import { openDatabase } from './data/database';
import { boot } from './startup/boot';
import { SessionMemorySnapshotManager } from './memory/snapshot';
import { looksLikeCredential, MemoryStore } from './memory/store';
import { MemoryTools, MEMORY_TOOL_DEFINITIONS } from './memory/toolset';
import { extractAutomaticMemoryCandidates, extractAutomaticMemoryForgetSlot, hasVerifiedTaskOutcome } from './memory/autoExtract';
import { SessionSearchIndex, SessionSearchTools, SESSION_SEARCH_TOOL_DEFINITIONS } from './history/sessionSearch';
import { ProceduralSkillStore, ProceduralSkillTools, PROCEDURAL_SKILL_TOOL_DEFINITIONS } from './skills/procedural';
import { DocumentIndex } from './documents/indexer';
import { DocumentTools, DOCUMENT_TOOL_DEFINITIONS } from './documents/toolset';
import { FileTools, FILE_TOOL_DEFINITIONS } from './files/toolset';
import { GitTools, GIT_TOOL_DEFINITIONS } from './git/toolset';
import { PythonWorker } from './services/python-worker';
import { PythonAgentBridge } from './services/pythonAgentBridge';
import type { NativeHelper } from './services/nativeHelper';
import { VoiceService, validateDiagnosticVoiceWav } from './voice/voice';
import type { RecognitionResult } from './voice/voice';
import { VoiceModelManager } from './voice/models';
import type { VoiceModelInfo } from '../shared/types';
import { VISION_MODEL } from '../shared/types';
import {
  AuditLog,
  EmergencyController,
  PermissionBroker,
  TaskManager,
} from './agent/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from './agent/tools';
import { HistoryStore, MAX_CONVERSATIONS, deriveTitle } from './history/store';
import type { ConversationRecord } from './history/store';
import { recordConversationStreamEvent } from './history/stream';
import type { PendingConversationStream } from './history/stream';
import { SURFACE_SIZES } from '../shared/surfaces';
import { TaskStore } from './tasks/store';
import { ProductivityStore, SUPPORTED_PRODUCTIVITY_DOCUMENT_EXTENSIONS } from './productivity/store';
import type { ProductivityDocumentLink } from './productivity/store';
import { ProductivityTools, PRODUCTIVITY_TOOL_DEFINITIONS } from './productivity/toolset';
import { SkillStore } from './skills/store';
import { draftSkillFromTask } from './skills/recording';
import { LocalRoutineScheduler, RoutineStore } from './routines';
import type { ModelProvider } from './providers/deepseek';
import { SettingsStore } from './settings';
import { collectDiagnostics } from './system/diagnostics';
import { probeVolumeCapacity } from './system/probes';
import type { WindowManager } from './window';
import { redactTaskText } from './tasks/schema';
import { createSearchUrl, MAX_SEARCH_QUERY_LENGTH } from '../shared/browserSearch';
import { safeExternalHttpUrl } from '../shared/externalUrl';
import { claimPushToTalkEnd } from '../shared/companion/pushToTalkSession';
import { isCursorIpcChannelAllowed } from './windowPolicy';
import { PixelBoardService } from './board/service';
import type { BoardFileFormat } from './board/service';
import { BOARD_TOOL_DEFINITIONS } from './board/tools';
import { PluginStore } from './plugins/store';
import { verifyGitHubToken } from './plugins/github';
import { McpServerManager } from './plugins/mcpManager';
import { GoogleCalendarClient } from './plugins/googleCalendar';
import type { OAuthTokenRecord } from './plugins/oauth';
import type { GitHubConnectionStatus, GoogleCalendarConnectionStatus, McpServerSummaryView, ProceduralSkillView } from '../shared/types';

export interface IpcContext {
  settings: SettingsStore;
  windows: WindowManager;
  provider: ModelProvider;
  nativeHelper: NativeHelper;
  captures: {
    isAuthorized: () => boolean;
    listDisplays: () => DiagnosticsSnapshot['displays'];
    listExternalWindows: () => Promise<{ windows: ScreenWindowTarget[]; truncated: boolean }>;
    captureActiveWindow: () => Promise<CaptureResult>;
    captureLastExternalWindow: () => Promise<CaptureResult>;
    captureSelectedWindow: (target: ScreenWindowTarget) => Promise<CaptureResult>;
    captureDisplay: (displayId?: string) => Promise<CaptureResult>;
    captureRegion: (region: { x: number; y: number; width: number; height: number }) => Promise<CaptureResult>;
  };
  /** Request the UI's permission prompt surfaces. */
  sendToRenderer: (channel: string, payload: unknown) => void;
  /** PTT transcript is consumed by the one main companion renderer only. */
  sendToMainRenderer?: (channel: string, payload: unknown) => void;
  getShortcutStatus?: () => unknown;
  onSettingsChange?: (settings: AppSettings) => void;
  onQuit: () => void;
}

function toDocumentLinkView(link: ProductivityDocumentLink): ProductivityDocumentLinkView {
  return { id: link.id, noteId: link.noteId, displayName: link.displayName, byteSize: link.byteSize, createdAt: link.createdAt };
}

/** Filesystem-backed history storage inside the app's user data directory. */
class FileStorage {
  constructor(private readonly dir: string) {}

  read(key: string): string | null {
    try {
      return readFileSync(join(this.dir, `${key}.json`), 'utf8');
    } catch {
      return null;
    }
  }

  write(key: string, value: string): void {
    const path = join(this.dir, `${key}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, 'utf8');
  }
}

export async function registerIpcHandlers(context: IpcContext): Promise<{
  emergency: EmergencyController;
  tasks: TaskManager;
  routines: LocalRoutineScheduler;
  startPushToTalk: () => void;
  endPushToTalk: (reason: 'released' | 'timeout' | 'cancelled' | 'unavailable' | 'failed') => void;
  cancelVoiceCapture: () => void;
  shutdown: () => void;
}> {
  const { settings, windows, provider, captures, nativeHelper } = context;

  const registerHandler = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      const trustedApplication = windows.isTrustedApplicationSender(event.sender, event.senderFrame);
      const trustedCursorRequest = isCursorIpcChannelAllowed(channel) &&
        windows.isTrustedCursorApplicationSender(event.sender, event.senderFrame);
      if (!trustedApplication && !trustedCursorRequest) {
        throw new Error('This Pixel IPC request came from an untrusted renderer.');
      }
      return listener(event, ...args);
    });
  };

  const audit = new AuditLog(
    new JsonlAuditSink(join(app.getPath('userData'), 'audit', 'audit.jsonl')),
  );

  /* ---------------- Wave 3: memory and documents ---------------- */

  const database = openDatabase(join(app.getPath('userData'), 'pixel.db'));
  const memoryStore = new MemoryStore(database);
  const voiceModelManager = new VoiceModelManager(
    join(app.getPath('userData'), 'voice-models'),
    (progress) => context.sendToRenderer(CHANNELS.voiceModelsProgress, progress),
  );
  const pythonWorker = new PythonWorker({
    pythonPath: app.isPackaged ? undefined : join(app.getAppPath(), '.venv-voice-dev', 'Scripts', 'python.exe'),
    workerRoot: join(app.getAppPath(), 'python'),
    modelRoot: join(app.getPath('userData'), 'voice-models'),
    packagedWorkerPath: join(process.resourcesPath, 'voice-runtime', 'PixelVoiceWorker.exe'),
    requirePackagedWorker: app.isPackaged,
    onLog: (line) => boot.info(line),
  });
  const documentIndex = new DocumentIndex(database, pythonWorker);
  const projectId = (): string => memoryStore.getActiveProject();
  const history = new HistoryStore(new FileStorage(join(app.getPath('userData'), 'history')));
  const sessionConversations = new Map<string, ConversationRecord>();
  const streamConversations = new Map<string, PendingConversationStream>();
  let activeConversationId: string | null = history.list({ limit: 1, projectId: projectId() })[0]?.id ?? null;

  const trimSessionConversations = (): void => {
    const oldestFirst = [...sessionConversations.values()].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const record of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_CONVERSATIONS))) {
      sessionConversations.delete(record.id);
    }
  };

  const safeTranscriptMessage = (message: ChatMessage): ChatMessage => ({
    id: typeof message.id === 'string' && message.id.length <= 160 ? message.id : `msg_${Date.now().toString(36)}`,
    role: message.role,
    content: redactTaskText(String(message.content ?? '')).slice(0, 40_000),
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
    ...(message.aborted === true ? { aborted: true } : {}),
    ...(typeof message.error === 'string' ? { error: redactTaskText(message.error).slice(0, 1_000) } : {}),
  });

  const toRecordView = (record: ConversationRecord): ConversationRecordView => {
    const messages = record.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(safeTranscriptMessage);
    const latest = messages[messages.length - 1];
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      preview: latest ? latest.content.replace(/\s+/g, ' ').slice(0, 160) : '',
      ...(record.projectId ? { projectId: record.projectId } : {}),
      persistence: record.persistence ?? 'persistent',
      messages,
    };
  };

  const broadcastActiveConversation = (): void => {
    const record = activeConversationId ? getConversation(activeConversationId) : null;
    context.sendToRenderer(CHANNELS.historyActiveChanged, record ? toRecordView(record) : null);
  };

  const projectView = (id: string) => {
    const row = memoryStore.listProjects().find((project) => project.id === id);
    return row ? { ...row, active: row.id === projectId() } : null;
  };

  const toSessionSummary = (record: ConversationRecord): ConversationSummary => {
    const view = toRecordView(record);
    return {
      id: view.id,
      title: view.title,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      preview: view.preview,
      ...(view.projectId ? { projectId: view.projectId } : {}),
      persistence: view.persistence,
    };
  };

  const getConversation = (id: string): ConversationRecord | null => {
    const session = sessionConversations.get(id);
    if (session) return session;
    const stored = history.load(id);
    if (!stored) return null;
    stored.persistence = 'persistent';
    return stored;
  };

  const saveConversation = (record: ConversationRecord): void => {
    record.updatedAt = Date.now();
    if (record.persistence === 'session') {
      sessionConversations.set(record.id, record);
      trimSessionConversations();
      return;
    }
    try {
      history.save(record);
      record.persistence = 'persistent';
      sessionConversations.delete(record.id);
      try { sessionSearchIndex.indexConversation(record); } catch { /* search indexing never blocks chat persistence */ }
    } catch {
      record.persistence = 'session';
      sessionConversations.set(record.id, record);
      trimSessionConversations();
    }
  };

  const addTranscriptMessage = (
    record: ConversationRecord,
    message: ChatMessage,
  ): void => {
    const safe = safeTranscriptMessage(message);
    record.messages.push(safe);
    if (safe.role === 'user' && record.title === 'New conversation') {
      record.title = deriveTitle(safe.content);
    }
    saveConversation(record);
  };

  const newConversation = (): ConversationRecord => {
    const current = settings.get();
    const record: ConversationRecord = {
      ...HistoryStore.newConversation(''),
      projectId: projectId(),
      persistence: current.privacy.persistHistory ? 'persistent' : 'session',
    };
    sessionConversations.set(record.id, record);
    if (record.persistence === 'persistent') saveConversation(record);
    activeConversationId = record.id;
    broadcastActiveConversation();
    return record;
  };

  const emitChatEvent = (event: StreamEvent): void => {
    const conversationId = streamConversations.get(event.requestId)?.conversationId;
    if (event.type === 'tool_calls' && event.toolCalls.some((call) => call.name === 'clipboard_read')) {
      const record = conversationId ? getConversation(conversationId) : null;
      if (record) {
        // The model needs the clipboard value for this turn, but neither that
        // value nor a derived answer should become durable chat history.
        record.persistence = 'session';
        sessionConversations.set(record.id, record);
      }
    }
    recordConversationStreamEvent(streamConversations, event, getConversation, addTranscriptMessage);
    const coordinatedEvent = { ...event, ...(conversationId ? { conversationId } : {}) } as StreamEvent;
    if ((event.type === 'done' || event.type === 'aborted' || event.type === 'error') && conversationId) {
      const record = getConversation(conversationId);
      context.sendToRenderer(CHANNELS.chatStream, {
        ...coordinatedEvent,
        ...(record ? { persistence: record.persistence ?? 'persistent' } : {}),
      });
      if (activeConversationId === conversationId) broadcastActiveConversation();
      return;
    }
    context.sendToRenderer(CHANNELS.chatStream, coordinatedEvent);
  };

  const memoryTools = new MemoryTools(memoryStore, projectId);
  const documentTools = new DocumentTools(documentIndex, projectId, () => pythonWorker.availability());
  const productivityStore = new ProductivityStore(database);
  const productivityTools = new ProductivityTools(productivityStore, projectId);
  const fileTools = new FileTools();
  const gitTools = new GitTools();
  const boardService = new PixelBoardService(join(app.getPath('userData'), 'boards', 'active-board.json'));
  boardService.subscribe((snapshot) => {
    const workspace = windows.getWorkspaceWindow();
    if (workspace && !workspace.isDestroyed()) workspace.webContents.send(CHANNELS.boardChanged, snapshot);
  });

  const chooseBoardFile = async (
    action: 'open' | 'save',
    format: BoardFileFormat,
    title: string,
  ): Promise<{ path: string; overwrite?: boolean; replace?: boolean } | null> => {
    const parent = windows.getWorkspaceWindow();
    const extension = format === 'pixelboard' ? 'pixelboard' : 'svg';
    if (action === 'open') {
      const options = { title: 'Open Pixel Board', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Pixel Board', extensions: ['pixelboard'] }] };
      const result = parent && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      const current = boardService.getSnapshot().document;
      const hasCurrentWork = current.objects.length > 0 || current.title !== 'Untitled board';
      let replace = false;
      if (hasCurrentWork) {
        const message = { type: 'warning' as const, title: 'Replace the active Board?', message: 'The active Pixel Board will be replaced. Save it first if you need a separate copy.', buttons: ['Cancel', 'Open and replace'], defaultId: 0, cancelId: 0, noLink: true };
        const answer = parent && !parent.isDestroyed()
          ? await dialog.showMessageBox(parent, message)
          : await dialog.showMessageBox(message);
        if (answer.response !== 1) return null;
        replace = true;
      }
      return { path, replace };
    }

    const defaultName = `${title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'pixel-board'}.${extension}`;
    const options = { title: format === 'pixelboard' ? 'Save editable Pixel Board' : 'Export Pixel Board as SVG', defaultPath: defaultName, filters: [{ name: format === 'pixelboard' ? 'Pixel Board' : 'SVG image', extensions: [extension] }] };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    const path = result.filePath.toLowerCase().endsWith(`.${extension}`) ? result.filePath : `${result.filePath}.${extension}`;
    let overwrite = false;
    if (existsSync(path)) {
      const message = { type: 'warning' as const, title: 'Replace existing file?', message: `A file already exists at ${path}. Replace it?`, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true };
      const answer = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, message)
        : await dialog.showMessageBox(message);
      if (answer.response !== 1) return null;
      overwrite = true;
    }
    return { path, overwrite };
  };

  const chooseBrowserUpload = async (destinationUrl: string): Promise<ReturnType<typeof validateBrowserUploadFile> | null> => {
    const parent = windows.getWorkspaceWindow();
    const pickerOptions = { title: 'Choose a file to upload', properties: ['openFile'] as Array<'openFile'> };
    const selected = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, pickerOptions)
      : await dialog.showOpenDialog(pickerOptions);
    const rawPath = selected.filePaths[0];
    if (selected.canceled || !rawPath) return null;
    const file = validateBrowserUploadFile(rawPath);
    const origin = (() => { try { return new URL(destinationUrl).origin; } catch { return 'the current browser page'; } })();
    const message = {
      type: 'warning' as const,
      title: 'Upload this file?',
      message: `Pixel is about to attach ${file.fileName} (${file.sizeBytes.toLocaleString()} bytes) to a form on ${origin}. The website may receive and store this file.`,
      buttons: ['Cancel', 'Upload this file'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const answer = parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, message)
      : await dialog.showMessageBox(message);
    return answer.response === 1 ? file : null;
  };

  const chooseBrowserDownload = async (suggestedName: string): Promise<string | null> => {
    const parent = windows.getWorkspaceWindow();
    const options = { title: 'Save browser download', defaultPath: basename(suggestedName) || 'download' };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    if (existsSync(result.filePath)) throw new Error('Pixel will not overwrite an existing download. Choose a new filename.');
    return result.filePath;
  };

  const readSystemDiagnostics = async (): Promise<DiagnosticsSnapshot> => {
    const displays = captures.listDisplays();
    const systemVolume = process.env.SystemDrive
      ? `${process.env.SystemDrive}${process.env.SystemDrive.endsWith('\\') ? '' : '\\'}`
      : parse(app.getPath('userData')).root || app.getPath('userData');
    let battery: DiagnosticsSnapshot['battery'] = null;
    let batteryError: unknown;
    if (process.platform === 'win32') {
      try {
        battery = await nativeHelper.call('system_power_status', {});
      } catch (error) {
        batteryError = error;
      }
    }
    return collectDiagnostics(
      {
        now: () => Date.now(),
        getDisplays: () => displays,
        getDisks: () => probeVolumeCapacity(systemVolume, (root) => {
          const { blocks, bavail, frsize } = statfsSync(root);
          return { blocks, bavail, frsize };
        }),
        ...(process.platform === 'win32' ? {
          getBattery: () => {
            if (batteryError) throw batteryError;
            return battery;
          },
        } : {}),
      },
      settings.get().companion.monitorId ?? displays[0]?.id,
    );
  };

  const permissionGrantStore = new PermissionGrantStore(database);
  const pluginStore = new PluginStore(database);
  const sessionSearchIndex = new SessionSearchIndex(database);
  try { sessionSearchIndex.backfillFromHistory(history); } catch { /* best-effort FTS5 backfill */ }
  const sessionSearchTools = new SessionSearchTools(sessionSearchIndex, projectId);
  const memorySnapshots = new SessionMemorySnapshotManager(memoryStore);
  const proceduralSkillStore = new ProceduralSkillStore(database);
  const proceduralSkillTools = new ProceduralSkillTools(proceduralSkillStore, projectId);

  const buildTurnMemoryAndSkills = (request: ChatRequest): string => {
    const convId = request.conversationId ?? activeConversationId ?? 'ephemeral';
    const mem = memorySnapshots.buildTurnContext({
      conversationId: convId,
      projectId: projectId(),
      text: request.text,
    }).text;
    const skillIndex = proceduralSkillStore.buildSkillIndexPrompt(projectId());
    return [mem, skillIndex].filter(Boolean).join('\n\n');
  };

  const readGoogleCalendarToken = (): OAuthTokenRecord | null => {
    const raw = settings.getProviderSecret('google-calendar');
    if (!raw) return null;
    try { return JSON.parse(raw) as OAuthTokenRecord; } catch { return null; }
  };
  const googleCalendarClient = new GoogleCalendarClient(readGoogleCalendarToken);

  let mcpManager: McpServerManager | null = null;
  const toolRegistry = new ToolRegistry([
    ...BUILTIN_TOOLS,
    ...BOARD_TOOL_DEFINITIONS,
    ...MEMORY_TOOL_DEFINITIONS.filter((definition) => definition.name !== 'memory_save'),
    ...SESSION_SEARCH_TOOL_DEFINITIONS,
    ...PROCEDURAL_SKILL_TOOL_DEFINITIONS,
    ...DOCUMENT_TOOL_DEFINITIONS,
    ...FILE_TOOL_DEFINITIONS,
    ...GIT_TOOL_DEFINITIONS,
    ...PRODUCTIVITY_TOOL_DEFINITIONS,
    ...pluginStore.installedTools(),
  ], (grant) => {
    try { permissionGrantStore.markUsed(grant); } catch { /* persistence failure must not change the authorization decision */ }
  }, (toolName) => pluginStore.isToolAvailable(projectId(), toolName) && (mcpManager ? mcpManager.isToolAvailable(projectId(), toolName) : true));
  const taskStore = new TaskStore(database);
  const skillStore = new SkillStore(database);
  const routineStore = new RoutineStore(database, skillStore);
  let routineScheduler: LocalRoutineScheduler | null = null;
  const tasks = new TaskManager(
    (task) => context.sendToRenderer(CHANNELS.tasksUpdate, task),
    taskStore,
    (error) => {
      boot.info(`task manager update failed: ${error instanceof Error ? error.message : String(error)}`);
      audit.record('system', 'Task manager update failed', 'error');
    },
  );
  const permissions = new PermissionBroker(
    toolRegistry,
    audit,
    (request) => context.sendToRenderer(CHANNELS.permissionsRequest, request),
    (requestId) => context.sendToRenderer(CHANNELS.permissionsResolved, requestId),
    permissionGrantStore,
  );
  mcpManager = new McpServerManager(database, {
    onToolsChanged: (added, removedNames) => {
      for (const name of removedNames) toolRegistry.unregister(name);
      for (const def of added) {
        if (!toolRegistry.get(def.name)) toolRegistry.register(def);
      }
    },
    onRevokeTool: (toolName) => permissions.revokeForTool(toolName),
  });
  const voice = new VoiceService(pythonWorker, voiceModelManager);
  let activePtt: {
    id: number;
    controller: AbortController;
    released: boolean;
    captureReady: boolean;
    transcribing: boolean;
    releaseTimer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  let manualVoiceCaptureOwner: number | null = null;
  let pttSequence = 0;
  const notifyPtt = (
    state: 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting' | 'failed' | 'cancelled',
    error?: string,
    sessionId?: number,
  ): void => {
    context.sendToRenderer(CHANNELS.voicePttState, {
      state,
      ...(error ? { error } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  };
  const cancelPttSession = (state: 'failed' | 'cancelled', error?: string): void => {
    const session = activePtt;
    activePtt = null;
    if (session?.releaseTimer) clearTimeout(session.releaseTimer);
    session?.controller.abort();
    if (session) {
      context.sendToMainRenderer?.(CHANNELS.voicePttStopCapture, {
        sessionId: session.id,
        action: 'cancel',
      });
    }
    notifyPtt(state, error, session?.id);
  };

  /** Tool names that finished before the stop, for an honest report. */
  const completedActions: string[] = [];

  const conversation: ConversationEngine = new ConversationEngine({
    provider,
    getApiKey: () => settings.getApiKey(),
    isStopped: (): boolean => emergency.isStopped(),
    emit: emitChatEvent,
    toolsFor: (mode) => toolRegistry.schemasFor(mode),
    memoryContextFor: (request) => buildTurnMemoryAndSkills(request),
  });

  const emergency: EmergencyController = new EmergencyController({
    registry: toolRegistry,
    permissions,
    tasks,
    audit,
    abortStream: (): boolean => {
      const wasRunning: boolean = conversation.isRunning || pythonRunner.isRunning;
      conversation.abort();
      agent.cancel('stop');
      pythonRunner.cancel('stop');
      routineScheduler?.cancelAll();
      windows.clearVisualGuidance();
      return wasRunning;
    },
    killChildren: () => {
      voice.cancelAll();
      cancelPttSession('cancelled');
      void pythonWorker.shutdown();
      void pythonAgentBridge.dispose();
      return executors.killAll();
    },
    completedActions: () => [...completedActions],
    notify: (report) => context.sendToRenderer(CHANNELS.systemEmergencyStopEvent, report),
  });

  /**
   * Vision analysis for the analyze_screen tool. Uses the vision-capable model
   * for a single, cheap, non-streaming turn.
   */
  const describeImage = async (
    image: { dataUrl: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; width: number; height: number; source: 'screenshot' | 'upload'; label?: string },
    question: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    const key = settings.getApiKey();
    if (!key) throw new Error('No API key is configured.');

    const result = await provider.generate({
      requestId: `vision_${Date.now().toString(36)}`,
      model: VISION_MODEL,
      messages: [
        {
          id: 'vision_user',
          role: 'user',
          content: question,
          images: [image],
          createdAt: Date.now(),
        },
      ],
      thinking: { enabled: false, effort: 'low' },
      temperature: 0.2,
      maxTokens: 900,
      signal: signal ?? new AbortController().signal,
      timeoutMs: 60_000,
      onEvent: () => undefined,
    });
    return result.content?.trim() ?? '';
  };

  // One browser session per app run, closed by the emergency stop.
  const browser = new BrowserSession({ headless: true });

  const executors = new ToolExecutors({
    clipboard,
    openPath: (path) => shell.openPath(path),
    trashPath: (path) => shell.trashItem(path),
    browser,
    chooseBrowserUpload,
    chooseBrowserDownload,
    openExternal: (url) => {
      const safeUrl = safeExternalHttpUrl(url);
      if (!safeUrl) throw new Error('Only valid HTTP or HTTPS links can be opened externally.');
      return shell.openExternal(safeUrl);
    },
    searchProvider: () => settings.get().browserSearchProvider,
    systemDiagnostics: readSystemDiagnostics,
    memory: memoryTools,
    sessionSearch: sessionSearchTools,
    proceduralSkills: proceduralSkillTools,
    documents: documentTools,
    productivity: productivityTools,
    files: fileTools,
    git: gitTools,
    board: boardService,
    chooseBoardFile,
    focusBoard: () => {
      const workspace = windows.getWorkspaceWindow();
      if (workspace && !workspace.isDestroyed()) workspace.webContents.send(CHANNELS.boardFocusRequested);
    },
    nativeHelper,
    toDipRect: (rect) => screen.screenToDipRect(null, rect),
    requestHumanTakeover: (taskId, reason, signal) =>
      tasks.waitForHuman(taskId, reason, signal ?? new AbortController().signal),
    captureScreen: async (target, selected, displayId) => {
      if (target === 'active_window') return captures.captureActiveWindow();
      if (target === 'last_external') return captures.captureLastExternalWindow();
      if (target === 'selected_window') {
        return selected
          ? captures.captureSelectedWindow(selected)
          : { ok: false, error: { code: 'BAD_REQUEST', message: 'Select one exact window before capture.', retryable: false } };
      }
      return captures.captureDisplay(displayId);
    },
    describeImage,
    showVisualGuidance: (request) => windows.showVisualGuidance(request),
    clearVisualGuidance: (selector) => windows.clearVisualGuidance(selector),
    onPluginHealth: (pluginId, error) => pluginStore.recordHealth(pluginId, error),
    getPluginSetting: (pluginId, key) => pluginStore.getSetting(pluginId, key),
    getGitHubToken: () => settings.getGitHubToken(),
    mcp: mcpManager,
    googleCalendar: googleCalendarClient,
  });

  const agent = new AgentExecutor({
    engine: conversation,
    registry: toolRegistry,
    permissions,
    tasks,
    audit,
    executors,
    emit: emitChatEvent,
    isStopped: () => emergency.isStopped(),
    getProjectId: () => memoryStore.getActiveProject(),
  });

  const pythonAgentBridge = new PythonAgentBridge({
    ownershipPath: join(app.getPath('userData'), 'runtime', 'python-agent-owner.json'),
    crashLogPath: join(app.getPath('userData'), 'logs', 'python-agent-crash.log'),
  });

  const pythonRunner = new PythonAgentRunner({
    bridge: pythonAgentBridge,
    registry: toolRegistry,
    permissions,
    tasks,
    audit,
    executors,
    emit: emitChatEvent,
    isStopped: () => emergency.isStopped(),
    getApiKey: () => settings.getApiKey(),
    getProviderConfig: (model) => ({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model,
    }),
    memoryContextFor: (request) => buildTurnMemoryAndSkills(request),
    getProjectId: () => memoryStore.getActiveProject(),
    fallbackToTypescript: (opts) => agent.run(opts),
  });

  const isAgentBusy = (): boolean => agent.isRunning || pythonRunner.isRunning;

  const resolveRuntimeEngine = (): 'typescript' | 'python' => {
    const envOverride = process.env.PIXEL_AGENT_RUNTIME?.trim().toLowerCase();
    if (envOverride === 'python' || envOverride === 'typescript') return envOverride;
    return settings.get().agent?.runtimeEngine === 'python' ? 'python' : 'typescript';
  };

  const startPushToTalk = (): void => {
    if (activePtt) return;
    if (manualVoiceCaptureOwner !== null) {
      notifyPtt('failed', 'Another Pixel window is already recording. Stop that recording before using push-to-talk.');
      return;
    }
    if (isAgentBusy() || emergency.isStopped()) {
      notifyPtt('failed', emergency.isStopped()
        ? 'Clear emergency stop before using push-to-talk.'
        : 'Pixel is already handling a request. Your existing work was not interrupted.');
      return;
    }

    const session = {
      id: ++pttSequence,
      controller: new AbortController(),
      released: false,
      captureReady: false,
      transcribing: false,
      releaseTimer: null,
    };
    activePtt = session;
    if (!context.sendToMainRenderer) {
      cancelPttSession('failed', 'Pixel could not start microphone capture in its companion window.');
      return;
    }
    // Start microphone capture on the actual keydown path. Capability probing
    // may invoke PowerShell or initialize Python; waiting for it here would
    // miss speech at the beginning of a hold. Transcription still reports its
    // real capability/error result after release.
    notifyPtt('starting', undefined, session.id);
  };

  const endPushToTalk = async (
    reason: 'released' | 'timeout' | 'cancelled' | 'unavailable' | 'failed',
  ): Promise<void> => {
    const session = activePtt;
    if (!session || !claimPushToTalkEnd(session)) return;

    if (reason !== 'released') {
      const error = reason === 'timeout'
        ? 'Push-to-talk reached its 20-second safety limit and stopped.'
        : reason === 'unavailable'
          ? 'Pixel could not track the shortcut release; recording was cancelled.'
          : reason === 'failed'
            ? 'Pixel could not track the shortcut release; recording was cancelled.'
            : undefined;
      cancelPttSession(reason === 'cancelled' ? 'cancelled' : 'failed', error);
      return;
    }
    notifyPtt('stopping', undefined, session.id);
    context.sendToMainRenderer?.(CHANNELS.voicePttStopCapture, {
      sessionId: session.id,
      action: 'submit',
    });
    session.releaseTimer = setTimeout(() => {
      if (activePtt === session) {
        cancelPttSession('failed', 'Pixel did not receive the finished microphone audio. Nothing was submitted.');
      }
    }, 5_000);
  };

  const routines = new LocalRoutineScheduler(
    routineStore,
    skillStore,
    async (routine, skill, scheduledKey, signal) => {
      if (signal.aborted) return { status: 'cancelled', failure: 'Routine was cancelled before it started.' };
      if (routine.projectId !== projectId()) {
        return { status: 'denied', failure: 'The active project changed; Pixel did not run a routine from another project.' };
      }
      if (agent.isRunning) {
        return { status: 'failed', failure: 'Pixel was already handling another task; this scheduled occurrence was not run.' };
      }

      const skillRunId = skillStore.startRun(skill, routine.projectId);
      const requestId = `routine_${routine.id}_${scheduledKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
      const abortAgent = (): void => agent.cancel('user');
      signal.addEventListener('abort', abortAgent, { once: true });
      try {
        const current = settings.get();
        if (skill.steps.some((step) =>
          step.kind !== 'tool' || step.action !== step.locator ||
          (step.action === 'request_human_takeover'))) {
          const failure = 'This skill contains a step that is not supported by deterministic replay.';
          skillStore.finishRun(skillRunId, { status: 'failed', stepCount: 0, summary: failure });
          return { status: 'failed', failure };
        }
        const toolPlan = buildRoutineToolPlan(skill, requestId, toolRegistry, routine.inputValues);
        const result = await agent.run({
          requestId,
          request: {
            text: [
              `Run reviewed skill "${skill.name}" version ${String(skill.version)} as routine "${routine.name}".`,
              `Purpose: ${skill.purpose}`,
              'The ordered reviewed tools will be invoked directly. Observe the current state before actions, require existing approvals, stop on any failed step, and do not infer that unverified work succeeded.',
              ...(scheduledKey.startsWith('manual:') ? ['This is a user-requested retry after an earlier run may have partly completed. The current state must be inspected before proceeding.'] : []),
            ].join('\n'),
            mode: current.companion.mode,
          },
          model: current.provider.primaryModel,
          thinking: current.provider.thinking ?? DEFAULT_THINKING,
          temperature: current.provider.temperature,
          maxTokens: current.provider.maxTokens,
          allowedTools: [...skill.requiredTools, 'request_human_takeover'],
          requireInitialObservation: true,
          toolPlan,
          redactValues: Object.values(routine.inputValues),
        });
        const status = result.task.status === 'completed' ? 'completed'
          : result.task.status === 'cancelled' || signal.aborted ? 'cancelled'
            : result.task.status === 'awaiting_approval' ? 'denied' : 'failed';
        const summary = result.finalContent.slice(0, 1_000);
        skillStore.finishRun(skillRunId, {
          status: status === 'denied' ? 'denied' : status,
          stepCount: result.task.steps.length,
          ...(result.failure ? { summary: result.failure } : {}),
        });
        return {
          status,
          taskId: result.task.title === 'Not started' ? undefined : result.task.id,
          ...(summary ? { summary } : {}),
          ...(status !== 'completed' ? { failure: result.failure ?? result.finalContent ?? `Task ended ${result.task.status}.` } : {}),
        };
      } catch (error) {
        skillStore.finishRun(skillRunId, {
          status: signal.aborted ? 'cancelled' : 'failed',
          stepCount: 0,
          summary: 'The scheduled skill did not finish.',
        });
        throw error;
      } finally {
        signal.removeEventListener('abort', abortAgent);
      }
    },
    (error) => boot.info(`routine scheduler: ${error instanceof Error ? error.message : String(error)}`),
    Date.now,
    () => !emergency.isStopped(),
  );
  routineScheduler = routines;
  routines.start();

  registerHandler(CHANNELS.skillsList, (): SkillRecord[] =>
    skillStore.list(projectId()) as SkillRecord[],
  );
  registerHandler(CHANNELS.skillsRun, async (_event, skillId: string, rawInputs: Record<string, string>): Promise<TaskRecord> => {
    if (typeof skillId !== 'string' || skillId.length > 100 || !rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      throw new Error('Choose a reviewed skill and provide its declared inputs.');
    }
    const skill = skillStore.getActive(skillId);
    if (!skill || skill.projectId !== projectId() || !skillStore.isIntact(skill)) {
      throw new Error('Only an intact active skill in the current project can run.');
    }
    if (agent.isRunning) throw new Error('Pixel is already handling another task. Wait or stop it before running a skill.');
    if (emergency.isStopped()) throw new Error('Emergency stop is active. Clear it before running a skill.');
    const inputs: Record<string, string> = {};
    const entries = Object.entries(rawInputs);
    if (entries.length > 30) throw new Error('A skill run accepts at most 30 declared inputs.');
    for (const [name, value] of entries) {
      if (typeof name !== 'string' || typeof value !== 'string' || value.length > 2_000 || looksLikeCredential(value)) {
        throw new Error(`Skill input "${name.slice(0, 40)}" is invalid or resembles credential material.`);
      }
      inputs[name] = value;
    }
    const requestId = `skill_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const toolPlan = buildSkillToolPlan(skill, requestId, toolRegistry, inputs);
    const skillRunId = skillStore.startRun(skill, projectId());
    try {
      const current = settings.get();
      const result = await agent.run({
        requestId,
        request: {
          text: `Run the reviewed skill "${skill.name}" version ${String(skill.version)} once. Follow its ordered steps exactly. Pixel supplies only the values in this invocation, does not store them in task history, requires a fresh observation, applies current permissions and stops on any mismatch.`,
          mode: current.companion.mode,
        },
        model: current.provider.primaryModel,
        thinking: current.provider.thinking ?? DEFAULT_THINKING,
        temperature: current.provider.temperature,
        maxTokens: current.provider.maxTokens,
        allowedTools: skill.requiredTools,
        requireInitialObservation: true,
        toolPlan,
        redactValues: Object.values(inputs),
      });
      const status = result.task.status === 'completed' ? 'completed'
        : result.task.status === 'cancelled' ? 'cancelled'
          : result.task.status === 'awaiting_approval' ? 'denied' : 'failed';
      skillStore.finishRun(skillRunId, {
        status,
        stepCount: result.task.steps.length,
        ...(result.failure ? { summary: result.failure } : {}),
      });
      audit.record('tool', 'Ran reviewed skill once', status === 'completed' ? 'ok' : status === 'cancelled' ? 'cancelled' : 'error', `Skill ${skill.id}; task ${result.task.id}; ${result.task.steps.length} step(s)`);
      return result.task;
    } catch (error) {
      skillStore.finishRun(skillRunId, { status: 'failed', stepCount: 0, summary: 'Manual skill run failed before completion.' });
      throw error;
    }
  });
  registerHandler(CHANNELS.skillsCreateDraft, (_event, draft: SkillDraftRequest): SkillRecord => {
    if (!draft || typeof draft !== 'object') throw new Error('A skill draft is required.');
    return skillStore.createDraft({ ...draft, projectId: projectId() }) as SkillRecord;
  });
  registerHandler(CHANNELS.skillsRecordTask, (_event, taskId: string): SkillRecord => {
    if (typeof taskId !== 'string' || taskId.length > 160) throw new Error('A valid task is required.');
    const task = tasks.get(taskId);
    if (!task || task.projectId !== projectId()) throw new Error('That task is not available in the active project.');
    const draft = draftSkillFromTask(task, toolRegistry);
    const created = skillStore.createDraft({ ...draft, projectId: projectId() });
    audit.record('tool', 'Created a workflow draft from completed task', 'ok', `Task ${task.id}; skill ${created.id}`);
    return created as SkillRecord;
  });
  registerHandler(CHANNELS.skillsActivate, (_event, skillId: string): SkillRecord => {
    const draft = skillStore.get(skillId);
    if (!draft || draft.projectId !== projectId()) throw new Error('The skill is not available in the active project.');
    const unavailable = draft.requiredTools.filter((name) => !toolRegistry.get(name));
    if (unavailable.length > 0) throw new Error(`This build cannot activate the skill because these tools are unavailable: ${unavailable.join(', ')}.`);
    return skillStore.activate(skillId) as SkillRecord;
  });
  registerHandler(CHANNELS.skillsDelete, (_event, skillId: string): boolean => {
    const skill = skillStore.get(skillId);
    if (!skill || skill.projectId !== projectId()) return false;
    return skillStore.delete(skillId);
  });

  registerHandler(CHANNELS.routinesList, (): RoutineRecord[] =>
    routineStore.list(projectId()) as RoutineRecord[],
  );
  registerHandler(CHANNELS.routinesCreate, (_event, input: { skillId: string; name: string; localTime: string; timezone: string; inputValues?: unknown }): RoutineRecord => {
    if (!input || typeof input !== 'object' || typeof input.skillId !== 'string' ||
        typeof input.name !== 'string' || typeof input.localTime !== 'string' || typeof input.timezone !== 'string') {
      throw new Error('Routine settings are required.');
    }
    const skill = skillStore.getActive(input.skillId);
    if (!skill || skill.projectId !== projectId()) throw new Error('Choose an active skill in the current project.');
    const inputValues = normalizeSkillInputValues(skill.inputs, input.inputValues ?? {});
    buildRoutineToolPlan(skill, 'routine-validation', toolRegistry, inputValues);
    return routineStore.toSummary(routineStore.create({ ...input, inputValues, projectId: projectId() })) as RoutineRecord;
  });
  registerHandler(CHANNELS.routinesSetEnabled, (_event, routineId: string, enabled: boolean): boolean => {
    if (typeof enabled !== 'boolean') return false;
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return false;
    return routineStore.setEnabled(routineId, enabled);
  });
  registerHandler(CHANNELS.routinesDelete, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return false;
    if (routines.cancel(routineId)) return false;
    return routineStore.delete(routineId);
  });
  registerHandler(CHANNELS.routinesHistory, (_event, routineId: string, limit?: number): RoutineRunRecord[] => {
    const routine = routineStore.get(routineId);
    if (!routine || routine.projectId !== projectId()) return [];
    return routineStore.history(routineId, limit) as RoutineRunRecord[];
  });
  registerHandler(CHANNELS.routinesCancel, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    return routine?.projectId === projectId() && routines.cancel(routineId);
  });
  registerHandler(CHANNELS.routinesRetry, (_event, routineId: string): boolean => {
    const routine = routineStore.get(routineId);
    return routine?.projectId === projectId() && routines.retry(routineId);
  });

  registerHandler(CHANNELS.memoryList, (): MemoryRecordView[] =>
    memoryStore.list({ projectId: projectId(), limit: 50 }) as MemoryRecordView[],
  );
  registerHandler(CHANNELS.memoryUpdate, (_event, id: string, patch: { content?: string; kind?: PixelMemoryKind; tags?: string[] }): MemoryRecordView => {
    const existing = memoryStore.get(id);
    if (!existing || existing.projectId !== projectId()) throw new Error('That memory is not in the active project.');
    if (!patch || typeof patch !== 'object') throw new Error('Memory changes are required.');
    if (patch.content !== undefined && (typeof patch.content !== 'string' || patch.content.length > 4_000)) {
      throw new Error('Memory content must be 4,000 characters or fewer.');
    }
    if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.some((tag) => typeof tag !== 'string' || tag.length > 64))) {
      throw new Error('Memory tags must be short text values.');
    }
    const updated = memoryStore.update(id, patch) as MemoryRecordView;
    memorySnapshots.invalidateProject(projectId());
    return updated;
  });
  registerHandler(CHANNELS.memoryDelete, (_event, id: string): boolean => {
    const existing = memoryStore.get(id);
    if (!existing || existing.projectId !== projectId()) return false;
    const ok = memoryStore.delete(id) && memoryStore.get(id) === null;
    if (ok) memorySnapshots.invalidateProject(projectId());
    return ok;
  });
  registerHandler(CHANNELS.memoryHistory, (_event, id: string) => {
    const existing = memoryStore.get(id);
    if (!existing || existing.projectId !== projectId()) throw new Error('That memory is not in the active project.');
    return memoryStore.history(id);
  });
  registerHandler(CHANNELS.memoryExport, (): MemoryExportView =>
    memoryStore.exportProject(projectId()) as MemoryExportView,
  );
  registerHandler(CHANNELS.memoryProjectsList, () =>
    memoryStore.listProjects().map((project) => ({ ...project, active: project.id === projectId() })),
  );
  registerHandler(CHANNELS.memorySetActiveProject, (_event, name: string) => {
    if (agent.isRunning || tasks.list().some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))) {
      throw new Error('Finish or cancel active tasks before switching projects.');
    }
    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 80) {
      throw new Error('Project names must contain 1 to 80 characters.');
    }
    const id = memoryStore.setActiveProject(name.trim());
    const project = projectView(id);
    if (!project) throw new Error('Pixel could not select that project.');
    const next = history.list({ limit: 1, projectId: id })[0]
      ?? [...sessionConversations.values()].filter((record) => record.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt).map(toSessionSummary)[0];
    activeConversationId = next?.id ?? null;
    if (!activeConversationId) newConversation();
    context.sendToRenderer(CHANNELS.memoryProjectChanged, project);
    broadcastActiveConversation();
    return project;
  });

  registerHandler(CHANNELS.productivityNotesList, () => productivityStore.listNotes(projectId()));
  registerHandler(CHANNELS.productivityNotesCreate, (_event, title: string, body: string) => {
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 180 || typeof body !== 'string' || body.length > 20_000) throw new Error('Note title/body is outside the supported limits.');
    return productivityStore.createNote(projectId(), title, body);
  });
  registerHandler(CHANNELS.productivityNotesUpdate, (_event, id: string, patch: { title?: string; body?: string }) => {
    if (typeof id !== 'string' || id.length > 80 || !patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid note update request.');
    if (Object.keys(patch).some((key) => key !== 'title' && key !== 'body')) throw new Error('Unsupported note update field.');
    if (patch.title !== undefined && (typeof patch.title !== 'string' || patch.title.trim().length === 0 || patch.title.length > 180)) throw new Error('Note title is outside the supported limits.');
    if (patch.body !== undefined && (typeof patch.body !== 'string' || patch.body.length > 20_000)) throw new Error('Note body is outside the supported limits.');
    return productivityStore.updateNote(projectId(), id, patch);
  });
  registerHandler(CHANNELS.productivityNotesDelete, (_event, id: string) => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid note ID.');
    return productivityStore.deleteNote(projectId(), id);
  });
  registerHandler(CHANNELS.productivityNotesImportMarkdown, async (_event): Promise<ReturnType<ProductivityStore['createNote']> | null> => {
    const parent = windows.getWorkspaceWindow();
    const options = { title: 'Import a Markdown note', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Markdown or text', extensions: ['md', 'markdown', 'txt'] }] };
    const result = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    try {
      const info = lstatSync(selected);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 20_000) throw new Error('unsupported note file');
      const source = readFileSync(selected, 'utf8').replace(/^\uFEFF/, '');
      if (source.includes('\u0000')) throw new Error('binary content');
      const firstHeading = source.match(/^#\s+(.+)\s*$/m)?.[1]?.trim();
      const base = selected.split(/[\\/]/).pop()?.replace(/\.(md|markdown|txt)$/i, '')?.trim();
      const title = (firstHeading || base || 'Imported note').slice(0, 180);
      const body = firstHeading ? source.replace(/^#\s+.+\s*\n?/, '').trimStart() : source;
      if (body.length > 20_000) throw new Error('note too large');
      return productivityStore.createNote(projectId(), title, body);
    } catch {
      throw new Error('Pixel could not import that file. Choose a readable Markdown or text file up to 20 KB.');
    }
  });
  registerHandler(CHANNELS.productivityNotesExportMarkdown, async (_event, id: string): Promise<{ ok: boolean; cancelled?: boolean; verified?: boolean }> => {
    if (typeof id !== 'string' || id.length > 80) throw new Error('Invalid note ID.');
    const note = productivityStore.getNote(projectId(), id);
    if (!note) return { ok: false };
    const safeName = note.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 100) || 'pixel-note';
    const parent = windows.getWorkspaceWindow();
    const options = { title: 'Export note as Markdown', defaultPath: `${safeName}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] };
    const result = parent && !parent.isDestroyed() ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
    const content = `# ${note.title}\n\n${note.body}${note.body.endsWith('\n') || !note.body ? '' : '\n'}`;
    try {
      const alreadyExists = existsSync(result.filePath);
      if (alreadyExists) {
        const message = { type: 'warning' as const, title: 'Replace existing file?', message: `A file already exists at ${result.filePath}. Replace it?`, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true };
        const answer = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, message) : await dialog.showMessageBox(message);
        if (answer.response !== 1) return { ok: true, cancelled: true };
      }
      writeFileSync(result.filePath, content, { encoding: 'utf8', flag: alreadyExists ? 'w' : 'wx', mode: 0o600 });
      const saved = readFileSync(result.filePath, 'utf8');
      return { ok: saved === content, verified: saved === content };
    } catch {
      return { ok: false };
    }
  });
  registerHandler(CHANNELS.productivityNoteDocumentsList, (_event, noteId: string): ProductivityDocumentLinkView[] => {
    if (typeof noteId !== 'string' || noteId.length > 80) throw new Error('Invalid note ID.');
    return productivityStore.listDocumentLinks(projectId(), noteId).map(toDocumentLinkView);
  });
  registerHandler(CHANNELS.productivityNoteDocumentsLink, async (_event, noteId: string): Promise<ProductivityDocumentLinkView | null> => {
    if (typeof noteId !== 'string' || noteId.length > 80 || !productivityStore.getNote(projectId(), noteId)) throw new Error('Note is not available in the active project.');
    const parent = windows.getWorkspaceWindow();
    const options = { title: 'Link a local document to this note', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Documents', extensions: SUPPORTED_PRODUCTIVITY_DOCUMENT_EXTENSIONS.map((extension) => extension.slice(1)) }] };
    const result = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    try {
      const link = productivityStore.linkDocument(projectId(), noteId, selected);
      return toDocumentLinkView(link);
    } catch {
      throw new Error('Pixel could not link that file. Choose a supported document file, not a folder or symbolic link.');
    }
  });
  registerHandler(CHANNELS.productivityNoteDocumentsOpen, async (_event, noteId: string, linkId: string): Promise<{ ok: boolean }> => {
    if (typeof noteId !== 'string' || noteId.length > 80 || typeof linkId !== 'string' || linkId.length > 80) throw new Error('Invalid note document link.');
    const link = productivityStore.getDocumentLink(projectId(), noteId, linkId);
    if (!link) return { ok: false };
    try {
      const info = lstatSync(link.path);
      if (!info.isFile() || info.isSymbolicLink() || realpathSync(link.path) !== link.path) return { ok: false };
      return { ok: (await shell.openPath(link.path)) === '' };
    } catch {
      return { ok: false };
    }
  });
  registerHandler(CHANNELS.productivityNoteDocumentsUnlink, (_event, noteId: string, linkId: string): boolean => {
    if (typeof noteId !== 'string' || noteId.length > 80 || typeof linkId !== 'string' || linkId.length > 80) throw new Error('Invalid note document link.');
    return productivityStore.unlinkDocument(projectId(), noteId, linkId);
  });
  registerHandler(CHANNELS.productivityChecklistsList, (): ProductivityChecklistView[] => productivityStore.listChecklists(projectId()));
  registerHandler(CHANNELS.productivityChecklistsCreate, (_event, title: string): ProductivityChecklistView => {
    if (typeof title !== 'string' || !title.trim() || title.length > 180) throw new Error('Checklist title is outside the supported limits.');
    return productivityStore.createChecklist(projectId(), title);
  });
  registerHandler(CHANNELS.productivityTasksList, () => productivityStore.listTasks(projectId()));
  registerHandler(CHANNELS.productivityTasksCreate, (_event, title: string, description = '', dueAt?: string, checklistId?: string) => {
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 180 || typeof description !== 'string' || description.length > 4_000) throw new Error('Task title/description is outside the supported limits.');
    const dueTimestamp = dueAt === undefined || dueAt === '' ? null : typeof dueAt === 'string' ? Date.parse(dueAt) : Number.NaN;
    if (dueTimestamp !== null && !Number.isFinite(dueTimestamp)) throw new Error('Task due date is invalid.');
    if (checklistId !== undefined && (typeof checklistId !== 'string' || checklistId.length > 80 || !productivityStore.getChecklist(projectId(), checklistId))) throw new Error('Checklist is not available in the active project.');
    return productivityStore.createTask(projectId(), title, description, dueTimestamp, checklistId ?? null);
  });
  registerHandler(CHANNELS.productivityTasksUpdate, (_event, id: string, patch: { title?: string; description?: string; status?: 'open' | 'in_progress' | 'completed'; dueAt?: string | null; checklistId?: string | null }) => {
    if (typeof id !== 'string' || id.length > 80 || !patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid task update request.');
    if (Object.keys(patch).some((key) => !['title', 'description', 'status', 'dueAt', 'checklistId'].includes(key))) throw new Error('Unsupported task update field.');
    if (patch.title !== undefined && (typeof patch.title !== 'string' || patch.title.trim().length === 0 || patch.title.length > 180)) throw new Error('Task title is outside the supported limits.');
    if (patch.description !== undefined && (typeof patch.description !== 'string' || patch.description.length > 4_000)) throw new Error('Task description is outside the supported limits.');
    if (patch.status !== undefined && !['open', 'in_progress', 'completed'].includes(patch.status)) throw new Error('Invalid task status.');
    const dueAt = patch.dueAt === undefined ? undefined : patch.dueAt === null || patch.dueAt === '' ? null : typeof patch.dueAt === 'string' ? Date.parse(patch.dueAt) : Number.NaN;
    if (dueAt !== undefined && dueAt !== null && !Number.isFinite(dueAt)) throw new Error('Task due date is invalid.');
    if (patch.checklistId !== undefined && patch.checklistId !== null && (typeof patch.checklistId !== 'string' || patch.checklistId.length > 80 || !productivityStore.getChecklist(projectId(), patch.checklistId))) throw new Error('Checklist is not available in the active project.');
    const { dueAt: _rawDueAt, ...taskPatch } = patch;
    return productivityStore.updateTask(projectId(), id, { ...taskPatch, ...(dueAt === undefined ? {} : { dueAt }) });
  });

  registerHandler(CHANNELS.documentsLibraryList, () => documentTools.listForWorkspace());
  registerHandler(CHANNELS.documentsLibraryRead, (_event, documentId: string, startChunk = 0) =>
    documentTools.readForWorkspace(documentId, startChunk),
  );
  registerHandler(CHANNELS.documentsLibraryOpen, async (_event, documentId: string) => {
    const result = await documentTools.openForWorkspace(documentId, (path) => shell.openPath(path));
    audit.record('tool', 'Opened indexed Library document', result.ok ? 'ok' : 'error');
    return result;
  });
  registerHandler(CHANNELS.documentsLibraryOpenFolder, async (_event, folderId: string) => {
    const result = await documentTools.openFolderForWorkspace(folderId, (path) => shell.openPath(path));
    audit.record('tool', 'Opened indexed Library folder', result.ok ? 'ok' : 'error');
    return result;
  });
  registerHandler(CHANNELS.documentsLibraryIndex, async (): Promise<DocumentLibraryIndexResult> => {
    const parent = windows.getWorkspaceWindow();
    const pickerOptions = { title: 'Choose a folder for this project Library', properties: ['openDirectory'] as Array<'openDirectory'> };
    const picked = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, pickerOptions)
      : await dialog.showOpenDialog(pickerOptions);
    const directory = picked.filePaths[0];
    if (picked.canceled || !directory) return { ok: false, cancelled: true, content: 'Folder selection cancelled.' };
    const confirmation = parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, { type: 'info', title: 'Index this folder?', message: 'Pixel will read supported documents in this folder for the active project.', detail: directory, buttons: ['Cancel', 'Index folder'], defaultId: 0, cancelId: 0, noLink: true })
      : await dialog.showMessageBox({ type: 'info', title: 'Index this folder?', message: 'Pixel will read supported documents in this folder for the active project.', detail: directory, buttons: ['Cancel', 'Index folder'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return { ok: false, cancelled: true, content: 'Folder indexing cancelled.' };
    const result = await documentTools.indexForWorkspace(directory);
    audit.record('tool', 'Indexed project Library folder', result.ok ? 'ok' : 'error', result.ok ? `${result.indexed ?? 0} indexed; ${result.failed ?? 0} failed` : 'Indexing was unavailable or rejected.');
    return result;
  });

  /* ----------------------------- settings ---------------------------- */

  registerHandler(CHANNELS.settingsGet, (): AppSettings => settings.get());
  registerHandler(CHANNELS.shortcutsGetStatus, (): unknown => context.getShortcutStatus?.() ?? null);

  registerHandler(CHANNELS.settingsSet, (_event, patch: DeepSeekSettingsPatch): AppSettings => {
    const next = settings.set(patch ?? {});
    windows.setPresentationSettings(next.companion);
    context.onSettingsChange?.(next);
    audit.record('system', 'Settings updated', 'ok', Object.keys(patch ?? {}).join(', '));
    return next;
  });

  registerHandler(CHANNELS.settingsSetApiKey, (_event, key: string) => {
    const result = settings.setApiKey(typeof key === 'string' ? key : '');
    audit.record('system', 'API key updated', result.ok ? 'ok' : 'error');
    context.sendToRenderer(CHANNELS.settingsApiKeyStatusChanged, settings.hasApiKey());
    return result;
  });

  registerHandler(CHANNELS.settingsHasApiKey, (): boolean => settings.hasApiKey());

  registerHandler(CHANNELS.settingsClearApiKey, (): void => {
    settings.clearApiKey();
    audit.record('system', 'API key removed', 'ok');
    context.sendToRenderer(CHANNELS.settingsApiKeyStatusChanged, false);
  });

  registerHandler(
    CHANNELS.settingsTestConnection,
    async (_event, model?: string): Promise<ConnectionTestResult> => {
      const key = settings.getApiKey();
      if (!key) {
        return {
          ok: false,
          error: {
            code: 'NO_API_KEY',
            message: 'Add a DeepSeek API key in Settings first.',
            retryable: false,
          },
        };
      }
      const outcome = await provider.testConnection(key, model ?? settings.get().provider.primaryModel);
      if (outcome.ok) {
        audit.record('model', 'Connection test succeeded', 'ok', outcome.model);
        return {
          ok: true,
          ...(outcome.model ? { model: outcome.model } : {}),
          ...(outcome.latencyMs !== undefined ? { latencyMs: outcome.latencyMs } : {}),
        };
      }
      audit.record('model', 'Connection test failed', 'error', outcome.error?.code);
      return {
        ok: false,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    },
  );

  /* ------------------------------ window ----------------------------- */

  registerHandler(CHANNELS.windowSetSurface, (event, surface: Surface): void => {
    if (!windows.isMainSender(event.sender)) return;
    if (typeof surface === 'string' && Object.prototype.hasOwnProperty.call(SURFACE_SIZES, surface)) {
      windows.setSurface(surface);
    }
  });

  registerHandler(CHANNELS.windowSetLayout, (event, surface: Surface, size: unknown): void => {
    if (event.sender !== windows.getMainWindow()?.webContents) return;
    if (typeof surface !== 'string' || !Object.prototype.hasOwnProperty.call(SURFACE_SIZES, surface)) return;
    if (typeof size !== 'object' || size === null) return;
    const candidate = size as { width?: unknown; height?: unknown };
    if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') return;
    windows.setLayout(surface, { width: candidate.width, height: candidate.height });
  });

  registerHandler(CHANNELS.windowSetExpanded, (_event, expanded: boolean): void => {
    if (!_event || !windows.isMainSender(_event.sender)) return;
    windows.setSurface(expanded ? 'active' : 'idle');
  });

  registerHandler(CHANNELS.windowSetCursorState, (event, state: AssistantState): void => {
    if (!windows.isMainSender(event.sender)) return;
    if (typeof state === 'string' && ASSISTANT_STATES.includes(state as AssistantState)) {
      windows.setCursorAssistantState(state);
    }
  });

  registerHandler(CHANNELS.windowCursorRendererReady, (event): void => {
    if (windows.isCursorSender(event.sender)) windows.markCursorRendererReady(event.sender);
  });

  registerHandler(CHANNELS.windowCursorSettingsGet, (event): { reducedMotion: boolean } => {
    if (!windows.isCursorSender(event.sender)) throw new Error('Only the cursor companion may read its appearance preference.');
    return { reducedMotion: settings.get().companion.reducedMotion };
  });

  registerHandler(CHANNELS.windowHide, (event): void => { if (windows.isMainSender(event.sender)) windows.hide(); });
  registerHandler(CHANNELS.windowShow, (event): void => { if (windows.isMainSender(event.sender)) windows.show(); });

  registerHandler(CHANNELS.windowOpenSettings, (_event): void => {
    windows.createSettingsWindow();
  });

  registerHandler(CHANNELS.windowCloseSettings, (event): void => {
    if (windows.isSettingsSender(event.sender)) windows.closeSettings();
  });

  registerHandler(CHANNELS.windowSetIgnoreMouseEvents, (_event, ignore: boolean): void => {
    if (!_event || !windows.isMainSender(_event.sender)) return;
    windows.setIgnoreMouseEvents(Boolean(ignore));
  });

  registerHandler(CHANNELS.workspaceOpen, (): void => { windows.openWorkspace(); });
  registerHandler(CHANNELS.workspaceClose, (event): void => { if (windows.isWorkspaceSender(event.sender)) windows.closeWorkspace(); });
  registerHandler(CHANNELS.workspaceMinimize, (event): void => { if (windows.isWorkspaceSender(event.sender)) windows.minimizeWorkspace(); });
  registerHandler(CHANNELS.workspaceToggleMaximize, (event): boolean =>
    windows.isWorkspaceSender(event.sender) ? windows.toggleWorkspaceMaximize() : false,
  );
  registerHandler(CHANNELS.workspaceSetFullscreen, (event, fullscreen: boolean): void => {
    if (windows.isWorkspaceSender(event.sender) && typeof fullscreen === 'boolean') windows.setWorkspaceFullscreen(fullscreen);
  });
  registerHandler(CHANNELS.workspaceGetState, (event) =>
    windows.isWorkspaceSender(event.sender) ? windows.getWorkspaceState() : { maximized: false, fullscreen: false },
  );

  /* ------------------------------- chat ------------------------------ */

  registerHandler(CHANNELS.chatSend, async (_event, request: ChatRequest) => {
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const current = settings.get();
    if (!request || typeof request !== 'object' || typeof request.text !== 'string' || request.text.length > 20_000) {
      throw new Error('The message is empty or too long.');
    }
    if (isAgentBusy()) throw new Error('Pixel is busy. Finish or cancel the current task before starting another chat.');

    let conversationId = typeof request.conversationId === 'string' ? request.conversationId : activeConversationId;
    if (conversationId === null) conversationId = newConversation().id;
    if (activeConversationId !== conversationId) {
      throw new Error('That conversation is no longer active. Reopen it before sending a message.');
    }
    const record = getConversation(conversationId);
    if (!record) throw new Error('That conversation could not be restored.');
    if (record.projectId && record.projectId !== projectId()) {
      throw new Error('That conversation belongs to a different project.');
    }
    if (!current.privacy.persistHistory && record.persistence !== 'session') {
      record.persistence = 'session';
      sessionConversations.set(record.id, record);
    }
    const priorHistory = record.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map(safeTranscriptMessage);
    const userContent = request.text.trim() || (request.images?.length ? '[Image attached; image data is not retained in chat history.]' : '');
    addTranscriptMessage(record, {
      id: `${requestId}_user`,
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    });
    const forgetSlot = request.text.trim() ? extractAutomaticMemoryForgetSlot(request.text) : null;
    if (forgetSlot) {
      const removed = memoryStore.deleteAutomaticSlot(projectId(), forgetSlot);
      if (removed) memorySnapshots.invalidateProject(projectId());
      audit.record('system', removed ? 'Automatic preference forgotten' : 'No matching automatic preference to forget', 'ok', `${forgetSlot} · ${removed} record(s)`);
    }
    if (request.text.trim()) {
      const candidates = extractAutomaticMemoryCandidates(request.text);
      for (const candidate of candidates) {
        const explicitUserMemoryAction = candidate.tags.includes('user-requested') || candidate.tags.includes('auto-correction');
        if (!current.privacy.automaticMemory && !explicitUserMemoryAction) continue;
        try {
          const saved = memoryStore.saveAutomatic({
            projectId: projectId(),
            kind: candidate.kind,
            content: candidate.content,
            source: 'auto:conversation',
            confidence: 'user_approved',
            tags: candidate.tags,
            ...(candidate.slot ? { slot: candidate.slot } : {}),
            ...(candidate.replaceSlot ? { replaceSlot: true } : {}),
          });
          if (!saved.duplicate || candidate.replaceSlot) memorySnapshots.invalidateProject(projectId());
          audit.record('system', saved.duplicate ? 'Automatic memory already existed' : 'Automatic memory saved', 'ok', `${saved.memory.id} · ${candidate.kind}`);
        } catch {
          audit.record('system', 'Automatic memory was not saved', 'error', 'The candidate failed local validation or persistence.');
        }
      }
    }
    streamConversations.set(requestId, { conversationId: record.id, content: '' });
    broadcastActiveConversation();

    // Fire and forget: progress arrives via chat:stream. The handler returns
    // the id immediately so the UI can pair events with this request.
    // The operating mode is owned by the main process. The renderer's copy is
    // advisory: trusting it would let a compromised renderer claim Agent mode.
    const { history: _rendererHistory, conversationId: _rendererConversationId, ...turn } = request;
    void _rendererHistory;
    void _rendererConversationId;
    const trustedRequest: ChatRequest = {
      ...turn,
      mode: current.companion.mode,
      conversationId: record.id,
      history: priorHistory,
    };
    if (request.mode !== current.companion.mode) {
      audit.record('system', 'Ignored renderer-supplied mode', 'denied', `${String(request.mode)} -> ${current.companion.mode}`);
    }

    const runOptions = {
      requestId,
      request: trustedRequest,
      model: current.provider.primaryModel,
      thinking: current.provider.thinking ?? DEFAULT_THINKING,
      temperature: current.provider.temperature,
      maxTokens: current.provider.maxTokens,
    };
    const activeRunner = resolveRuntimeEngine() === 'python' ? pythonRunner : agent;
    void activeRunner.run(runOptions).then((result) => {
      if (!current.privacy.automaticMemory || !hasVerifiedTaskOutcome(result.task)) return;
      const verified = result.task.steps.filter((step) => step.status === 'verified').slice(0, 2);
      if (verified.length === 0) return;
      const title = redactTaskText(result.task.title).replace(/\s+/g, ' ').trim().slice(0, 220);
      const evidence = verified.map((step) => redactTaskText(step.detail ?? step.title).replace(/\s+/g, ' ').trim().slice(0, 100)).filter(Boolean);
      const content = `Completed task: ${title}. Verified: ${evidence.join('; ')}.`.slice(0, 500);
      if (!title || looksLikeCredential(content)) return;
      try {
        const saved = memoryStore.saveAutomatic({
          projectId: record.projectId ?? projectId(),
          kind: 'outcome',
          content,
          source: `auto:verified-task:${result.task.id}`,
          confidence: 'source_backed',
          tags: ['automatic', 'verified-task'],
        });
        audit.record('system', saved.duplicate ? 'Verified task outcome already existed' : 'Verified task outcome saved', 'ok', `${saved.memory.id} · ${result.task.id}`);
      } catch {
        audit.record('system', 'Verified task outcome was not saved', 'error', result.task.id);
      }
    }).catch(() => undefined);

    return { requestId, persistence: record.persistence ?? 'persistent' };
  });

  registerHandler(CHANNELS.chatCancel, (_event, requestId: string): void => {
    agent.cancel('user');
    pythonRunner.cancel('user');
    conversation.abort();
    permissions.rejectPending();
    audit.record('model', 'Generation cancelled', 'cancelled', requestId);
  });

  /* ----------------------------- history ----------------------------- */

  registerHandler(CHANNELS.historyList, (_event, query?: HistoryQuery): ConversationSummary[] => {
    const safeQuery = query && typeof query === 'object' ? query : {};
    const limit = typeof safeQuery.limit === 'number' ? Math.max(1, Math.min(50, Math.floor(safeQuery.limit))) : 30;
    const offset = typeof safeQuery.offset === 'number' ? Math.max(0, Math.min(50, Math.floor(safeQuery.offset))) : 0;
    const search = typeof safeQuery.search === 'string' ? safeQuery.search.slice(0, 120) : '';
    const persisted = history.list({ limit: 50, search, projectId: projectId() });
    const session = [...sessionConversations.values()]
      .filter((record) => !record.projectId || record.projectId === projectId())
      .map(toSessionSummary)
      .filter((summary) => !search || `${summary.title} ${summary.preview}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const merged = new Map<string, ConversationSummary>();
    for (const summary of persisted) merged.set(summary.id, summary);
    for (const summary of session) merged.set(summary.id, summary);
    return [...merged.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(offset, offset + limit);
  });

  registerHandler(CHANNELS.historyOpen, (_event, id: string): ConversationRecordView | null => {
    if (isAgentBusy()) throw new Error('Cancel or finish the active task before switching conversations.');
    if (typeof id !== 'string') return null;
    const record = getConversation(id);
    if (!record || (record.projectId && record.projectId !== projectId())) return null;
    activeConversationId = record.id;
    broadcastActiveConversation();
    return toRecordView(record);
  });

  registerHandler(CHANNELS.historyCreate, (): ConversationRecordView => {
    if (isAgentBusy()) throw new Error('Cancel or finish the active task before starting a new conversation.');
    return toRecordView(newConversation());
  });

  registerHandler(CHANNELS.historyGetActive, (): ConversationRecordView | null => {
    if (!activeConversationId) return toRecordView(newConversation());
    const record = getConversation(activeConversationId);
    return record ? toRecordView(record) : toRecordView(newConversation());
  });

  registerHandler(CHANNELS.historyRename, (_event, id: string, title: string): ConversationSummary | null => {
    if (typeof id !== 'string' || typeof title !== 'string') return null;
    const record = getConversation(id);
    if (!record || (record.projectId && record.projectId !== projectId())) return null;
    const safeTitle = redactTaskText(title.replace(/\s+/g, ' ').trim()).slice(0, 80);
    if (!safeTitle) return null;
    record.title = safeTitle;
    saveConversation(record);
    broadcastActiveConversation();
    return toSessionSummary(record);
  });

  registerHandler(CHANNELS.historyDelete, (_event, id: string): boolean => {
    if (isAgentBusy()) throw new Error('Cancel or finish the active task before deleting a conversation.');
    if (typeof id !== 'string') return false;
    const record = getConversation(id);
    if (!record || (record.projectId && record.projectId !== projectId())) return false;
    sessionConversations.delete(id);
    history.delete(id);
    try { sessionSearchIndex.deleteConversation(id); } catch { /* ignore */ }
    memorySnapshots.invalidateConversation(id);
    if (activeConversationId === id) {
      activeConversationId = null;
    }
    broadcastActiveConversation();
    return true;
  });

  registerHandler(CHANNELS.historyClear, (): void => {
    if (isAgentBusy()) throw new Error('Cancel or finish the active task before clearing chat history.');
    history.clear();
    try { sessionSearchIndex.clearAll(); } catch { /* ignore */ }
    memorySnapshots.clearAll();
    sessionConversations.clear();
    activeConversationId = null;
    broadcastActiveConversation();
    audit.record('system', 'History cleared', 'ok');
  });

  registerHandler(CHANNELS.browserOpenSearch, async (_event, queryValue: unknown, requestTextValue: unknown, conversationIdValue: unknown) => {
    if (isAgentBusy()) throw new Error('Finish or cancel the active task before opening a browser search.');
    if (typeof queryValue !== 'string' || queryValue.trim().length === 0 || queryValue.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new Error('Enter a search query with 1–500 characters.');
    }
    if (typeof requestTextValue !== 'string' || requestTextValue.length > 20_000 || typeof conversationIdValue !== 'string') {
      throw new Error('The search request is invalid.');
    }
    if (conversationIdValue !== activeConversationId) throw new Error('Reopen the selected conversation before searching.');
    const record = getConversation(conversationIdValue);
    if (!record || (record.projectId && record.projectId !== projectId())) throw new Error('The selected conversation is unavailable.');

    const provider = settings.get().browserSearchProvider as SearchProvider;
    const url = createSearchUrl(queryValue, provider);
    const userText = redactTaskText(requestTextValue.trim()).slice(0, 20_000);
    addTranscriptMessage(record, {
      id: `search_${Date.now().toString(36)}_user`,
      role: 'user',
      content: userText || `Search for ${queryValue.trim()}`,
      createdAt: Date.now(),
    });
    try {
      const safeUrl = safeExternalHttpUrl(url);
      if (!safeUrl) throw new Error('Pixel could not create a safe browser search URL.');
      await shell.openExternal(safeUrl);
      addTranscriptMessage(record, {
        id: `search_${Date.now().toString(36)}_assistant`,
        role: 'assistant',
        content: `Opened search results for ${queryValue.trim()} in your default browser.`,
        createdAt: Date.now(),
      });
      return { query: queryValue.trim(), provider };
    } catch {
      addTranscriptMessage(record, {
        id: `search_${Date.now().toString(36)}_assistant`,
        role: 'assistant',
        content: 'Pixel could not open search results in your default browser.',
        createdAt: Date.now(),
        error: 'Default browser launch failed.',
      });
      throw new Error('Pixel could not open search results in your default browser.');
    }
  });

  /* ------------------------------ screen ----------------------------- */

  registerHandler(CHANNELS.screenListDisplays, () => captures.listDisplays());
  registerHandler(CHANNELS.screenListExternalWindows, () => captures.listExternalWindows());
  registerHandler(CHANNELS.screenCaptureActiveWindow, () => captures.captureActiveWindow());
  registerHandler(CHANNELS.screenCaptureLastExternalWindow, () => captures.captureLastExternalWindow());
  registerHandler(CHANNELS.screenCaptureSelectedWindow, (_event, target: ScreenWindowTarget) => {
    if (!target || typeof target.windowId !== 'string' || typeof target.title !== 'string' ||
      typeof target.processName !== 'string' || !Number.isInteger(target.pid)) {
      return {
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Select an exact current window target before capture.', retryable: false },
      } satisfies CaptureResult;
    }
    return captures.captureSelectedWindow(target);
  });
  registerHandler(CHANNELS.screenCaptureDisplay, (_event, displayId?: string) =>
    captures.captureDisplay(displayId),
  );
  registerHandler(
    CHANNELS.screenCaptureRegion,
    (_event, region: { x: number; y: number; width: number; height: number }) =>
      captures.captureRegion(region),
  );

  /* ------------------------------- board ----------------------------- */

  const requireWorkspaceBoardSender = (event: IpcMainInvokeEvent): void => {
    if (!windows.isWorkspaceSender(event.sender)) throw new Error('Pixel Board is available only from the trusted Workspace window.');
  };

  registerHandler(CHANNELS.boardGetState, (event) => {
    requireWorkspaceBoardSender(event);
    return boardService.getSnapshot();
  });
  registerHandler(CHANNELS.boardApply, (event, operations: BoardOperation[], expectedRevision?: number) => {
    requireWorkspaceBoardSender(event);
    return boardService.apply(operations, Number.isSafeInteger(expectedRevision) ? expectedRevision : undefined);
  });
  registerHandler(CHANNELS.boardCreate, (event, title: string, replace?: boolean, expectedRevision?: number) => {
    requireWorkspaceBoardSender(event);
    return boardService.create(title, replace === true, Number.isSafeInteger(expectedRevision) ? expectedRevision : undefined);
  });
  registerHandler(CHANNELS.boardImportLegacyDraft, (event, document: PixelBoardDocument) => {
    requireWorkspaceBoardSender(event);
    return boardService.importLegacyDraft(document);
  });
  registerHandler(CHANNELS.boardUndo, (event, expectedRevision?: number) => {
    requireWorkspaceBoardSender(event);
    return boardService.undo(Number.isSafeInteger(expectedRevision) ? expectedRevision : undefined);
  });
  registerHandler(CHANNELS.boardRedo, (event, expectedRevision?: number) => {
    requireWorkspaceBoardSender(event);
    return boardService.redo(Number.isSafeInteger(expectedRevision) ? expectedRevision : undefined);
  });
  registerHandler(CHANNELS.boardOpen, async (event) => {
    requireWorkspaceBoardSender(event);
    try {
      const chosen = await chooseBoardFile('open', 'pixelboard', boardService.getSnapshot().document.title);
      if (!chosen) return { ok: true, cancelled: true };
      const snapshot = boardService.openFromFile(chosen.path, chosen.replace === true);
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Pixel could not open that Board.' };
    }
  });
  registerHandler(CHANNELS.boardSave, async (event, format: BoardFileFormat) => {
    requireWorkspaceBoardSender(event);
    if (format !== 'pixelboard' && format !== 'svg') return { ok: false, error: 'Choose an editable Pixel Board or SVG export.' };
    try {
      const chosen = await chooseBoardFile('save', format, boardService.getSnapshot().document.title);
      if (!chosen) return { ok: true, cancelled: true };
      return { ok: true, ...boardService.saveToFile(chosen.path, format, chosen.overwrite === true) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Pixel could not save the Board.' };
    }
  });

  /* ------------------------------ system ----------------------------- */

  registerHandler(CHANNELS.systemDiagnostics, async (): Promise<DiagnosticsSnapshot> => readSystemDiagnostics());

  registerHandler(CHANNELS.systemEmergencyStop, (): EmergencyStopReport => {
    return emergency.trigger();
  });
  registerHandler(CHANNELS.systemIsEmergencyStopped, (): boolean => emergency.isStopped());
  registerHandler(CHANNELS.systemEmergencyClear, (): void => {
    emergency.clear();
  });

  /* --------------------------- permissions --------------------------- */

  registerHandler(CHANNELS.permissionsRespond, (_event, decision: PermissionDecision): void => {
    if (!decision || typeof decision.requestId !== 'string') return;
    permissions.respond({
      requestId: decision.requestId,
      approved: Boolean(decision.approved),
      duration: decision.duration ?? 'once',
    });
  });

  registerHandler(CHANNELS.permissionsListPending, (): PermissionRequest[] => permissions.pendingRequests());

  registerHandler(CHANNELS.permissionsListActiveGrants, (): PermissionGrant[] =>
    permissions.activeGrants(),
  );

  registerHandler(CHANNELS.permissionsRevokeGrant, (_event, grantId: string): boolean =>
    typeof grantId === 'string' && grantId.length <= 160 && permissions.revokeGrant(grantId),
  );

  registerHandler(CHANNELS.permissionsClearExpired, (): number => permissions.clearExpiredGrants());

  registerHandler(CHANNELS.permissionsRevokeAll, (): number => {
    const count = permissions.revokeAll();
    audit.record('permission', 'All permissions revoked', 'ok', `${count} grant(s)`);
    return count;
  });

  /* ------------------------------- tasks ----------------------------- */

  registerHandler(CHANNELS.tasksList, (): ReturnType<TaskManager['list']> => tasks.list());
  registerHandler(CHANNELS.tasksPause, (_event, taskId: string): void => tasks.pause(taskId));
  registerHandler(CHANNELS.tasksResume, (_event, taskId: string): void => tasks.resume(taskId));
  registerHandler(CHANNELS.tasksCancel, (_event, taskId: string): void => tasks.cancel(taskId));
  registerHandler(CHANNELS.tasksContinueAfterHandoff, (_event, taskId: string): boolean =>
    tasks.continueAfterHandoff(taskId),
  );

  /* ------------------------------- voice ----------------------------- */

  registerHandler(CHANNELS.voiceCapability, () => voice.capability());
  registerHandler(CHANNELS.voiceModelsList, () => voiceModelManager.list());
  registerHandler(CHANNELS.voiceVoicesList, () => voice.installedSystemVoices());
  registerHandler(CHANNELS.voiceModelDownload, async (_event, id: VoiceModelInfo['id']) => {
    const result = await voiceModelManager.download(String(id));
    audit.record('system', result.ok ? 'Voice model download completed' : 'Voice model download failed', result.ok ? 'ok' : 'error');
    return result;
  });
  registerHandler(CHANNELS.voiceModelCancelDownload, () => voiceModelManager.cancelDownload());
  registerHandler(CHANNELS.voiceModelRemove, async (_event, id: VoiceModelInfo['id']) => {
    if (voice.hasActiveOperations() || pythonWorker.hasPendingRequests) return { ok: false, error: 'Stop the current voice operation before removing a model.' };
    if (pythonWorker.isRunning) {
      const unloaded = await pythonWorker.unloadVoiceModels();
      if (!unloaded.ok || !unloaded.result.unloaded) return { ok: false, error: 'Pixel could not safely unload the active voice model.' };
    }
    const result = await voiceModelManager.remove(String(id));
    if (result.ok) audit.record('system', 'Voice model removed', 'ok');
    return result;
  });

  registerHandler(CHANNELS.voiceCaptureAcquire, (event): boolean => {
    if (activePtt || (manualVoiceCaptureOwner !== null && manualVoiceCaptureOwner !== event.sender.id)) return false;
    manualVoiceCaptureOwner = event.sender.id;
    event.sender.once('destroyed', () => {
      if (manualVoiceCaptureOwner === event.sender.id) manualVoiceCaptureOwner = null;
    });
    return true;
  });

  registerHandler(CHANNELS.voiceCaptureRelease, (event): boolean => {
    if (manualVoiceCaptureOwner !== event.sender.id) return false;
    manualVoiceCaptureOwner = null;
    return true;
  });

  const cancelVoiceCapture = (): void => {
    manualVoiceCaptureOwner = null;
    context.sendToRenderer(CHANNELS.voiceCaptureCancel, {});
  };

  const isMainRenderer = (event: IpcMainInvokeEvent): boolean =>
    windows.getMainWindow()?.webContents === event.sender;

  registerHandler(CHANNELS.voicePttCaptureReady, (event, sessionId: number, error?: string): boolean => {
    if (!isMainRenderer(event)) return false;
    const session = activePtt;
    if (!session || session.id !== sessionId) return false;
    if (error) {
      cancelPttSession('failed', error.slice(0, 300));
      return false;
    }
    if (session.released || session.captureReady || session.controller.signal.aborted) return false;
    session.captureReady = true;
    notifyPtt('recording', undefined, session.id);
    return true;
  });

  registerHandler(CHANNELS.voicePttTranscribe, async (event, sessionId: number, audio: Uint8Array): Promise<{ ok: boolean; error?: string }> => {
    if (!isMainRenderer(event)) {
      return { ok: false, error: 'Push-to-talk audio must come from Pixel’s companion window.' };
    }
    const session = activePtt;
    if (!session || session.id !== sessionId || !session.released || session.transcribing || session.controller.signal.aborted) {
      return { ok: false, error: 'This push-to-talk session is no longer active.' };
    }
    if (session.releaseTimer) clearTimeout(session.releaseTimer);
    session.releaseTimer = null;
    session.transcribing = true;
    notifyPtt('transcribing', undefined, session.id);

    const result = await voice.transcribeWav(audio, session.controller.signal, settings.get().voice.sttModel);
    if (activePtt !== session || session.controller.signal.aborted) {
      return { ok: false, error: 'Transcription was cancelled.' };
    }
    activePtt = null;
    if (!result.ok || result.text.trim().length < 2) {
      const detail = result.noSpeech
        ? 'Pixel did not hear speech. Hold Ctrl+Shift+Space while speaking, then release.'
        : result.error ?? 'Pixel could not transcribe that recording. Nothing was submitted.';
      notifyPtt('failed', detail, session.id);
      audit.record('system', 'Push-to-talk did not produce a usable transcript', 'error');
      return { ok: false, error: detail };
    }

    const transcript = result.text.trim().replace(/\s+/g, ' ');
    audit.record('system', 'Push-to-talk instruction transcribed', 'ok', `${transcript.length} characters`);
    notifyPtt('submitting', undefined, session.id);
    context.sendToMainRenderer?.(CHANNELS.voicePttSubmit, { sessionId: session.id, text: transcript });
    return { ok: true };
  });

  registerHandler(CHANNELS.voiceTranscribeWav, async (_event, audio: Uint8Array): Promise<RecognitionResult> => {
    const result = await voice.transcribeWav(audio, undefined, settings.get().voice.sttModel);
    if (result.ok) audit.record('system', 'Voice input transcribed', 'ok', `${result.text.length} characters`);
    else if (result.noSpeech) audit.record('system', 'Voice input: no speech detected', 'ok');
    else audit.record('system', 'Voice input failed', 'error', result.error);
    return result;
  });

  registerHandler(CHANNELS.voiceSaveDiagnosticWav, async (event, audio: Uint8Array): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> => {
    // This opt-in export is deliberately short and accepts only validated
    // mono 16 kHz PCM. The caller receives no filesystem path.
    if (!windows.isSettingsSender(event.sender) && !windows.isWorkspaceSender(event.sender)) {
      return { ok: false, error: 'Diagnostic audio export is only available from Settings or Workspace.' };
    }
    const validation = validateDiagnosticVoiceWav(audio);
    if (validation) return { ok: false, error: validation };
    const result = await dialog.showSaveDialog({
      title: 'Save Pixel voice diagnostic recording',
      defaultPath: 'pixel-voice-diagnostic.wav',
      filters: [{ name: 'WAV audio', extensions: ['wav'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
    try {
      writeFileSync(result.filePath, Buffer.from(audio), { flag: 'w', mode: 0o600 });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Pixel could not save the diagnostic recording at that location.' };
    }
  });

  registerHandler(CHANNELS.voiceListen, async (_event, timeoutMs?: number) => {
    const result = await voice.listen(
      typeof timeoutMs === 'number' ? { timeoutMs } : {},
    );
    if (result.ok) {
      audit.record('system', 'Voice input transcribed', 'ok', `${result.text.length} characters`);
    } else if (result.noSpeech) {
      audit.record('system', 'Voice input: no speech detected', 'ok');
    } else {
      audit.record('system', 'Voice input failed', 'error', result.error);
    }
    return result;
  });

  registerHandler(CHANNELS.voiceCancel, (): number => {
    const cancelled = voice.cancelAll();
    cancelPttSession('cancelled');
    audit.record('system', 'Voice operation cancelled', 'cancelled', `${cancelled} worker(s)`);
    return cancelled;
  });

  registerHandler(CHANNELS.voiceSpeak, async (_event, text: string) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'There is nothing to say.' };
    }
    const result = await voice.speak(text, settings.get().voice, (speaking) => {
      context.sendToRenderer(CHANNELS.voicePlaybackState, speaking);
    });
    audit.record('system', result.ok ? 'Spoke a reply' : 'Speech failed', result.ok ? 'ok' : 'error');
    return result;
  });
  registerHandler(CHANNELS.voicePlaybackGet, () => voice.isPlaybackActive());

  /* ------------------------------- audit ----------------------------- */

  registerHandler(CHANNELS.auditList, (_event, limit?: number): AuditEntry[] =>
    audit.list(typeof limit === 'number' ? limit : 100),
  );
  registerHandler(CHANNELS.toolsList, (): ToolCatalogEntry[] => {
    const native = context.nativeHelper.available();
    const python = pythonWorker.availability();
    return toolRegistry.list().map((tool) => {
      const entry: ToolCatalogEntry = {
        name: tool.name,
        description: tool.description,
        category: tool.category,
        risk: tool.risk,
        requiresApproval: tool.requiresApproval,
        changesState: tool.changesState,
        availability: 'ready',
      };
      if (tool.category === 'screen' || tool.category === 'input') {
        entry.availability = native.available ? 'conditional' : 'unavailable';
        entry.dependency = 'PixelNative executable (health checked when used)';
        if (!native.available) entry.availabilityReason = native.reason;
      } else if (tool.name.startsWith('browser_')) {
        entry.availability = 'not_checked';
        entry.dependency = 'Playwright Chromium (checked when first used)';
      } else if (tool.name === 'documents_index') {
        entry.availability = python.available ? 'conditional' : 'unavailable';
        entry.dependency = 'Python executable and document worker (checked when used)';
        if (!python.available) entry.availabilityReason = python.reason;
      }
      return entry;
    });
  });
  registerHandler(CHANNELS.pluginsList, (): PluginView[] => pluginStore.list(projectId()));
  const revokePluginPermissions = (pluginId: string, manifest: ReturnType<typeof pluginStore.manifest>): void => {
    if (!manifest) return;
    for (const tool of manifest.tools) permissions.revokeForTool(tool.name);
    audit.record('system', `Cleared permissions for Pixel plugin ${pluginId}`, 'ok', 'Pending approvals and stored grants were revoked.');
  };
  registerHandler(CHANNELS.pluginsInstall, (_event, pluginId: string): PluginView[] => {
    pluginStore.install(pluginId);
    audit.record('system', `Installed Pixel plugin ${pluginId}`, 'ok', 'Bundled, declarative plugin; no external code was executed.');
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsUpdate, (_event, pluginId: string): PluginView[] => {
    const manifest = pluginStore.manifest(pluginId);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    pluginStore.update(pluginId);
    revokePluginPermissions(pluginId, manifest);
    for (const tool of manifest.tools) toolRegistry.unregister(tool.name);
    audit.record('system', `Updated Pixel plugin ${pluginId}`, 'ok', 'Updated from the bundled reviewed manifest; plugin remains disabled pending explicit re-enable.');
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsUninstall, (_event, pluginId: string): PluginView[] => {
    const manifest = pluginStore.manifest(pluginId);
    revokePluginPermissions(pluginId, manifest);
    pluginStore.uninstall(pluginId);
    if (manifest) for (const tool of manifest.tools) toolRegistry.unregister(tool.name);
    audit.record('system', `Uninstalled Pixel plugin ${pluginId}`, 'ok');
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsSetEnabled, (_event, pluginId: string, enabled: boolean): PluginView[] => {
    if (typeof enabled !== 'boolean') throw new Error('Plugin enabled state must be true or false.');
    const manifest = pluginStore.manifest(pluginId);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    if (enabled) {
      const current = pluginStore.list(projectId()).find((item) => item.id === pluginId);
      if (current?.enabled) return pluginStore.list(projectId());
      for (const tool of manifest.tools) {
        const existing = toolRegistry.get(tool.name);
        if (existing) {
          throw new Error(`Plugin tool name conflicts with an existing Pixel capability: ${tool.name}`);
        }
      }
    }
    if (!enabled) revokePluginPermissions(pluginId, manifest);
    pluginStore.setEnabled(pluginId, enabled);
    for (const tool of manifest.tools) {
      if (enabled) toolRegistry.register(tool);
      else toolRegistry.unregister(tool.name);
    }
    audit.record('system', `${enabled ? 'Enabled' : 'Disabled'} Pixel plugin ${pluginId}`, 'ok', `Registered tools: ${manifest.tools.map((tool) => tool.name).join(', ')}`);
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsSetProjectAvailability, (_event, pluginId: string, availability: 'inherit' | 'enabled' | 'disabled'): PluginView[] => {
    const manifest = pluginStore.manifest(pluginId);
    if (!manifest) throw new Error('This plugin is not in Pixel’s reviewed catalog.');
    pluginStore.setProjectAvailability(pluginId, projectId(), availability);
    revokePluginPermissions(pluginId, manifest);
    audit.record('system', `Changed project plugin availability for ${pluginId}`, 'ok', `Project ${projectId()}; setting ${availability}; existing grants cleared.`);
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsSetSetting, (_event, pluginId: string, key: string, value: string): PluginView[] => {
    pluginStore.setSetting(pluginId, key, value);
    audit.record('system', `Changed a setting for Pixel plugin ${pluginId}`, 'ok', `Setting ${key} was changed through its reviewed manifest.`);
    return pluginStore.list(projectId());
  });
  registerHandler(CHANNELS.pluginsGitHubStatus, async (): Promise<GitHubConnectionStatus> => {
    const encryptionAvailable = settings.isEncryptionAvailable();
    const token = settings.getGitHubToken();
    if (!token) return { connected: false, encryptionAvailable };
    try {
      const profile = await verifyGitHubToken(token);
      return {
        connected: true,
        encryptionAvailable,
        verified: true,
        login: profile.login,
        name: profile.name,
        scopes: profile.scopes,
      };
    } catch (error) {
      return {
        connected: true,
        encryptionAvailable,
        verified: false,
        error: error instanceof Error ? error.message : 'Unable to verify GitHub token.',
      };
    }
  });
  registerHandler(CHANNELS.pluginsGitHubConnect, async (_event, tokenValue: unknown): Promise<GitHubConnectionStatus> => {
    const encryptionAvailable = settings.isEncryptionAvailable();
    const token = typeof tokenValue === 'string' ? tokenValue.trim() : '';
    if (!token) return { connected: false, encryptionAvailable, error: 'Enter a GitHub personal access token.' };
    try {
      const profile = await verifyGitHubToken(token);
      const saved = settings.setGitHubToken(token);
      if (!saved.ok) {
        return { connected: false, encryptionAvailable, error: saved.error ?? 'Could not store GitHub token.' };
      }
      audit.record('system', 'Connected GitHub account', 'ok', `@${profile.login} · scopes: ${profile.scopes.join(', ') || 'fine-grained'}`);
      return {
        connected: true,
        encryptionAvailable,
        verified: true,
        login: profile.login,
        name: profile.name,
        scopes: profile.scopes,
      };
    } catch (error) {
      audit.record('system', 'GitHub account connection failed', 'error');
      return {
        connected: false,
        encryptionAvailable,
        verified: false,
        error: error instanceof Error ? error.message : 'GitHub token verification failed.',
      };
    }
  });
  registerHandler(CHANNELS.pluginsGitHubDisconnect, (): GitHubConnectionStatus => {
    settings.clearGitHubToken();
    audit.record('system', 'Disconnected local GitHub token', 'ok', 'Removed encrypted local token; revoke on github.com separately if desired.');
    return { connected: false, encryptionAvailable: settings.isEncryptionAvailable() };
  });

  /* ----------------------- procedural skills ------------------------- */

  registerHandler(CHANNELS.proceduralSkillsList, (): ProceduralSkillView[] =>
    proceduralSkillStore.list(projectId()),
  );
  registerHandler(CHANNELS.proceduralSkillsCreateDraft, (_event, markdown: unknown): ProceduralSkillView => {
    if (typeof markdown !== 'string') throw new Error('SKILL.md markdown text is required.');
    const draft = proceduralSkillStore.createDraft({ projectId: projectId(), markdown, source: 'user:settings' });
    audit.record('system', `Created procedural skill draft ${draft.name} v${draft.version}`, 'ok', `scan=${draft.scanStatus}`);
    return draft;
  });
  registerHandler(CHANNELS.proceduralSkillsActivate, (_event, id: string): ProceduralSkillView => {
    const active = proceduralSkillStore.activate(id);
    audit.record('system', `Activated procedural skill ${active.name} v${active.version}`, 'ok');
    return active;
  });
  registerHandler(CHANNELS.proceduralSkillsDisable, (_event, id: string): ProceduralSkillView => {
    const disabled = proceduralSkillStore.setDisabled(id);
    audit.record('system', `Disabled procedural skill ${disabled.name} v${disabled.version}`, 'ok');
    return disabled;
  });
  registerHandler(CHANNELS.proceduralSkillsSetPinned, (_event, id: string, pinned: boolean): ProceduralSkillView => {
    const updated = proceduralSkillStore.setPinned(id, Boolean(pinned));
    audit.record('system', `${updated.pinned ? 'Pinned' : 'Unpinned'} procedural skill ${updated.name}`, 'ok');
    return updated;
  });
  registerHandler(CHANNELS.proceduralSkillsDelete, (_event, id: string): boolean => {
    const deleted = proceduralSkillStore.delete(id);
    if (deleted) audit.record('system', `Deleted procedural skill ${id}`, 'ok');
    return deleted;
  });

  /* ----------------------- MCP & Google Calendar --------------------- */

  registerHandler(CHANNELS.mcpServersList, (): McpServerSummaryView[] =>
    mcpManager!.listServers(),
  );
  registerHandler(CHANNELS.mcpServersAdd, (_event, input: Parameters<McpServerManager['addServer']>[0]): McpServerSummaryView => {
    const created = mcpManager!.addServer(input);
    audit.record('system', `Added MCP server ${created.id} (${created.transport})`, 'ok', created.trustTier);
    return created;
  });
  registerHandler(CHANNELS.mcpServersEnable, async (_event, id: string): Promise<McpServerSummaryView> => {
    const view = await mcpManager!.enableServer(id);
    audit.record('system', `Enabled MCP server ${id}`, 'ok', `${view.toolCount} tool(s) discovered`);
    return view;
  });
  registerHandler(CHANNELS.mcpServersDisable, async (_event, id: string): Promise<McpServerSummaryView> => {
    const view = await mcpManager!.disableServer(id);
    audit.record('system', `Disabled MCP server ${id}`, 'ok', 'Connections closed and tool grants revoked.');
    return view;
  });
  registerHandler(CHANNELS.mcpServersSetProjects, (_event, id: string, allowedProjects: string[]): McpServerSummaryView => {
    const view = mcpManager!.setAllowedProjects(id, allowedProjects);
    audit.record('system', `Updated project scope for MCP server ${id}`, 'ok', view.allowedProjects.join(', '));
    return view;
  });
  registerHandler(CHANNELS.mcpServersRemove, async (_event, id: string): Promise<boolean> => {
    const removed = await mcpManager!.removeServer(id);
    if (removed) audit.record('system', `Removed MCP server ${id}`, 'ok');
    return removed;
  });
  registerHandler(CHANNELS.googleCalendarStatus, (): GoogleCalendarConnectionStatus => {
    const token = readGoogleCalendarToken();
    const oauthClientConfigured = Boolean(process.env.PIXEL_GOOGLE_OAUTH_CLIENT_ID?.trim());
    return {
      connected: Boolean(token),
      encryptionAvailable: settings.isEncryptionAvailable(),
      oauthClientConfigured,
      ...(token ? { scopes: token.scopes, expiresAt: token.expiresAt } : {}),
    };
  });
  registerHandler(CHANNELS.googleCalendarDisconnect, (): GoogleCalendarConnectionStatus => {
    settings.clearProviderSecret('google-calendar');
    audit.record('system', 'Disconnected local Google Calendar OAuth credentials', 'ok');
    return {
      connected: false,
      encryptionAvailable: settings.isEncryptionAvailable(),
      oauthClientConfigured: Boolean(process.env.PIXEL_GOOGLE_OAUTH_CLIENT_ID?.trim()),
    };
  });

  /* -------------------------------- app ------------------------------ */

  registerHandler(CHANNELS.appGetVersion, (): string => app.getVersion());

  registerHandler(CHANNELS.appQuit, (): void => {
    context.onQuit();
  });

  // Audit the start so the trail always has a first line.
  audit.record('system', 'Pixel started', 'ok', `version ${app.getVersion()}`);

  return {
    emergency,
    tasks,
    routines,
    startPushToTalk,
    endPushToTalk,
    cancelVoiceCapture,
    shutdown: () => {
      routines.stop();
      cancelPttSession('cancelled');
      voice.cancelAll();
      void pythonWorker.shutdown();
      void pythonAgentBridge.dispose();
      void mcpManager?.disposeAll();
      executors.killAll();
      nativeHelper.dispose();
    },
  };
}
