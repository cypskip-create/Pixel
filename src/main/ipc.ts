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

import { app, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AppSettings,
  AuditEntry,
  CaptureResult,
  ChatMessage,
  ChatRequest,
  ConnectionTestResult,
  DeepSeekSettingsPatch,
  DiagnosticsSnapshot,
  EmergencyStopReport,
  PermissionDecision,
  PermissionGrant,
  StreamEvent,
  Surface,
} from '../shared/types';
import { DEFAULT_THINKING } from '../shared/types';
import { CHANNELS } from '../shared/channels';
import { ConversationEngine } from './agent/conversation';
import { AgentExecutor } from './agent/executor';
import { ToolExecutors } from './agent/executors';
import { BrowserSession } from './agent/browser';
import { VoiceService } from './voice/voice';
import { VISION_MODEL } from '../shared/types';
import {
  AuditLog,
  EmergencyController,
  PermissionBroker,
  TaskManager,
} from './agent/runtime';
import { ToolRegistry } from './agent/tools';
import { HistoryStore } from './history/store';
import type { ModelProvider } from './providers/deepseek';
import { SettingsStore } from './settings';
import { collectDiagnostics } from './system/diagnostics';
import type { WindowManager } from './window';

export interface IpcContext {
  settings: SettingsStore;
  windows: WindowManager;
  provider: ModelProvider;
  captures: {
    isAuthorized: () => boolean;
    listDisplays: () => DiagnosticsSnapshot['displays'];
    captureActiveWindow: () => Promise<CaptureResult>;
    captureDisplay: (displayId?: string) => Promise<CaptureResult>;
    captureRegion: (region: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<CaptureResult>;
  };
  /** Request the UI's permission prompt surfaces. */
  sendToRenderer: (channel: string, payload: unknown) => void;
  onQuit: () => void;
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
    try {
      const path = join(this.dir, `${key}.json`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value, 'utf8');
    } catch {
      // History is a convenience; losing a write must not break a conversation.
    }
  }
}

export function registerIpcHandlers(context: IpcContext): {
  emergency: EmergencyController;
  tasks: TaskManager;
} {
  const { settings, windows, provider, captures } = context;

  const audit = new AuditLog();
  const toolRegistry = new ToolRegistry();
  const tasks = new TaskManager((task) =>
    context.sendToRenderer(CHANNELS.tasksUpdate, task),
  );
  const permissions = new PermissionBroker(toolRegistry, audit, (request) =>
    context.sendToRenderer(CHANNELS.permissionsRequest, request),
  );

  /** Tool names that finished before the stop, for an honest report. */
  const completedActions: string[] = [];

  const conversation: ConversationEngine = new ConversationEngine({
    provider,
    getApiKey: () => settings.getApiKey(),
    isStopped: (): boolean => emergency.isStopped(),
    emit: (event: StreamEvent) => context.sendToRenderer(CHANNELS.chatStream, event),
    toolsFor: (mode) => toolRegistry.schemasFor(mode),
  });

  const emergency: EmergencyController = new EmergencyController({
    registry: toolRegistry,
    permissions,
    tasks,
    audit,
    abortStream: (): boolean => {
      const wasRunning: boolean = conversation.isRunning;
      conversation.abort();
      agent.cancel('stop');
      return wasRunning;
    },
    killChildren: () => executors.killAll(),
    completedActions: () => [...completedActions],
    notify: (report) => context.sendToRenderer(CHANNELS.systemEmergencyStopEvent, report),
  });

  const history = new HistoryStore(new FileStorage(join(app.getPath('userData'), 'history')));
  const voice = new VoiceService();
  const executions = new FileStorage(join(app.getPath('userData'), 'executions'));

  /**
   * Vision analysis for the analyze_screen tool. Uses the vision-capable model
   * for a single, cheap, non-streaming turn.
   */
  const describeImage = async (
    image: { dataUrl: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; width: number; height: number; source: 'screenshot' | 'upload'; label?: string },
    question: string,
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
      signal: new AbortController().signal,
      timeoutMs: 60_000,
      onEvent: () => undefined,
    });
    return result.content || 'The screen was captured but nothing could be read from it.';
  };

  // One browser session per app run, closed by the emergency stop.
  const browser = new BrowserSession({ headless: true });

  const executors = new ToolExecutors({
    browser,
    captureDisplay: async () => {
      const result = await captures.captureDisplay();
      return result.ok && result.image ? result.image : null;
    },
    describeImage,
  });

  const agent = new AgentExecutor({
    engine: conversation,
    registry: toolRegistry,
    permissions,
    tasks,
    audit,
    executors,
    emit: (event: StreamEvent) => context.sendToRenderer(CHANNELS.chatStream, event),
    isStopped: () => emergency.isStopped(),
    persist: (task) => {
      // Keep the last 50 runs on disk for the audit trail across restarts.
      const existing = executions.read('runs');
      let runs: unknown[] = [];
      if (existing) {
        try {
          const parsed: unknown = JSON.parse(existing);
          if (Array.isArray(parsed)) runs = parsed;
        } catch {
          runs = [];
        }
      }
      runs.push(task);
      executions.write('runs', JSON.stringify(runs.slice(-50)));
    },
  });

  /* ----------------------------- settings ---------------------------- */

  ipcMain.handle(CHANNELS.settingsGet, (): AppSettings => settings.get());

  ipcMain.handle(CHANNELS.settingsSet, (_event, patch: DeepSeekSettingsPatch): AppSettings => {
    const next = settings.set(patch ?? {});
    audit.record('system', 'Settings updated', 'ok', Object.keys(patch ?? {}).join(', '));
    return next;
  });

  ipcMain.handle(CHANNELS.settingsSetApiKey, (_event, key: string) => {
    const result = settings.setApiKey(typeof key === 'string' ? key : '');
    audit.record('system', 'API key updated', result.ok ? 'ok' : 'error');
    return result;
  });

  ipcMain.handle(CHANNELS.settingsHasApiKey, (): boolean => settings.hasApiKey());

  ipcMain.handle(CHANNELS.settingsClearApiKey, (): void => {
    settings.clearApiKey();
    audit.record('system', 'API key removed', 'ok');
  });

  ipcMain.handle(
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

  ipcMain.handle(CHANNELS.windowSetSurface, (_event, surface: Surface): void => {
    windows.setSurface(surface);
  });

  ipcMain.handle(CHANNELS.windowSetExpanded, (_event, expanded: boolean): void => {
    windows.setSurface(expanded ? 'active' : 'idle');
  });

  ipcMain.handle(CHANNELS.windowSetPosition, (_event, x: number, y: number): void => {
    if (Number.isFinite(x) && Number.isFinite(y)) windows.moveTo(x, y);
  });

  ipcMain.handle(CHANNELS.windowGetPosition, () => windows.currentPosition());
  ipcMain.handle(CHANNELS.windowGetWorkArea, () => windows.workAreaFor());
  ipcMain.handle(CHANNELS.windowHide, (): void => windows.hide());
  ipcMain.handle(CHANNELS.windowShow, (): void => windows.show());

  ipcMain.handle(CHANNELS.windowOpenSettings, (): void => {
    windows.createSettingsWindow();
  });

  ipcMain.handle(CHANNELS.windowCloseSettings, (): void => windows.closeSettings());

  ipcMain.handle(CHANNELS.windowSetIgnoreMouseEvents, (_event, ignore: boolean): void => {
    windows.setIgnoreMouseEvents(Boolean(ignore));
  });

  /* ------------------------------- chat ------------------------------ */

  ipcMain.handle(CHANNELS.chatSend, async (_event, request: ChatRequest) => {
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const current = settings.get();

    // Fire and forget: progress arrives via chat:stream. The handler returns
    // the id immediately so the UI can pair events with this request.
    void agent.run({
      requestId,
      request,
      model: current.provider.primaryModel,
      thinking: current.provider.thinking ?? DEFAULT_THINKING,
      temperature: current.provider.temperature,
      maxTokens: current.provider.maxTokens,
    });

    return { requestId };
  });

  ipcMain.handle(CHANNELS.chatCancel, (_event, requestId: string): void => {
    agent.cancel('user');
    conversation.abort();
    permissions.rejectPending();
    audit.record('model', 'Generation cancelled', 'cancelled', requestId);
  });

  /* ----------------------------- history ----------------------------- */

  ipcMain.handle(CHANNELS.historyList, (_event, limit?: number): ChatMessage[] => {
    const record = history.loadMostRecent();
    if (!record) return [];
    const count = typeof limit === 'number' && limit > 0 ? limit : record.messages.length;
    return record.messages.slice(-count);
  });

  ipcMain.handle(CHANNELS.historyClear, (): void => {
    const record = history.loadMostRecent();
    if (record) history.save({ ...record, messages: [] });
    audit.record('system', 'History cleared', 'ok');
  });

  /* ------------------------------ screen ----------------------------- */

  ipcMain.handle(CHANNELS.screenListDisplays, () => captures.listDisplays());
  ipcMain.handle(CHANNELS.screenCaptureActiveWindow, () => captures.captureActiveWindow());
  ipcMain.handle(CHANNELS.screenCaptureDisplay, (_event, displayId?: string) =>
    captures.captureDisplay(displayId),
  );
  ipcMain.handle(
    CHANNELS.screenCaptureRegion,
    (_event, region: { x: number; y: number; width: number; height: number }) =>
      captures.captureRegion(region),
  );

  /* ------------------------------ system ----------------------------- */

  ipcMain.handle(CHANNELS.systemDiagnostics, (): DiagnosticsSnapshot => {
    const primary = windows.workAreaFor();
    const displays = captures.listDisplays();
    return collectDiagnostics(
      {
        now: () => Date.now(),
        getDisplays: () => displays,
      },
      displays.length > 0
        ? (displays.find((d) => d.bounds.x === primary.x && d.bounds.y === primary.y)?.id ??
            displays[0].id)
        : undefined,
    );
  });

  ipcMain.handle(CHANNELS.systemEmergencyStop, (): EmergencyStopReport => {
    return emergency.trigger();
  });

  /* --------------------------- permissions --------------------------- */

  ipcMain.handle(CHANNELS.permissionsRespond, (_event, decision: PermissionDecision): void => {
    if (!decision || typeof decision.requestId !== 'string') return;
    permissions.respond({
      requestId: decision.requestId,
      approved: Boolean(decision.approved),
      duration: decision.duration ?? 'once',
    });
  });

  ipcMain.handle(CHANNELS.permissionsListActiveGrants, (): PermissionGrant[] =>
    permissions.activeGrants(),
  );

  ipcMain.handle(CHANNELS.permissionsRevokeAll, (): number => {
    const count = permissions.revokeAll();
    audit.record('permission', 'All permissions revoked', 'ok', `${count} grant(s)`);
    return count;
  });

  /* ------------------------------- tasks ----------------------------- */

  ipcMain.handle(CHANNELS.tasksPause, (_event, taskId: string): void => tasks.pause(taskId));
  ipcMain.handle(CHANNELS.tasksResume, (_event, taskId: string): void => tasks.resume(taskId));
  ipcMain.handle(CHANNELS.tasksCancel, (_event, taskId: string): void => tasks.cancel(taskId));

  /* ------------------------------- voice ----------------------------- */

  ipcMain.handle(CHANNELS.voiceCapability, () => voice.capability());

  ipcMain.handle(CHANNELS.voiceListen, async (_event, timeoutMs?: number) => {
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

  ipcMain.handle(CHANNELS.voiceSpeak, async (_event, text: string) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'There is nothing to say.' };
    }
    const result = await voice.speak(text);
    audit.record('system', result.ok ? 'Spoke a reply' : 'Speech failed', result.ok ? 'ok' : 'error');
    return result;
  });

  /* ------------------------------- audit ----------------------------- */

  ipcMain.handle(CHANNELS.auditList, (_event, limit?: number): AuditEntry[] =>
    audit.list(typeof limit === 'number' ? limit : 100),
  );

  /* -------------------------------- app ------------------------------ */

  ipcMain.handle(CHANNELS.appGetVersion, (): string => app.getVersion());

  ipcMain.handle(CHANNELS.appQuit, (): void => {
    context.onQuit();
  });

  // Audit the start so the trail always has a first line.
  audit.record('system', 'Pixel started', 'ok', `version ${app.getVersion()}`);

  return { emergency, tasks };
}
