import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check, FolderKanban, Maximize2, Minimize2, Plus, ShieldAlert, Wrench, X,
} from 'lucide-react';
import type {
  AssistantState, AuditEntry, ConversationSummary, DiagnosticsSnapshot, ImageAttachment, Mode, PermissionDecision,
  PermissionRequest, ProjectView, TaskRecord, ToolCatalogEntry, WorkspaceWindowState,
} from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { deriveAssistantState } from '@shared/companion-state';
import { AutomationPanel } from '@/components/AutomationPanel';
import { WorkspaceConversationHeader } from '@/components/WorkspaceConversationHeader';
import { WorkspaceComposer } from '@/components/WorkspaceComposer';
import { MarkdownMessage } from '@/components/MarkdownMessage';
import { MemoryPanel } from '@/components/MemoryPanel';
import { ProductivityPanel } from '@/components/ProductivityPanel';
import { PermissionCard } from '@/components/PermissionCard';
import { PixelBoard } from '@/components/PixelBoard';
import { PixelMark } from '@/components/PixelMark';
import { WorkspacePixPlay } from '@/components/WorkspacePixPlay';
import { SettingsPanel } from '@/components/SettingsPanel';
import { WorkspaceSidebar, type WorkspaceView } from '@/components/WorkspaceSidebar';
import { WorkspaceTaskActivity, WorkspaceTaskDetails } from '@/components/WorkspaceTaskActivity';
import { useBridge } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useSettings } from '@/hooks/useSettings';
import { useVoicePlaybackState } from '@/hooks/useVoicePlaybackState';
import { safeSubscribe } from '@/lib/bridge';
import { taskDisplayState, selectActiveTask, isTaskActive } from '@/lib/task-presentation';
import { MicrophoneCapture } from '@/lib/audioCapture';

export function Workspace(): React.JSX.Element {
  const bridge = useBridge();
  const { settings, hasApiKey, error: settingsError, saving, patch, setMode, saveApiKey, removeApiKey, testApiKeyConnection } = useSettings();
  const chat = useChat(settings.privacy.persistHistory);
  const [view, setView] = useState<WorkspaceView>('chat');
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
  const [projectDraft, setProjectDraft] = useState('');
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [listening, setListening] = useState(false);
  const speaking = useVoicePlaybackState();
  const [pushToTalkState, setPushToTalkState] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'submitting'>('idle');
  const [recentOutcome, setRecentOutcome] = useState<TaskRecord | null>(null);
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
  const returnFromSettings = useCallback(() => {
    const previous = settingsReturnView.current;
    settingsReturnView.current = 'chat';
    setView(previous === 'settings' ? 'chat' : previous);
  }, []);
  useLayoutEffect(() => {
    if (view === 'chat' && scrollRef.current) scrollRef.current.scrollTop = chatScrollTop.current;
  }, [view]);
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
    const load = (): void => { void api.listProjects().then((items) => { if (alive) setProjects(items); }).catch(() => undefined); };
    load();
    const unsubscribe = safeSubscribe(api.onProjectChanged, load);
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let alive = true;
    void Promise.all([bridge.bridge.tools.list(), bridge.bridge.audit.list(80)]).then(([nextTools, nextAudit]) => {
      if (alive) { setTools(nextTools); setAudit(nextAudit); }
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
    if (await chat.openConversation(id)) { setRecentOutcome(null); setContextOpen(false); setView('chat'); }
  }, [chat.openConversation]);

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

  const viewTitle: Record<WorkspaceView, string> = {
    chat: 'Workspace', projects: 'Projects', tasks: 'Tasks & Activity', notes: 'Notes & Planning', skills: 'Skills & Routines',
    memory: 'Memory', tools: 'Tools', board: 'Pixel Board', settings: 'Settings',
  };
  const pendingApproval = permission ? (
    <div className="workspace-approval" aria-label="Approval required">
      <PermissionCard request={permission} pending={permissionPending} onDecide={(decision) => void respondPermission(decision)} compact />
    </div>
  ) : null;

  return (
    <div className={`workspace-shell${settings.companion.reducedMotion ? ' reduce-motion' : ''}`} data-workspace>
      <header className="workspace-titlebar drag">
        <div className="flex min-w-0 items-center gap-2"><PixelMark size={22} /><span className="pixel-wordmark pixel-wordmark-large">PIXEL</span><span className="workspace-title-divider" />
          <span className="truncate text-[13px] text-[var(--color-ink-soft)]">{viewTitle[view]}</span>
        </div>
        <div className="workspace-window-controls no-drag">
          <button type="button" aria-label={stopped ? 'Clear emergency stop' : 'Emergency stop'} aria-pressed={stopped} onClick={() => void toggleEmergency()} title={stopped ? 'Clear emergency stop' : 'Emergency stop'} className={`workspace-window-button workspace-emergency-control ${stopped ? 'is-active' : ''}`}><ShieldAlert size={15} /></button>
          <button type="button" aria-label={windowState.maximized ? 'Restore window' : 'Maximize window'} onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.toggleWorkspaceMaximize(); }} title={windowState.maximized ? 'Restore' : 'Maximize'} className="workspace-window-button">{windowState.maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          <button type="button" aria-label="Minimize Pixel Workspace" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.minimizeWorkspace(); }} className="workspace-window-button">—</button>
          <button type="button" aria-label="Close Pixel Workspace" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.closeWorkspace(); }} className="workspace-window-button workspace-close-button"><X size={15} /></button>
        </div>
      </header>

      <div className="workspace-body">
        {view !== 'settings' ? <WorkspaceSidebar
          view={view}
          onViewChange={(nextView) => nextView === 'settings' ? openSettings() : setView(nextView)}
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

          {view === 'chat' ? <section className="workspace-conversation">
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
              {chat.streaming ? <article className="workspace-message workspace-assistant-message"><div className="min-w-0 flex-1"><div className="workspace-message-meta"><span>Pixel</span><span className="text-neutral-200">{chat.model ?? 'Thinking'}</span></div>{chat.reasoning ? <details className="workspace-reasoning"><summary>Reasoning details</summary><p>{chat.reasoning}</p></details> : null}<MarkdownMessage text={chat.content || 'Thinking…'} /></div></article> : null}
              {chat.error ? <p role="alert" className="workspace-error">{chat.error}</p> : null}
            </div>
            <WorkspacePixPlay state={assistantState} reducedMotion={settings.companion.reducedMotion} />
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
          </section> : null}

          {view === 'projects' ? <ProjectsView projects={projects} draft={projectDraft} setDraft={setProjectDraft} onSelect={async (name) => { if (bridge.kind !== 'ready') return; try { await bridge.bridge.memory.setActiveProject(name); setHistory(await bridge.bridge.history.list({limit:50})); setView('chat'); } catch { setNotice('Pixel could not switch projects while a task is running.'); } }} /> : null}
          {view === 'tasks' ? <TasksView tasks={tasks} audit={audit} onAction={taskAction} onContinue={(id) => { if (bridge.kind === 'ready') void bridge.bridge.tasks.continueAfterHandoff(id).catch(() => setNotice('Pixel could not continue that handoff.')); }} /> : null}
          {view === 'notes' ? <ProductivityPanel /> : null}
          {view === 'skills' ? <div className="workspace-page"><div className="workspace-page-heading"><h1>Skills & Routines</h1><p>Review implemented workflows and their local schedules.</p></div><AutomationPanel onBack={() => setView('chat')} returnLabel="Back to Workspace" /></div> : null}
          {view === 'memory' ? <div className="workspace-page"><div className="workspace-page-heading"><h1>Project memory</h1><p>Locally stored memories for the selected project.</p></div><MemoryPanel onBack={() => setView('chat')} returnLabel="Back to Workspace" /></div> : null}
          {view === 'tools' ? <ToolsView tools={tools} /> : null}
          {view === 'board' ? <PixelBoard emergencyStopped={stopped} /> : null}
          {view === 'settings' ? <div className="workspace-settings"><SettingsPanel settings={settings} displays={displays} onPatch={patch} onRequestMode={chooseMode} onClose={returnFromSettings} hasApiKey={hasApiKey} onSaveApiKey={saveApiKey} onRemoveApiKey={removeApiKey} onTestConnection={testApiKeyConnection} error={settingsError} saving={saving} workspaceLayout /></div> : null}
        </main>

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
    </div>
  );
}
function ProjectsView({ projects, draft, setDraft, onSelect }: { projects: ProjectView[]; draft: string; setDraft: (value: string) => void; onSelect: (name: string) => void }): React.JSX.Element {
  return <section className="workspace-page"><div className="workspace-page-heading"><h1>Projects</h1><p>Each project has its own conversations and memory scope.</p></div><form className="workspace-create-project" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onSelect(draft.trim()); }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Create or open a project" aria-label="Project name" maxLength={80} /><button type="submit" disabled={!draft.trim()}><Plus size={15} /> Open project</button></form><div className="workspace-project-grid">{projects.map((project) => <button type="button" key={project.id} onClick={() => onSelect(project.name)} className={`workspace-project-card ${project.active ? 'is-active' : ''}`}><span className="workspace-project-icon"><FolderKanban size={18} /></span><span className="min-w-0 flex-1 text-left"><strong>{project.name}</strong><small>{project.description || (project.active ? 'Current project' : 'Project scope')}</small></span>{project.active ? <Check size={16} className="text-neutral-200" /> : null}</button>)}</div><p className="mt-4 text-[11px] text-[var(--color-ink-dim)]">Pixel stores project names and memory in its local SQLite database. Project deletion is not available in this build.</p></section>;
}

function TasksView({ tasks, audit, onAction, onContinue }: { tasks: TaskRecord[]; audit: AuditEntry[]; onAction: (action: 'pause'|'resume'|'cancel', id: string) => void; onContinue: (id: string) => void }): React.JSX.Element {
  const active = tasks.filter((task) => !['completed','failed','cancelled'].includes(task.status));
  const finished = tasks.filter((task) => ['completed','failed','cancelled'].includes(task.status));
  return <section className="workspace-page"><div className="workspace-page-heading"><h1>Tasks & Activity</h1><p>Task outcomes and audit activity.</p></div>{active.length ? <><h2 className="workspace-section-title">Active and waiting</h2><div className="workspace-task-grid">{active.map((task) => { const display = taskDisplayState(task); return <article className="workspace-task-card" key={task.id}><header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status.replaceAll('_',' ')}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header><h3>{task.title}</h3>{task.request ? <p className="workspace-task-request">{task.request}</p> : null}<div className="workspace-task-steps">{task.steps.map((step) => <div key={step.id}><span className={`workspace-step-dot step-${step.status}`} /><span>{step.title}</span>{step.detail ? <small>{step.detail}</small> : null}</div>)}</div>{task.result ? <p className="workspace-task-result">{task.result}</p> : null}<footer>{task.status === 'running' || task.status === 'planning' ? <button type="button" onClick={() => onAction('pause',task.id)}>Pause</button> : null}{task.status === 'paused' ? <button type="button" onClick={() => onAction('resume',task.id)}>Resume</button> : null}{task.reobserveRequired ? <button type="button" onClick={() => onContinue(task.id)}>Continue after review</button> : null}{!['completed','failed','cancelled'].includes(task.status) ? <button className="danger" type="button" onClick={() => onAction('cancel',task.id)}>Cancel</button> : null}</footer></article>; })}</div></> : <div className="workspace-empty-card">No active tasks.</div>}{finished.length ? <><h2 className="workspace-section-title mt-6">Recent outcomes</h2><div className="workspace-task-grid">{finished.slice(0,12).map((task) => { const display = taskDisplayState(task); return <article className="workspace-task-card" key={task.id}><header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header><h3>{task.title}</h3>{display.verificationPending ? <p className="workspace-task-result">The action finished, but its postcondition still needs verification.</p> : task.result ? <p className="workspace-task-result">{task.result}</p> : <p className="text-[12px] text-[var(--color-ink-dim)]">No saved result.</p>}</article>; })}</div></> : null}<h2 className="workspace-section-title mt-6">Audit activity</h2><div className="workspace-audit-list">{audit.slice(0,30).map((entry) => <article key={entry.id}><span className={`audit-outcome outcome-${entry.outcome}`} /><div><p>{entry.summary}</p>{entry.detail ? <small>{entry.detail}</small> : null}</div><time>{new Date(entry.at).toLocaleTimeString()}</time></article>)}</div></section>;
}

function ToolsView({ tools }: { tools: ToolCatalogEntry[] }): React.JSX.Element {
  const categories: Array<{ id: ToolCatalogEntry['category']; title: string }> = [
    { id: 'screen', title: 'Screen' },
    { id: 'input', title: 'Computer control' },
    { id: 'browser', title: 'Browser' },
    { id: 'files', title: 'Files' },
    { id: 'documents', title: 'Documents' },
    { id: 'productivity', title: 'Notes & tasks' },
    { id: 'board', title: 'Pixel Board' },
    { id: 'system', title: 'System' },
    { id: 'memory', title: 'Memory' },
    { id: 'code', title: 'Code' },
  ];
  const capabilityNotes = [
    { title: 'Desktop drawing editor', status: 'Partial', detail: 'Pixel can show passive highlights and arrows on verified accessible controls. Freehand desktop editing and saved overlay sessions are not available.' },
    { title: 'File organization', status: 'Partial', detail: 'Scoped list, filtered search, metadata, read, write, create, copy, rename/move, bounded batch operations, duplicate detection, approved open and Recycle Bin send are available. Visible application launch and restore-from-Recycle-Bin verification remain outstanding.' },
    { title: 'Document creation', status: 'Partial', detail: 'Documents can be indexed and searched. Direct authored document round-trip remains unavailable.' },
    { title: 'Workflow recording', status: 'Partial', detail: 'Saved workflow and local routine infrastructure exists. A live semantic recorder integrated with normal tasks is not available.' },
    { title: 'Specialist delegation', status: 'Partial', detail: 'The bounded coordinator exists but is not connected to live conversation execution. Infrastructure and Pixel Code specialists are unavailable.' },
    { title: 'Clipboard access', status: 'Partial', detail: 'Approval-gated one-shot text read/copy/conditional restore and verified field set are available. Real Windows acceptance remains outstanding.' },
    { title: 'Notes and planning tasks', status: 'Partial', detail: 'Project-scoped notes and tasks are persisted, agent-editable, and user-browsable/editable in Notes & Planning. Checklist grouping, richer due-date editing, Markdown import/export, and Windows acceptance remain outstanding.' },
    { title: 'Expanded system diagnostics', status: 'Partial', detail: 'CPU, memory, disk, uptime and display facts are available. Network adapter, running-app, selected-process and audio-device diagnostics are not available.' },
  ];
  return <section className="workspace-page">
    <div className="workspace-page-heading"><h1>Tools</h1><p>Registered capabilities and their prerequisites. Runtime-dependent tools are checked again when used.</p></div>
    {tools.length === 0 ? <div className="workspace-empty-card">No agent tools are registered in this build.</div> : categories.map((category) => {
      const members = tools.filter((tool) => tool.category === category.id);
      if (members.length === 0) return null;
      return <section className="workspace-tool-group" key={category.id} aria-label={`${category.title} tools`}>
        <h2 className="workspace-section-title">{category.title}<span>{members.length}</span></h2>
        <div className="workspace-tool-grid">{members.map((tool) => <article key={tool.name} className="workspace-tool-card">
          <header><Wrench size={15} /><strong>{tool.name.replaceAll('_', ' ')}</strong><span className={`risk risk-${tool.risk}`}>{tool.risk}</span></header>
          <p>{tool.description}</p>
          <footer>{tool.changesState ? 'Changes computer or document state' : 'Read only'} · {tool.requiresApproval ? 'Approval may be required' : 'No approval required by tool policy'}</footer>
          {tool.dependency ? <small className={`workspace-tool-availability availability-${tool.availability ?? 'not_checked'}`}>
            {tool.availability === 'ready' ? 'Dependency verified' : tool.availability === 'unavailable' ? 'Currently unavailable' : tool.availability === 'not_checked' ? 'Checked when first used' : 'Conditional · checked when used'} · {tool.dependency}
          </small> : null}
          {tool.availabilityReason ? <small className="workspace-tool-unavailable-reason">{tool.availabilityReason}</small> : null}
        </article>)}</div>
      </section>;
    })}
    <section className="workspace-tool-group" aria-label="Partial and unavailable capabilities">
      <h2 className="workspace-section-title">Partial or unavailable</h2>
      <div className="workspace-tool-gap-grid">{capabilityNotes.map((item) => <article className="workspace-tool-gap" key={item.title}>
        <header><strong>{item.title}</strong><span className={`workspace-capability-status status-${item.status.toLowerCase()}`}>{item.status}</span></header>
        <p>{item.detail}</p>
      </article>)}</div>
    </section>
  </section>;
}

function mergeTask(current: TaskRecord[], next: TaskRecord): TaskRecord[] {
  return [next, ...current.filter((task) => task.id !== next.id)].sort((a,b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

function taskTimestamp(task: TaskRecord): number {
  return task.updatedAt ?? task.createdAt;
}
