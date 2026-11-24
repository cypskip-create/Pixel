import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2, Minimize2, Minus, ShieldAlert, X,
} from 'lucide-react';
import type {
  AssistantState, AuditEntry, ConversationSummary, DiagnosticsSnapshot, DocumentLibraryItem, DocumentLibraryOpenResult, DocumentLibraryRead, ImageAttachment, Mode, PermissionDecision,
  PermissionRequest, PluginView, ProjectView, ProviderId, ReasoningEffort, TaskRecord, ToolCatalogEntry, WorkspaceWindowState,
} from '@shared/types';
import { getModeDescriptor, getProviderDescriptor, PROVIDER_CATALOG } from '@shared/types';
import { deriveAssistantState } from '@shared/companion-state';
import { WorkspaceConversationHeader } from '@/components/WorkspaceConversationHeader';
import { WorkspaceComposer } from '@/components/WorkspaceComposer';
import { WorkspaceTabBar } from '@/components/WorkspaceTabBar';
import { WorkspaceRightRail, type LiveTerminalSession } from '@/components/WorkspaceRightRail';
import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { ModelPickerPopover } from '@/components/ModelPickerPopover';
import { MarkdownMessage } from '@/components/MarkdownMessage';
import { PermissionCard } from '@/components/PermissionCard';
import { PixelMark } from '@/components/PixelMark';
import { AsciiSharkBackground } from '@/components/AsciiSharkBackground';
import { WorkspacePixPlay } from '@/components/WorkspacePixPlay';
import { SettingsPanel, type SettingsPage } from '@/components/SettingsPanel';
import type { PluginLifecycleAction, PluginProjectAvailability, PluginSettingChange } from '@/components/WorkspacePluginManager';
import { WorkspaceSidebar, type WorkspaceView } from '@/components/WorkspaceSidebar';
import { WorkspaceTaskActivity, WorkspaceTaskDetails } from '@/components/WorkspaceTaskActivity';
import { AgentActivityBar } from '@/components/AgentActivityBar';
import { useBridge } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useSessionManager } from '@/hooks/useSessionManager';
import { useSettings } from '@/hooks/useSettings';
import { useVoicePlaybackState } from '@/hooks/useVoicePlaybackState';
import { safeSubscribe } from '@/lib/bridge';
import { taskDisplayState, selectActiveTask, isTaskActive } from '@/lib/task-presentation';
import { MicrophoneCapture } from '@/lib/audioCapture';
import {
  closeSessionTab,
  createNewTab,
  cycleSessionTab,
  loadPersistedTabsState,
  openConversationInTabs,
  reopenLastClosedTab,
  savePersistedTabsState,
  updateTabById,
  type WorkspaceTabsState,
} from '@/lib/workspaceTabs';
import {
  clampRightRailWidth,
  clampSplitRatio,
  loadPersistedPaneLayout,
  savePersistedPaneLayout,
  type RightRailTab,
  type WorkspacePaneLayout,
} from '@/lib/workspaceLayout';

const WorkspaceProjects = lazy(() => import('@/components/WorkspaceProjects').then((module) => ({ default: module.WorkspaceProjects })));
const WorkspaceLibrary = lazy(() => import('@/components/WorkspaceLibrary').then((module) => ({ default: module.WorkspaceLibrary })));
const WorkspaceTasks = lazy(() => import('@/components/WorkspaceTasks').then((module) => ({ default: module.WorkspaceTasks })));
const ProductivityPanel = lazy(() => import('@/components/ProductivityPanel').then((module) => ({ default: module.ProductivityPanel })));
const PixelBoard = lazy(() => import('@/components/PixelBoard').then((module) => ({ default: module.PixelBoard })));
const WorkspacePluginManager = lazy(() => import('@/components/WorkspacePluginManager').then((module) => ({ default: module.WorkspacePluginManager })));
const CommandCenterPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.CommandCenterPage })));
const ProfilesPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.ProfilesPage })));
const AgentsPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.AgentsPage })));
const ArtifactsPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.ArtifactsPage })));
const CronPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.CronPage })));
const StarmapPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.StarmapPage })));
const SessionImportPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.SessionImportPage })));
const DedicatedMessagingPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.DedicatedMessagingPage })));
const DedicatedWebhooksPage = lazy(() => import('@/components/Stage9Destinations').then((module) => ({ default: module.DedicatedWebhooksPage })));

export function Workspace(): React.JSX.Element {
  const bridge = useBridge();
  const { settings, hasApiKey, error: settingsError, saving, patch, setMode, saveApiKey, removeApiKey, testApiKeyConnection } = useSettings();
  const chat = useChat(settings.privacy.persistHistory);
  const [view, setView] = useState<WorkspaceView>('chat');
  const [settingsInitialPage, setSettingsInitialPage] = useState<SettingsPage | undefined>(undefined);
  const settingsReturnView = useRef<WorkspaceView>('chat');
  const chatScrollTop = useRef(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [windowState, setWindowState] = useState<WorkspaceWindowState>({ maximized: true, fullscreen: false });
  const [displays, setDisplays] = useState<DiagnosticsSnapshot['displays']>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [permissionPending, setPermissionPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [libraryDocuments, setLibraryDocuments] = useState<DocumentLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [listening, setListening] = useState(false);
  const speaking = useVoicePlaybackState();
  const [pushToTalkState, setPushToTalkState] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting'>('idle');
  const [recentOutcome, setRecentOutcome] = useState<TaskRecord | null>(null);
  const [tabsState, setTabsState] = useState<WorkspaceTabsState>(() => loadPersistedTabsState(null));
  const [paneLayout, setPaneLayout] = useState<WorkspacePaneLayout>(() => loadPersistedPaneLayout());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sessions = useSessionManager();
  const [secondaryDraft, setSecondaryDraft] = useState('');
  const [terminalSessions, setTerminalSessions] = useState<LiveTerminalSession[]>([]);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottom = useRef(true);
  const knownTasks = useRef(new Map<string, TaskRecord>());
  const voiceCapture = useRef<MicrophoneCapture | null>(null);
  const voiceStartup = useRef(false);
  const activeMode = settings.companion.mode;
  const openSettings = useCallback(() => {
    if (view !== 'settings') settingsReturnView.current = view;
    if (view === 'chat') chatScrollTop.current = scrollRef.current?.scrollTop ?? chatScrollTop.current;
    setView('settings');
  }, [view]);
  const openWorkspaceDestination = useCallback((destination: WorkspaceView) => {
    const settingsPages: Partial<Record<WorkspaceView, SettingsPage>> = {
      memory: 'memory', skills: 'skills', tools: 'tools', plugins: 'plugins',
    };
    const page = settingsPages[destination];
    if (page) {
      setSettingsInitialPage(page);
      openSettings();
    } else if (destination === 'settings') {
      openSettings();
    } else {
      setView(destination);
    }
  }, [openSettings]);
  const returnFromSettings = useCallback(() => {
    const previous = settingsReturnView.current;
    settingsReturnView.current = 'chat';
    setView(previous === 'settings' ? 'chat' : previous);
  }, []);
  useLayoutEffect(() => {
    if (view === 'chat' && scrollRef.current) scrollRef.current.scrollTop = chatScrollTop.current;
  }, [view]);

  useEffect(() => {
    savePersistedTabsState(tabsState);
  }, [tabsState]);

  useEffect(() => {
    savePersistedPaneLayout(paneLayout);
  }, [paneLayout]);

  // Keep active tab synced with active conversationId, title, and busy state.
  useEffect(() => {
    const convTitle = history.find((item) => item.id === chat.conversationId)?.title;
    setTabsState((prev) =>
      updateTabById(prev, prev.activeTabId, (tab) => ({
        ...tab,
        conversationId: chat.conversationId ?? tab.conversationId,
        title: convTitle || tab.title || 'New chat',
        busy: chat.streaming,
        model: settings.provider.primaryModel,
        provider: settings.provider.provider,
      })),
    );
  }, [chat.conversationId, chat.streaming, history, settings.provider.primaryModel, settings.provider.provider]);

  const secondarySessionKey = paneLayout.secondaryConversationId
    ? `split:${paneLayout.secondaryConversationId}`
    : 'split:draft';
  const secondarySlice = sessions.getSlice(secondarySessionKey);

  // Hydrate secondary pane conversation into its own isolated session slice.
  useEffect(() => {
    if (!paneLayout.splitEnabled || !paneLayout.secondaryConversationId || bridge.kind !== 'ready') {
      return;
    }
    void sessions.hydrateConversation(secondarySessionKey, paneLayout.secondaryConversationId);
  }, [bridge.kind, paneLayout.secondaryConversationId, paneLayout.splitEnabled, secondarySessionKey, sessions.hydrateConversation]);

  // Subscribe to real backend terminal stdout/stderr and process exit events.
  useEffect(() => {
    if (bridge.kind !== 'ready' || !bridge.bridge.terminal) return;
    const termApi = bridge.bridge.terminal;
    void termApi.list().then((list) => setTerminalSessions(list)).catch(() => undefined);
    const unsubOut = termApi.onOutput((evt) => {
      setTerminalSessions((prev) =>
        prev.map((s) => (s.id === evt.sessionId ? { ...s, output: s.output + evt.chunk } : s)),
      );
    });
    const unsubExit = termApi.onExit((evt) => {
      setTerminalSessions((prev) =>
        prev.map((s) =>
          s.id === evt.sessionId
            ? { ...s, status: evt.status, exitCode: evt.exitCode, endedAt: Date.now() }
            : s,
        ),
      );
    });
    return () => {
      unsubOut();
      unsubExit();
    };
  }, [bridge]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarCollapsed((v) => !v);
        return;
      }
      if (mod && event.key === '\\') {
        event.preventDefault();
        setPaneLayout((prev) => ({
          ...prev,
          splitEnabled: !prev.splitEnabled,
          secondaryConversationId:
            prev.secondaryConversationId ?? history.find((h) => h.id !== chat.conversationId)?.id ?? null,
        }));
        return;
      }
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setPaneLayout((prev) => ({ ...prev, rightRailOpen: !prev.rightRailOpen }));
        return;
      }
      if (mod && event.key === '`') {
        event.preventDefault();
        setPaneLayout((prev) => ({
          ...prev,
          rightRailOpen: prev.rightRailOpen && prev.rightRailTab === 'terminal' ? false : true,
          rightRailTab: 'terminal',
        }));
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setTabsState((prev) => {
          const saved = updateTabById(prev, prev.activeTabId, (t) => ({
            ...t,
            draft,
            scrollTop: scrollRef.current?.scrollTop ?? t.scrollTop,
          }));
          const created = createNewTab({
            model: settings.provider.primaryModel,
            provider: settings.provider.provider,
          });
          return { ...saved, tabs: [...saved.tabs, created], activeTabId: created.id };
        });
        setDraft('');
        void chat.newConversation();
        setView('chat');
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setTabsState((prev) => reopenLastClosedTab(prev));
        return;
      }
      if (mod && event.key === 'Tab') {
        event.preventDefault();
        setTabsState((prev) => cycleSessionTab(prev, event.shiftKey ? -1 : 1));
        return;
      }
      if (event.key !== 'Escape') return;
      if (paletteOpen) {
        event.preventDefault();
        setPaletteOpen(false);
      } else if (pendingMode) {
        event.preventDefault();
        setPendingMode(null);
      } else if (contextOpen) {
        event.preventDefault();
        setContextOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chat, contextOpen, draft, history, paletteOpen, pendingMode, settings.provider.primaryModel, settings.provider.provider]);
  const activeTask = useMemo(() => selectActiveTask(tasks), [tasks]);
  const title = chat.historyLoading ? 'Restoring conversation…' : history.find((item) => item.id === chat.conversationId)?.title ?? 'New conversation';
  const recentTaskDisplay = recentOutcome ? taskDisplayState(recentOutcome) : null;
  const taskOutcome = recentOutcome && !activeTask
    ? recentOutcome.status === 'completed' && !recentTaskDisplay?.verificationPending ? 'success'
      : recentOutcome.status === 'failed' || recentOutcome.status === 'blocked' || recentTaskDisplay?.verificationPending ? 'error'
        : null
    : null;
  const assistantState: AssistantState = deriveAssistantState({
    stopped,
    permission: permission !== null,
    streaming: chat.streaming,
    hasAnswer: chat.content.length > 0,
    error: chat.error !== null || settingsError !== null,
    listening: listening || pushToTalkState === 'recording',
    transcribing: pushToTalkState === 'stopping' || pushToTalkState === 'transcribing',
    speaking,
    executing: activeTask !== null,
    taskOutcome,
  });

  useEffect(() => () => {
    voiceCapture.current?.cancel();
    voiceCapture.current = null;
    void window.cypsShell?.voiceCaptureRelease?.();
  }, []);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onVoiceCaptureCancel) return;
    return shell.onVoiceCaptureCancel(() => {
      voiceStartup.current = false;
      voiceCapture.current?.cancel();
      voiceCapture.current = null;
      setListening(false);
      void shell.voiceCaptureRelease?.();
    });
  }, []);

  useEffect(() => {
    const shell = window.cypsShell;
    if (!shell?.onPushToTalkState) return;
    return shell.onPushToTalkState((event) => {
      if (event.state === 'failed' || event.state === 'cancelled') setPushToTalkState('idle');
      else setPushToTalkState(event.state);
    });
  }, []);

  useEffect(() => {
  const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = (): void => {
      const light = settings.theme === 'light' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('theme-light', light);
      document.documentElement.classList.toggle('theme-dark', !light);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let alive = true;
    void bridge.bridge.screen.listDisplays().then((items) => { if (alive) setDisplays(items); }).catch(() => undefined);
    void bridge.bridge.window.getWorkspaceState().then((next) => { if (alive) setWindowState(next); }).catch(() => undefined);
    const unsubscribe = safeSubscribe<WorkspaceWindowState>(bridge.bridge.window.onWorkspaceState, setWindowState);
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready' || view !== 'settings') return;
    let alive = true;
    void Promise.all([bridge.bridge.plugins.list(), bridge.bridge.tools.list()]).then(([nextPlugins, nextTools]) => {
      if (alive) { setPlugins(nextPlugins); setTools(nextTools); }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [bridge, view]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    return safeSubscribe(bridge.bridge.board.onFocusRequested, () => {
      setContextOpen(false);
      setView('board');
    });
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.permissions;
    const unsubRequest = safeSubscribe<PermissionRequest>(api.onRequest, setPermission);
    const unsubResolved = safeSubscribe<string>(api.onResolved, (id) => setPermission((current) => current?.id === id ? null : current));
    let alive = true;
    void api.listPending().then((items) => { if (alive && items.length) setPermission(items[0] ?? null); }).catch(() => undefined);
    const unsubStop = safeSubscribe(bridge.bridge.system.onEmergencyStop, () => {
      setStopped(true);
      setListening(false);
      voiceStartup.current = false;
      voiceCapture.current?.cancel();
      voiceCapture.current = null;
      void window.cypsShell?.voiceCaptureRelease?.();
    });
    void bridge.bridge.system.isEmergencyStopped().then((value) => { if (alive) setStopped(value); }).catch(() => undefined);
    return () => { alive = false; unsubRequest(); unsubResolved(); unsubStop(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.tasks;
    let alive = true;
    const unsubscribe = safeSubscribe<TaskRecord>(api.onUpdate, (next) => {
      const previous = knownTasks.current.get(next.id);
      knownTasks.current.set(next.id, next);
      if (previous && isTaskActive(previous) && !isTaskActive(next)) setRecentOutcome(next);
      else if (isTaskActive(next)) setRecentOutcome(null);
      else setRecentOutcome((current) => current?.id === next.id ? next : current);
      setTasks((current) => mergeTask(current, next));
    });
    void api.list().then((items) => {
      if (!alive) return;
      const merged = new Map(items.map((item) => [item.id, item]));
      for (const [id, current] of knownTasks.current) {
        const listed = merged.get(id);
        if (!listed || taskTimestamp(current) >= taskTimestamp(listed)) merged.set(id, current);
      }
      knownTasks.current = merged;
      setTasks([...merged.values()].sort((a, b) => taskTimestamp(b) - taskTimestamp(a)));
    }).catch(() => undefined);
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void bridge.bridge.history.list({ limit: 50, search: historySearch }).then((items) => { if (alive) setHistory(items); }).catch(() => undefined);
    }, 160);
    const unsubscribe = safeSubscribe(bridge.bridge.history.onActiveChanged, () => {
      void bridge.bridge.history.list({ limit: 50, search: historySearch }).then((items) => { if (alive) setHistory(items); }).catch(() => undefined);
    });
    return () => { alive = false; window.clearTimeout(timer); unsubscribe(); };
  }, [bridge, historySearch]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let alive = true;
    const api = bridge.bridge.memory;
    const load = (): void => {
      void api.listProjects().then((items) => { if (alive) setProjects(items); }).catch(() => undefined);
      void Promise.all([bridge.bridge.plugins.list(), bridge.bridge.tools.list()]).then(([nextPlugins, nextTools]) => {
        if (alive) { setPlugins(nextPlugins); setTools(nextTools); }
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = safeSubscribe(api.onProjectChanged, load);
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let alive = true;
    void Promise.all([bridge.bridge.tools.list(), bridge.bridge.audit.list(80), bridge.bridge.plugins.list()]).then(([nextTools, nextAudit, nextPlugins]) => {
      if (alive) { setTools(nextTools); setAudit(nextAudit); setPlugins(nextPlugins); }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [bridge]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && shouldStickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [chat.messages.length, chat.content, chat.reasoning, recentOutcome]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'F11' || bridge.kind !== 'ready') return;
      event.preventDefault();
      void bridge.bridge.window.setWorkspaceFullscreen(!windowState.fullscreen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bridge, windowState.fullscreen]);

  const openNewChat = useCallback(async () => {
    shouldStickToBottom.current = true;
    const created = await chat.newConversation();
    if (created) { setDraft(''); setAttachments([]); setRecentOutcome(null); setContextOpen(false); setView('chat'); }
  }, [chat.newConversation]);

  const chooseMode = useCallback((next: Mode) => {
    if (getModeDescriptor(next).allowsStateChange && !getModeDescriptor(activeMode).allowsStateChange) setPendingMode(next);
    else setMode(next);
  }, [activeMode, setMode]);

  const submit = useCallback(async () => {
    if (chat.streaming || (draft.trim() === '' && attachments.length === 0) || bridge.kind !== 'ready') return;
    if (stopped) { setNotice('Emergency stop is active. Clear it before starting another task.'); return; }
    shouldStickToBottom.current = true;
    const sent = await chat.send({ text: draft, images: attachments, mode: activeMode });
    if (sent) { setDraft(''); setAttachments([]); setView('chat'); }
  }, [activeMode, attachments, bridge, chat, draft, stopped]);

  const attachScreenshot = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    try {
      const result = await bridge.bridge.screen.captureLastExternalWindow();
      if (result.ok && result.image) setAttachments((current) => [...current, result.image as ImageAttachment].slice(0, 4));
      else setNotice(result.error?.message ?? 'Pixel could not capture the active window.');
    } catch { setNotice('Pixel could not capture the active window.'); }
  }, [bridge]);

  const finishWorkspaceVoiceCapture = useCallback(async (capture: MicrophoneCapture, reachedLimit = false) => {
    if (voiceCapture.current !== capture) return;
    voiceCapture.current = null;
    setListening(false);
    const shell = window.cypsShell;
    if (!shell?.voiceTranscribeWav) {
      capture.cancel();
      await shell?.voiceCaptureRelease?.();
      setNotice('Pixel cannot send this recording to its local speech recognizer.');
      return;
    }
    try {
      const wav = await capture.stop();
      await shell.voiceCaptureRelease?.();
      const result = await shell.voiceTranscribeWav(wav);
      if (result.ok && result.text.trim()) {
        setDraft((current) => current ? `${current} ${result.text.trim()}` : result.text.trim());
        if (reachedLimit) setNotice('The 120-second dictation limit was reached. The transcription was added to the composer.');
      } else {
        setNotice(result.error ?? 'Pixel did not hear anything.');
      }
    } catch (cause) {
      await shell.voiceCaptureRelease?.();
      const error = cause instanceof Error ? cause.message : 'Voice transcription failed.';
      if (!error.toLowerCase().includes('cancelled')) setNotice(error);
    }
  }, []);

  const toggleVoice = useCallback(async () => {
    const shell = window.cypsShell;
    if (!shell?.voiceTranscribeWav || !shell.voiceCapability) { setNotice('Voice input is unavailable in this build.'); return; }
    if (listening) {
      const capture = voiceCapture.current;
      if (capture) await finishWorkspaceVoiceCapture(capture);
      return;
    }
    if (voiceStartup.current) {
      voiceStartup.current = false;
      voiceCapture.current?.cancel();
      voiceCapture.current = null;
      await shell.voiceCaptureRelease?.();
      setNotice('Microphone startup was cancelled.');
      return;
    }
    voiceStartup.current = true;
    try {
      const capability = await shell.voiceCapability();
      if (!voiceStartup.current) return;
      if (!capability.speechToText) throw new Error(capability.reason ?? 'Local speech recognition is unavailable.');
      const acquired = await shell.voiceCaptureAcquire();
      if (!acquired) throw new Error('Another Pixel window is already using the microphone.');
      if (!voiceStartup.current) { await shell.voiceCaptureRelease(); return; }
      let capture: MicrophoneCapture;
      capture = new MicrophoneCapture(() => undefined, () => { void finishWorkspaceVoiceCapture(capture, true); });
      voiceCapture.current = capture;
      await capture.start(settings.voice.inputDeviceId);
      if (!voiceStartup.current || voiceCapture.current !== capture) {
        capture.cancel();
        await shell.voiceCaptureRelease();
        return;
      }
      setListening(true);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Voice input failed.';
      if (voiceStartup.current) setNotice(error);
      voiceCapture.current?.cancel();
      voiceCapture.current = null;
      await shell.voiceCaptureRelease?.();
    } finally {
      voiceStartup.current = false;
    }
  }, [finishWorkspaceVoiceCapture, listening, settings.voice.inputDeviceId]);

  const respondPermission = useCallback(async (decision: PermissionDecision) => {
    if (bridge.kind !== 'ready') return;
    setPermissionPending(true);
    try { await bridge.bridge.permissions.respond(decision); }
    catch { setNotice('This approval has expired or could not be recorded.'); }
    finally { setPermissionPending(false); }
  }, [bridge]);

  const taskAction = useCallback((action: 'pause'|'resume'|'cancel', id: string) => {
    if (bridge.kind === 'ready') void bridge.bridge.tasks[action](id).catch(() => setNotice('The task action could not be completed.'));
  }, [bridge]);

  const toggleEmergency = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    try {
      if (stopped) { await bridge.bridge.system.emergencyClear(); setStopped(false); }
      else { await bridge.bridge.system.emergencyStop(); setStopped(true); }
    } catch { setNotice('Emergency stop could not be updated.'); }
  }, [bridge, stopped]);

  const openConversation = useCallback(async (id: string) => {
    shouldStickToBottom.current = true;
    const convTitle = history.find((item) => item.id === id)?.title ?? 'Conversation';
    setTabsState((prev) => {
      const saved = updateTabById(prev, prev.activeTabId, (t) => ({
        ...t,
        draft,
        scrollTop: scrollRef.current?.scrollTop ?? t.scrollTop,
      }));
      return openConversationInTabs(saved, id, convTitle, {
        model: settings.provider.primaryModel,
        provider: settings.provider.provider,
      });
    });
    if (await chat.openConversation(id)) { setRecentOutcome(null); setContextOpen(false); setView('chat'); }
  }, [chat.openConversation, draft, history, settings.provider.primaryModel, settings.provider.provider]);

  const selectSessionTab = useCallback(async (tabId: string) => {
    const target = tabsState.tabs.find((t) => t.id === tabId);
    if (!target || target.id === tabsState.activeTabId) return;
    setTabsState((prev) => ({
      ...updateTabById(prev, prev.activeTabId, (t) => ({
        ...t,
        draft,
        scrollTop: scrollRef.current?.scrollTop ?? t.scrollTop,
      })),
      activeTabId: tabId,
    }));
    setDraft(target.draft);
    chatScrollTop.current = target.scrollTop;
    if (target.conversationId) {
      await chat.openConversation(target.conversationId);
    } else {
      await chat.newConversation();
    }
    setView('chat');
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = target.scrollTop;
    });
  }, [chat, draft, tabsState.activeTabId, tabsState.tabs]);

  const createSessionTab = useCallback(() => {
    setTabsState((prev) => {
      const saved = updateTabById(prev, prev.activeTabId, (t) => ({
        ...t,
        draft,
        scrollTop: scrollRef.current?.scrollTop ?? t.scrollTop,
      }));
      const next = createNewTab({
        model: settings.provider.primaryModel,
        provider: settings.provider.provider,
      });
      return { ...saved, tabs: [...saved.tabs, next], activeTabId: next.id };
    });
    setDraft('');
    void chat.newConversation();
    setView('chat');
  }, [chat, draft, settings.provider.primaryModel, settings.provider.provider]);

  const closeTab = useCallback((tabId: string) => {
    const nextState = closeSessionTab(tabsState, tabId);
    setTabsState(nextState);
    const nextActive = nextState.tabs.find((t) => t.id === nextState.activeTabId);
    if (nextActive && tabId === tabsState.activeTabId) {
      setDraft(nextActive.draft);
      if (nextActive.conversationId) void chat.openConversation(nextActive.conversationId);
      else void chat.newConversation();
    }
  }, [chat, tabsState]);

  const toggleRightRail = useCallback((tab?: RightRailTab) => {
    setPaneLayout((prev) => {
      const nextOpen = tab ? (prev.rightRailOpen && prev.rightRailTab === tab ? false : true) : !prev.rightRailOpen;
      const nextTab = tab ?? prev.rightRailTab;
      if (nextOpen && (nextTab === 'files' || nextTab === 'preview')) {
        void refreshLibrary();
      }
      return { ...prev, rightRailOpen: nextOpen, rightRailTab: nextTab };
    });
  }, []);

  const toggleSplitPane = useCallback(() => {
    setPaneLayout((prev) => ({
      ...prev,
      splitEnabled: !prev.splitEnabled,
      secondaryConversationId:
        prev.secondaryConversationId ?? history.find((h) => h.id !== chat.conversationId)?.id ?? null,
    }));
  }, [chat.conversationId, history]);

  const startSplitResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (moveEvent: MouseEvent): void => {
      if (rect.width <= 0) return;
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      setPaneLayout((prev) => ({ ...prev, splitRatio: clampSplitRatio(ratio) }));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const startRailResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneLayout.rightRailWidth;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = startX - moveEvent.clientX;
      setPaneLayout((prev) => ({ ...prev, rightRailWidth: clampRightRailWidth(startWidth + delta) }));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [paneLayout.rightRailWidth]);

  const runTerminalCommand = useCallback(async (command: string): Promise<string | void> => {
    if (bridge.kind !== 'ready' || !bridge.bridge.terminal) {
      return 'Pixel terminal backend is not connected.';
    }
    const res = await bridge.bridge.terminal.run(command);
    if (!res.ok) {
      return res.error || 'Terminal command was not executed.';
    }
    if (res.session) {
      setTerminalSessions((prev) => [res.session!, ...prev.filter((s) => s.id !== res.session!.id)].slice(0, 24));
    }
  }, [bridge]);

  const cancelTerminalSession = useCallback((sessionId: string) => {
    if (bridge.kind !== 'ready' || !bridge.bridge.terminal) return;
    void bridge.bridge.terminal.cancel(sessionId);
  }, [bridge]);

  const submitSecondaryPane = useCallback(async () => {
    const text = secondaryDraft.trim();
    if (!text) return;
    setSecondaryDraft('');
    await sessions.sendInSession(secondarySessionKey, {
      text,
      images: [],
      mode: activeMode,
      conversationId: paneLayout.secondaryConversationId,
      model: settings.provider.primaryModel,
      provider: settings.provider.provider,
    });
  }, [activeMode, paneLayout.secondaryConversationId, secondaryDraft, secondarySessionKey, sessions, settings.provider.primaryModel, settings.provider.provider]);

  const handleSelectModel = useCallback((provider: ProviderId, model: string) => {
    const desc = getProviderDescriptor(provider);
    void patch({
      provider: {
        provider,
        primaryModel: model,
        reasoningModel: desc.reasoningModel,
      },
    });
  }, [patch]);

  const handleSelectEffort = useCallback((effort: ReasoningEffort) => {
    void patch({
      provider: {
        thinking: { enabled: effort !== 'none', effort },
      },
    });
  }, [patch]);

  const renameConversation = useCallback(async (id: string, nextTitle: string): Promise<boolean> => {
    if (bridge.kind !== 'ready') return false;
    try {
      const updated = await bridge.bridge.history.rename(id, nextTitle);
      if (!updated) return false;
      setHistory((current) => current.map((item) => item.id === id ? updated : item));
      return true;
    } catch {
      setNotice('Pixel could not rename that chat.');
      return false;
    }
  }, [bridge]);

  const deleteConversation = useCallback(async (id: string): Promise<boolean> => {
    if (bridge.kind !== 'ready') return false;
    try {
      const deleted = await bridge.bridge.history.delete(id);
      if (!deleted) return false;
      setHistory((current) => current.filter((item) => item.id !== id));
      if (chat.conversationId === id) await openNewChat();
      return true;
    } catch {
      setNotice('Pixel could not delete that chat.');
      return false;
    }
  }, [bridge, chat.conversationId, openNewChat]);

  const runSearch = useCallback((query: string) => {
    if (!query.trim() || bridge.kind !== 'ready' || !chat.conversationId) return;
    void bridge.bridge.browser.openSearch(query, `Search for ${query}`, chat.conversationId).catch(() => setNotice('Pixel could not open the browser search.'));
  }, [bridge, chat.conversationId]);

  const currentProject = projects.find((project) => project.active);

  const refreshLibrary = useCallback(async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    setLibraryLoading(true);
    try {
      setLibraryDocuments(await bridge.bridge.documents.listLibrary());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Pixel could not load this project’s Library.');
    } finally {
      setLibraryLoading(false);
    }
  }, [bridge]);

  const readLibraryDocument = useCallback(async (documentId: string, startChunk: number): Promise<DocumentLibraryRead | null> => {
    if (bridge.kind !== 'ready') return null;
    return bridge.bridge.documents.readLibraryDocument(documentId, startChunk);
  }, [bridge]);

  const openLibraryDocument = useCallback(async (documentId: string): Promise<DocumentLibraryOpenResult> => {
    if (bridge.kind !== 'ready') return { ok: false, content: 'Pixel is not connected to its local services.' };
    return bridge.bridge.documents.openLibraryDocument(documentId);
  }, [bridge]);

  const openLibraryFolder = useCallback(async (folderId: string): Promise<DocumentLibraryOpenResult> => {
    if (bridge.kind !== 'ready') return { ok: false, content: 'Pixel is not connected to its local services.' };
    return bridge.bridge.documents.openLibraryFolder(folderId);
  }, [bridge]);

  const indexLibraryFolder = useCallback(async () => {
    if (bridge.kind !== 'ready') return { ok: false, content: 'Pixel is not connected to its local services.' };
    try {
      const result = await bridge.bridge.documents.indexLibraryFolder();
      if (result.ok) await refreshLibrary();
      return result;
    } catch (cause) {
      return { ok: false, content: cause instanceof Error ? cause.message : 'Pixel could not index that folder.' };
    }
  }, [bridge, refreshLibrary]);

  useEffect(() => {
    if ((view !== 'library' && !(paneLayout.rightRailOpen && (paneLayout.rightRailTab === 'files' || paneLayout.rightRailTab === 'preview'))) || bridge.kind !== 'ready') return;
    void refreshLibrary();
  }, [bridge, currentProject?.id, paneLayout.rightRailOpen, paneLayout.rightRailTab, refreshLibrary, view]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const items: PaletteCommand[] = [
      { id: 'new-tab', group: 'Conversations', label: 'New conversation tab', shortcut: 'Ctrl+T', onSelect: createSessionTab },
      { id: 'toggle-split', group: 'Workspace', label: paneLayout.splitEnabled ? 'Close split pane' : 'Split workspace pane', shortcut: 'Ctrl+\\', onSelect: toggleSplitPane },
      { id: 'toggle-files', group: 'Workspace', label: 'Toggle workspace file browser', shortcut: 'Ctrl+J', onSelect: () => toggleRightRail('files') },
      { id: 'toggle-preview', group: 'Workspace', label: 'Open contextual preview pane', onSelect: () => toggleRightRail('preview') },
      { id: 'toggle-terminal', group: 'Workspace', label: 'Toggle integrated terminal', shortcut: 'Ctrl+`', onSelect: () => toggleRightRail('terminal') },
      { id: 'toggle-sidebar', group: 'Workspace', label: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', shortcut: 'Ctrl+B', onSelect: () => setSidebarCollapsed((v) => !v) },
      { id: 'nav-command-center', group: 'Navigation', label: 'Open Command Center', onSelect: () => openWorkspaceDestination('command-center') },
      { id: 'nav-projects', group: 'Navigation', label: 'Open Projects', onSelect: () => openWorkspaceDestination('projects') },
      { id: 'nav-tasks', group: 'Navigation', label: 'Open Running Tasks & Activity', onSelect: () => openWorkspaceDestination('tasks') },
      { id: 'nav-board', group: 'Navigation', label: 'Open Pixel Board', onSelect: () => openWorkspaceDestination('board') },
      { id: 'nav-library', group: 'Navigation', label: 'Open Document Library', onSelect: () => openWorkspaceDestination('library') },
      { id: 'nav-capabilities', group: 'Navigation', label: 'Open Capabilities & Plugins', onSelect: () => openWorkspaceDestination('capabilities') },
      { id: 'nav-messaging', group: 'Navigation', label: 'Open Messaging & Pairing', onSelect: () => openWorkspaceDestination('messaging') },
      { id: 'nav-webhooks', group: 'Navigation', label: 'Open Webhooks', onSelect: () => openWorkspaceDestination('webhooks') },
      { id: 'nav-artifacts', group: 'Navigation', label: 'Open Artifacts', onSelect: () => openWorkspaceDestination('artifacts') },
      { id: 'nav-cron', group: 'Navigation', label: 'Open Schedules & Cron', onSelect: () => openWorkspaceDestination('cron') },
      { id: 'nav-profiles', group: 'Navigation', label: 'Open Profiles', onSelect: () => openWorkspaceDestination('profiles') },
      { id: 'nav-agents', group: 'Navigation', label: 'Open Agents & Delegation', onSelect: () => openWorkspaceDestination('agents') },
      { id: 'nav-starmap', group: 'Navigation', label: 'Open Starmap', onSelect: () => openWorkspaceDestination('starmap') },
      { id: 'nav-session-import', group: 'Navigation', label: 'Open Session Import', onSelect: () => openWorkspaceDestination('session-import') },
      { id: 'nav-notes', group: 'Navigation', label: 'Open Notes & Planning', onSelect: () => openWorkspaceDestination('notes') },
      { id: 'nav-plugins', group: 'Navigation', label: 'Open Plugins & MCP', onSelect: () => openWorkspaceDestination('plugins') },
      { id: 'nav-skills', group: 'Navigation', label: 'Open Skills & Routines', onSelect: () => openWorkspaceDestination('skills') },
      { id: 'nav-memory', group: 'Navigation', label: 'Open Memory', onSelect: () => openWorkspaceDestination('memory') },
      { id: 'nav-settings', group: 'Navigation', label: 'Open Settings', onSelect: () => openWorkspaceDestination('settings') },
    ];
    for (const conv of history.slice(0, 8)) {
      items.push({
        id: `conv:${conv.id}`,
        group: 'Conversations',
        label: conv.title || 'Untitled conversation',
        subtitle: 'Open in tab',
        onSelect: () => void openConversation(conv.id),
      });
    }
    for (const p of PROVIDER_CATALOG) {
      items.push({
        id: `model:${p.id}:${p.defaultModel}`,
        group: 'Models',
        label: `Switch to ${p.defaultModel}`,
        subtitle: p.label,
        onSelect: () => handleSelectModel(p.id, p.defaultModel),
      });
    }
    return items;
  }, [createSessionTab, handleSelectModel, history, openConversation, openWorkspaceDestination, paneLayout.splitEnabled, sidebarCollapsed, toggleRightRail, toggleSplitPane]);

  const viewTitle: Record<WorkspaceView, string> = {
    chat: 'Workspace',
    'command-center': 'Command Center',
    projects: 'Projects',
    library: 'Library',
    artifacts: 'Artifacts',
    tasks: 'Activity',
    cron: 'Schedules & Cron',
    notes: 'Notes & Planning',
    skills: 'Skills & Routines',
    memory: 'Memory',
    tools: 'Tools',
    plugins: 'Plugins',
    capabilities: 'Capabilities',
    messaging: 'Messaging & Pairing',
    webhooks: 'Webhooks',
    profiles: 'Profiles',
    agents: 'Agents & Delegation',
    starmap: 'Starmap',
    'session-import': 'Import Session',
    board: 'Pixel Board',
    settings: 'Settings',
  };
  const handlePluginChange = useCallback(async (
    action: PluginLifecycleAction,
    pluginId: string,
    enabled?: boolean,
    availability?: PluginProjectAvailability,
    setting?: PluginSettingChange,
  ) => {
    if (bridge.kind !== 'ready') return;
    try {
      const next = action === 'install' ? await bridge.bridge.plugins.install(pluginId)
        : action === 'update' ? await bridge.bridge.plugins.update(pluginId)
        : action === 'uninstall' ? await bridge.bridge.plugins.uninstall(pluginId)
          : action === 'project-availability' ? await bridge.bridge.plugins.setProjectAvailability(pluginId, availability ?? 'inherit')
            : action === 'setting' ? await bridge.bridge.plugins.setSetting(pluginId, setting?.key ?? '', setting?.value ?? '')
            : await bridge.bridge.plugins.setEnabled(pluginId, enabled === true);
      setPlugins(next);
      setTools(await bridge.bridge.tools.list());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Pixel could not update that plugin.');
    }
  }, [bridge]);
  const pendingApproval = permission ? (
    <div className="workspace-approval" aria-label="Approval required">
      <PermissionCard request={permission} pending={permissionPending} onDecide={(decision) => void respondPermission(decision)} compact />
    </div>
  ) : null;

  return (
    <div
      className={`workspace-shell${settings.companion.reducedMotion ? ' reduce-motion' : ''}`}
      data-workspace
      data-density={settings.display?.sessionDensity ?? 'comfortable'}
      data-hide-code-diffs={settings.display?.hideCodeDiffs ? 'true' : 'false'}
      style={{
        ['--pixel-ui-scale' as string]: String((settings.display?.uiScale ?? 100) / 100),
        ['--pixel-chat-scale' as string]: String((settings.display?.chatTextScale ?? 100) / 100),
      }}
    >
      <header className="workspace-titlebar drag">
        <div className="flex min-w-0 items-center gap-2"><PixelMark size={22} /><span className="pixel-wordmark pixel-wordmark-large">PIXEL</span>
          {view !== 'chat' ? <><span className="workspace-title-divider" /><span className="truncate text-[13px] text-[var(--color-ink-soft)]">{viewTitle[view]}</span></> : null}
        </div>
        <div className="workspace-window-controls no-drag">
          <button type="button" aria-label={stopped ? 'Clear emergency stop' : 'Emergency stop'} aria-pressed={stopped} onClick={() => void toggleEmergency()} title={stopped ? 'Clear emergency stop' : 'Emergency stop'} className={`workspace-window-button workspace-emergency-control ${stopped ? 'is-active' : ''}`}><ShieldAlert size={15} /></button>
          <button type="button" aria-label="Minimize Pixel Workspace" title="Minimize" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.minimizeWorkspace(); }} className="workspace-window-button"><Minus size={14} /></button>
          <button type="button" aria-label={windowState.maximized ? 'Restore window' : 'Maximize window'} onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.toggleWorkspaceMaximize(); }} title={windowState.maximized ? 'Restore' : 'Maximize'} className="workspace-window-button">{windowState.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          <button type="button" aria-label="Close Pixel Workspace" title="Close" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.closeWorkspace(); }} className="workspace-window-button workspace-close-button"><X size={15} /></button>
        </div>
      </header>

      <div className="workspace-body">
        {view !== 'settings' ? <WorkspaceSidebar
          view={view}
          onViewChange={openWorkspaceDestination}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
          history={history}
          selectedConversationId={chat.conversationId}
          historySearch={historySearch}
          onHistorySearchChange={setHistorySearch}
          onOpenConversation={(id) => void openConversation(id)}
          onNewChat={() => void openNewChat()}
          onRenameConversation={renameConversation}
          onDeleteConversation={deleteConversation}
          currentProject={currentProject}
          activeTaskCount={tasks.filter(isTaskActive).length}
          disabled={chat.streaming || chat.historyLoading}
        /> : null}

        <main className="workspace-main">
          {notice ? <div role="status" className="workspace-notice">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={13} /></button></div> : null}
          {pendingMode ? <div className="workspace-mode-confirm" role="alertdialog" aria-label="Confirm agent mode"><div><strong>Switch to {getModeDescriptor(pendingMode).label}?</strong><p>{getModeDescriptor(pendingMode).summary} Pixel will still ask before every consequential action.</p></div><button type="button" onClick={() => setPendingMode(null)}>Cancel</button><button type="button" onClick={() => { setMode(pendingMode); setPendingMode(null); }}>Switch mode</button></div> : null}
          {view !== 'chat' ? pendingApproval : null}

          {view === 'chat' ? <div className="workspace-chat-shell">
            <WorkspaceTabBar
              tabs={tabsState.tabs}
              activeTabId={tabsState.activeTabId}
              splitEnabled={paneLayout.splitEnabled}
              rightRailOpen={paneLayout.rightRailOpen}
              onSelectTab={(id) => void selectSessionTab(id)}
              onNewTab={createSessionTab}
              onCloseTab={closeTab}
              onToggleSplit={toggleSplitPane}
              onToggleRightRail={toggleRightRail}
              onOpenCommandPalette={() => setPaletteOpen(true)}
            />
            <div className={`workspace-split-area ${paneLayout.splitEnabled ? 'is-split' : ''}`} ref={splitContainerRef}>
            <section
              className={`workspace-conversation ${paneLayout.activePane === 'primary' ? 'is-focused-pane' : ''}`}
              style={paneLayout.splitEnabled ? { flex: `0 0 ${Math.round(paneLayout.splitRatio * 100)}%` } : undefined}
              onMouseDown={() => {
                if (paneLayout.activePane !== 'primary') {
                  setPaneLayout((prev) => ({ ...prev, activePane: 'primary' }));
                }
              }}
            >
            <AsciiSharkBackground
              mode={chat.messages.length === 0 && !chat.streaming ? 'empty' : 'active'}
              reducedMotion={settings.companion.reducedMotion}
              theme={settings.theme === 'light' ? 'light' : 'dark'}
            />
            <WorkspaceConversationHeader
              title={title}
              projectName={currentProject?.name && currentProject.name !== 'Default project' ? currentProject.name : undefined}
              currentMode={activeMode}
              onRequestMode={chooseMode}
              onSearchWeb={runSearch}
              canSearch={bridge.kind === 'ready' && Boolean(chat.conversationId)}
              hasTaskDetails={activeTask !== null}
              onOpenTaskDetails={() => setContextOpen(true)}
            />
            {pendingApproval}
            {activeTask ? <WorkspaceTaskActivity task={activeTask} onOpenDetails={() => setContextOpen(true)} /> : null}
            {recentOutcome ? (() => {
              const resultState = taskDisplayState(recentOutcome);
              return <div className="workspace-recent-outcome" role="status">
                <span>{resultState.verificationPending ? 'Awaiting verification' : resultState.label === 'failed' ? 'Task failed' : resultState.label === 'cancelled' ? 'Task stopped' : 'Task finished'}</span>
                <span className="workspace-recent-outcome-title">{recentOutcome.result || recentOutcome.title}</span>
                <button type="button" aria-label="Dismiss task result" onClick={() => setRecentOutcome(null)}><X size={14} /></button>
              </div>;
            })() : null}
            <div
              className="workspace-transcript selectable"
              ref={scrollRef}
              onScroll={(event) => {
                const node = event.currentTarget;
                chatScrollTop.current = node.scrollTop;
                shouldStickToBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 96;
              }}
              aria-label="Conversation"
            >
              {chat.messages.length === 0 && !chat.streaming ? <div className="workspace-empty"><h2>What can Pixel help with?</h2></div> : null}
              {chat.messages.map((message) => <article key={message.id} className={`workspace-message ${message.role === 'user' ? 'workspace-user-message' : 'workspace-assistant-message'}`}>
                <div className="min-w-0 flex-1"><div className="workspace-message-meta"><span>{message.role === 'user' ? 'You' : 'Pixel'}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.aborted ? <span>Stopped</span> : null}</div>{message.error && !message.content ? <p role="alert" className="text-neutral-200">{message.error}</p> : <MarkdownMessage text={message.content || (message.aborted ? 'Response stopped before any text arrived.' : '')} />}{message.error && message.content ? <p role="alert" className="mt-2 text-neutral-200">{message.error}</p> : null}</div>
              </article>)}
              {chat.streaming ? <article className="workspace-message workspace-assistant-message"><div className="min-w-0 flex-1"><div className="workspace-message-meta"><span>Pixel</span><span className="text-neutral-200">{chat.model ?? 'Thinking'}</span></div>{chat.reasoning ? <details className="workspace-reasoning" open={settings.display?.reasoningCollapsed === false}><summary>Reasoning details</summary><p>{chat.reasoning}</p></details> : null}<MarkdownMessage text={chat.content || 'Thinking…'} /></div></article> : null}
              {chat.error ? <p role="alert" className="workspace-error">{chat.error}</p> : null}
            </div>
            <WorkspacePixPlay state={assistantState} reducedMotion={settings.companion.reducedMotion} />
            <AgentActivityBar
              activeTask={activeTask}
              streaming={chat.streaming}
              hasStreamingText={chat.content.length > 0}
              hasPermissionRequest={permission !== null}
              onOpenTaskDetails={() => setContextOpen(true)}
            />
            <WorkspaceComposer
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={() => void submit()}
              onStop={chat.stop}
              streaming={chat.streaming}
              disabled={bridge.kind !== 'ready' || chat.historyLoading}
              attachments={attachments}
              onAttach={(attachment) => setAttachments((items) => [...items, attachment].slice(0, 4))}
              onRemoveAttachment={(index) => setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))}
              onAttachScreenshot={() => void attachScreenshot()}
              onToggleListening={() => void toggleVoice()}
              listening={listening}
              onNotice={setNotice}
            />
          </section>
          {paneLayout.splitEnabled ? (
            <>
              <div
                className="workspace-split-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize split panes"
                onMouseDown={startSplitResize}
                onDoubleClick={() => setPaneLayout((prev) => ({ ...prev, splitRatio: 0.54 }))}
              />
              <section
                className={`workspace-secondary-pane ${paneLayout.activePane === 'secondary' ? 'is-focused-pane' : ''}`}
                aria-label="Secondary conversation pane"
                onMouseDown={() => setPaneLayout((prev) => ({ ...prev, activePane: 'secondary' }))}
              >
                <div className="workspace-secondary-header">
                  <select
                    aria-label="Secondary pane conversation"
                    value={paneLayout.secondaryConversationId ?? ''}
                    onChange={(e) => setPaneLayout((prev) => ({ ...prev, secondaryConversationId: e.target.value || null }))}
                    className="workspace-secondary-select"
                  >
                    <option value="">Select conversation…</option>
                    {history.map((item) => (
                      <option key={item.id} value={item.id}>{item.title || 'Untitled'}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="workspace-rail-close"
                    onClick={toggleSplitPane}
                    aria-label="Close split pane"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="workspace-secondary-transcript selectable">
                  {secondarySlice.messages.length === 0 && !secondarySlice.streaming ? (
                    <p className="workspace-rail-empty">Select a conversation above or send a message below to run an independent split session.</p>
                  ) : (
                    <>
                      {secondarySlice.messages.map((msg) => (
                        <article key={msg.id} className={`workspace-message ${msg.role === 'user' ? 'workspace-user-message' : 'workspace-assistant-message'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="workspace-message-meta">
                              <span>{msg.role === 'user' ? 'You' : 'Pixel'}</span>
                              <time>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                            </div>
                            <MarkdownMessage text={msg.content || ''} />
                          </div>
                        </article>
                      ))}
                      {secondarySlice.streaming ? (
                        <article className="workspace-message workspace-assistant-message">
                          <div className="min-w-0 flex-1">
                            <div className="workspace-message-meta">
                              <span>Pixel</span>
                              <span>{secondarySlice.model ?? 'Thinking'}</span>
                            </div>
                            <MarkdownMessage text={secondarySlice.content || 'Thinking…'} />
                          </div>
                        </article>
                      ) : null}
                      {secondarySlice.error ? <p role="alert" className="workspace-error">{secondarySlice.error}</p> : null}
                    </>
                  )}
                </div>
                <WorkspaceComposer
                  draft={secondaryDraft}
                  onDraftChange={setSecondaryDraft}
                  onSubmit={() => void submitSecondaryPane()}
                  onStop={() => sessions.stopSession(secondarySessionKey)}
                  streaming={secondarySlice.streaming}
                  disabled={bridge.kind !== 'ready'}
                  attachments={[]}
                  onAttach={() => undefined}
                  onRemoveAttachment={() => undefined}
                  onAttachScreenshot={() => undefined}
                  onToggleListening={() => undefined}
                  listening={false}
                  onNotice={setNotice}
                />
              </section>
            </>
          ) : null}
          </div>
          </div> : null}

          {view === 'command-center' ? <Suspense fallback={<WorkspacePanelLoading />}><CommandCenterPage onOpenConversation={(id) => void openConversation(id)} /></Suspense> : null}
          {view === 'projects' ? <Suspense fallback={<WorkspacePanelLoading />}><WorkspaceProjects projects={projects} draft={projectDraft} setDraft={setProjectDraft} onSelect={async (name) => { if (bridge.kind !== 'ready') return; try { await bridge.bridge.memory.setActiveProject(name); setHistory(await bridge.bridge.history.list({limit:50})); setView('chat'); } catch { setNotice('Pixel could not switch projects while a task is running.'); } }} /></Suspense> : null}
          {view === 'library' ? <Suspense fallback={<WorkspacePanelLoading />}><WorkspaceLibrary documents={libraryDocuments} loading={libraryLoading} onRefresh={() => void refreshLibrary()} onIndexFolder={indexLibraryFolder} onRead={readLibraryDocument} onOpen={openLibraryDocument} onOpenFolder={openLibraryFolder} /></Suspense> : null}
          {view === 'artifacts' ? <Suspense fallback={<WorkspacePanelLoading />}><ArtifactsPage projectId={currentProject?.id} /></Suspense> : null}
          {view === 'tasks' ? <Suspense fallback={<WorkspacePanelLoading />}><WorkspaceTasks tasks={tasks} audit={audit} projectName={currentProject?.name} onAction={taskAction} onContinue={(id) => { if (bridge.kind === 'ready') void bridge.bridge.tasks.continueAfterHandoff(id).catch(() => setNotice('Pixel could not continue that handoff.')); }} onRecord={async (id) => { if (bridge.kind !== 'ready') return; try { const skill = await bridge.bridge.skills.recordTask(id); setNotice(`Draft “${skill.name}” saved for review.`); setSettingsInitialPage('skills'); openSettings(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Pixel could not record that task.'); } }} /></Suspense> : null}
          {view === 'cron' ? <Suspense fallback={<WorkspacePanelLoading />}><CronPage /></Suspense> : null}
          {view === 'capabilities' ? <Suspense fallback={<WorkspacePanelLoading />}><section className="workspace-page" aria-label="Capabilities"><div className="workspace-page-heading"><h1>Capabilities, Plugins &amp; Toolsets</h1><p>Manage Python plugins, MCP servers, Skills Hub, and active toolsets.</p></div><WorkspacePluginManager plugins={plugins} onChange={handlePluginChange} /></section></Suspense> : null}
          {view === 'messaging' ? <Suspense fallback={<WorkspacePanelLoading />}><DedicatedMessagingPage /></Suspense> : null}
          {view === 'webhooks' ? <Suspense fallback={<WorkspacePanelLoading />}><DedicatedWebhooksPage /></Suspense> : null}
          {view === 'profiles' ? <Suspense fallback={<WorkspacePanelLoading />}><ProfilesPage /></Suspense> : null}
          {view === 'agents' ? <Suspense fallback={<WorkspacePanelLoading />}><AgentsPage /></Suspense> : null}
          {view === 'starmap' ? <Suspense fallback={<WorkspacePanelLoading />}><StarmapPage /></Suspense> : null}
          {view === 'session-import' ? <Suspense fallback={<WorkspacePanelLoading />}><SessionImportPage /></Suspense> : null}
          {view === 'notes' ? <Suspense fallback={<WorkspacePanelLoading />}><ProductivityPanel /></Suspense> : null}
          {view === 'board' ? <Suspense fallback={<WorkspacePanelLoading />}><PixelBoard emergencyStopped={stopped} /></Suspense> : null}
          {view === 'settings' ? <div className="workspace-settings"><Suspense fallback={<WorkspacePanelLoading />}><SettingsPanel settings={settings} displays={displays} onPatch={patch} onRequestMode={chooseMode} onClose={returnFromSettings} hasApiKey={hasApiKey} onSaveApiKey={saveApiKey} onRemoveApiKey={removeApiKey} onTestConnection={testApiKeyConnection} error={settingsError} saving={saving} workspaceLayout initialPage={settingsInitialPage} tools={tools} plugins={plugins} onPluginChange={handlePluginChange} /></Suspense></div> : null}
        </main>

        {paneLayout.rightRailOpen && view !== 'settings' ? (
          <>
            <div
              className="workspace-split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right panel"
              onMouseDown={startRailResize}
              onDoubleClick={() => setPaneLayout((prev) => ({ ...prev, rightRailWidth: 360 }))}
            />
            <WorkspaceRightRail
              activeTab={paneLayout.rightRailTab}
              width={paneLayout.rightRailWidth}
              projectName={currentProject?.name || 'Default project'}
              documents={libraryDocuments}
              documentsLoading={libraryLoading}
              onSelectTab={(tab) => setPaneLayout((prev) => ({ ...prev, rightRailTab: tab }))}
              onClose={() => setPaneLayout((prev) => ({ ...prev, rightRailOpen: false }))}
              onRefreshDocuments={() => void refreshLibrary()}
              onIndexFolder={() => void indexLibraryFolder()}
              onReadDocument={(id) => readLibraryDocument(id, 0)}
              onOpenExternal={async (id) => { await openLibraryDocument(id); }}
              onListFsDir={bridge.kind === 'ready' && bridge.bridge.workspaceFs ? (rel) => bridge.bridge.workspaceFs!.listDir(rel) : undefined}
              onReadFsFile={bridge.kind === 'ready' && bridge.bridge.workspaceFs ? (rel) => bridge.bridge.workspaceFs!.readFile(rel) : undefined}
              terminalSessions={terminalSessions}
              onRunTerminalCommand={runTerminalCommand}
              onCancelTerminalSession={cancelTerminalSession}
              onStopTerminal={chat.stop}
              terminalBusy={terminalSessions.some((s) => s.status === 'running')}
              tasks={tasks}
              audit={audit}
            />
          </>
        ) : null}

        {contextOpen ? <WorkspaceTaskDetails
          task={activeTask}
          onClose={() => setContextOpen(false)}
          onOpenTasks={() => { setView('tasks'); setContextOpen(false); }}
          onPause={(id) => taskAction('pause', id)}
          onResume={(id) => taskAction('resume', id)}
          onCancel={(id) => taskAction('cancel', id)}
          onContinue={(id) => { if (bridge.kind === 'ready') void bridge.bridge.tasks.continueAfterHandoff(id).catch(() => setNotice('Pixel could not continue this task.')); }}
        /> : null}
      </div>

      <footer className="workspace-status-strip" aria-label="Workspace runtime status" data-status-strip>
        <div className="workspace-status-group">
          <span className="workspace-status-item">
            <span
              className={`workspace-status-dot${stopped ? ' is-stopped' : chat.streaming || activeTask ? ' is-busy' : ''}`}
              aria-hidden="true"
            />
            <strong>{settings.agent?.runtimeEngine === 'python' ? 'Python v2' : 'TypeScript'}</strong>
          </span>
          <span className="workspace-status-sep" aria-hidden="true">·</span>
          <span className="workspace-status-item">{getModeDescriptor(activeMode).label}</span>
          {currentProject?.name && currentProject.name !== 'Default project' ? (
            <>
              <span className="workspace-status-sep" aria-hidden="true">·</span>
              <span className="workspace-status-item truncate">{currentProject.name}</span>
            </>
          ) : null}
        </div>
        <div className="workspace-status-group">
          {tasks.filter(isTaskActive).length > 0 ? (
            <>
              <span className="workspace-status-item">
                {tasks.filter(isTaskActive).length} active {tasks.filter(isTaskActive).length === 1 ? 'task' : 'tasks'}
              </span>
              <span className="workspace-status-sep" aria-hidden="true">·</span>
            </>
          ) : null}
          {plugins.filter((item) => item.enabled).length > 0 ? (
            <>
              <span className="workspace-status-item">
                {plugins.filter((item) => item.enabled).length} {plugins.filter((item) => item.enabled).length === 1 ? 'plugin' : 'plugins'}
              </span>
              <span className="workspace-status-sep" aria-hidden="true">·</span>
            </>
          ) : null}
          <ModelPickerPopover
            providerSettings={settings.provider}
            hasApiKey={Boolean(hasApiKey)}
            onSelectModel={handleSelectModel}
            onSelectEffort={handleSelectEffort}
          />
        </div>
      </footer>

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

function mergeTask(current: TaskRecord[], next: TaskRecord): TaskRecord[] {
  return [next, ...current.filter((task) => task.id !== next.id)].sort((a,b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

function taskTimestamp(task: TaskRecord): number {
  return task.updatedAt ?? task.createdAt;
}

function WorkspacePanelLoading(): React.JSX.Element {
  return <div className="workspace-panel-loading" role="status" aria-live="polite">Loading this view…</div>;
}
