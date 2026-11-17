import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Brain, Check, ChevronDown, Clock3, FolderKanban, ListTodo, Maximize2,
  MessagesSquare, Mic, Minimize2, PanelLeftClose, PanelRightClose, Paperclip, Plus,
  Search, Settings, ShieldAlert, Sparkles, Square, Wrench, X,
} from 'lucide-react';
import type {
  AuditEntry, ConversationSummary, DiagnosticsSnapshot, ImageAttachment, Mode, PermissionDecision,
  PermissionRequest, ProjectView, TaskRecord, ToolCatalogEntry, WorkspaceWindowState,
} from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { AutomationPanel } from '@/components/AutomationPanel';
import { MarkdownMessage } from '@/components/MarkdownMessage';
import { MemoryPanel } from '@/components/MemoryPanel';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { PermissionCard } from '@/components/PermissionCard';
import { PixelMark } from '@/components/PixelMark';
import { SettingsPanel } from '@/components/SettingsPanel';
import { TaskStrip } from '@/components/TaskStrip';
import { useBridge } from '@/hooks/useBridge';
import { useChat } from '@/hooks/useChat';
import { useSettings } from '@/hooks/useSettings';
import { safeSubscribe } from '@/lib/bridge';
import { taskDisplayState } from '@/lib/task-presentation';
import { IconButton } from '@/components/IconButton';

type WorkspaceView = 'chat' | 'projects' | 'tasks' | 'skills' | 'memory' | 'tools' | 'settings';

const NAV: Array<{ id: WorkspaceView; label: string; icon: typeof MessagesSquare }> = [
  { id: 'chat', label: 'Chats', icon: MessagesSquare },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks & Activity', icon: ListTodo },
  { id: 'skills', label: 'Skills & Routines', icon: Sparkles },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Workspace(): React.JSX.Element {
  const bridge = useBridge();
  const { settings, hasApiKey, error: settingsError, saving, patch, setMode, saveApiKey, removeApiKey, testApiKeyConnection } = useSettings();
  const chat = useChat(settings.privacy.persistHistory);
  const [view, setView] = useState<WorkspaceView>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);
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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeMode = settings.companion.mode;
  const activeTask = useMemo(() => tasks.find((task) => ['running','planning','pause_requested','awaiting_approval','awaiting_user','paused','blocked','cancelling'].includes(task.status)) ?? tasks[0] ?? null, [tasks]);
  const title = chat.historyLoading ? 'Restoring conversation…' : history.find((item) => item.id === chat.conversationId)?.title ?? 'New conversation';

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
    const api = bridge.bridge.permissions;
    const unsubRequest = safeSubscribe<PermissionRequest>(api.onRequest, setPermission);
    const unsubResolved = safeSubscribe<string>(api.onResolved, (id) => setPermission((current) => current?.id === id ? null : current));
    let alive = true;
    void api.listPending().then((items) => { if (alive && items.length) setPermission(items[0] ?? null); }).catch(() => undefined);
    const unsubStop = safeSubscribe(bridge.bridge.system.onEmergencyStop, () => setStopped(true));
    void bridge.bridge.system.isEmergencyStopped().then((value) => { if (alive) setStopped(value); }).catch(() => undefined);
    return () => { alive = false; unsubRequest(); unsubResolved(); unsubStop(); };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.tasks;
    let alive = true;
    const unsubscribe = safeSubscribe<TaskRecord>(api.onUpdate, (next) => setTasks((current) => mergeTask(current, next)));
    void api.list().then((items) => { if (alive) setTasks(items.sort((a,b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))); }).catch(() => undefined);
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

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.messages.length, chat.content, chat.reasoning]);

  const openNewChat = useCallback(async () => {
    const created = await chat.newConversation();
    if (created) { setDraft(''); setAttachments([]); setView('chat'); }
  }, [chat.newConversation]);

  const chooseMode = useCallback((next: Mode) => {
    if (getModeDescriptor(next).allowsStateChange && !getModeDescriptor(activeMode).allowsStateChange) setPendingMode(next);
    else setMode(next);
  }, [activeMode, setMode]);

  const submit = useCallback(async () => {
    if (chat.streaming || (draft.trim() === '' && attachments.length === 0) || bridge.kind !== 'ready') return;
    if (stopped) { setNotice('Emergency stop is active. Clear it before starting another task.'); return; }
    const sent = await chat.send({ text: draft, images: attachments, mode: activeMode });
    if (sent) { setDraft(''); setAttachments([]); setView('chat'); }
  }, [activeMode, attachments, bridge, chat, draft, stopped]);

  const attachImage = useCallback(() => fileRef.current?.click(), []);
  const attachScreenshot = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    try {
      const result = await bridge.bridge.screen.captureActiveWindow();
      if (result.ok && result.image) setAttachments((current) => [...current, result.image as ImageAttachment].slice(0, 4));
      else setNotice(result.error?.message ?? 'Pixel could not capture the active window.');
    } catch { setNotice('Pixel could not capture the active window.'); }
  }, [bridge]);

  const toggleVoice = useCallback(async () => {
    const shell = window.cypsShell;
    if (!shell?.voiceListen || !shell.voiceCapability) { setNotice('Voice input is unavailable in this build.'); return; }
    if (listening) { setListening(false); await shell.voiceCancel?.(); return; }
    setListening(true);
    try {
      const capability = await shell.voiceCapability();
      if (!capability.speechToText) { setNotice(capability.reason ?? 'No speech recognizer is installed.'); return; }
      const result = await shell.voiceListen(8_000);
      if (result.ok && result.text.trim()) setDraft((current) => current ? `${current} ${result.text}` : result.text);
      else if (!result.error?.toLowerCase().includes('cancelled')) setNotice(result.error ?? 'Pixel did not hear anything.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Voice input failed.'); }
    finally { setListening(false); }
  }, [listening]);

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
    if (await chat.openConversation(id)) setView('chat');
  }, [chat.openConversation]);

  const runSearch = useCallback((query: string) => {
    if (!query.trim() || bridge.kind !== 'ready' || !chat.conversationId) return;
    void bridge.bridge.browser.openSearch(query, `Search for ${query}`, chat.conversationId).catch(() => setNotice('Pixel could not open the browser search.'));
  }, [bridge, chat.conversationId]);

  const currentProject = projects.find((project) => project.active);

  return (
    <div className="workspace-shell" data-workspace>
      <header className="workspace-titlebar drag">
        <div className="flex min-w-0 items-center gap-2"><PixelMark size={22} /><span className="pixel-wordmark pixel-wordmark-large">PIXEL</span><span className="workspace-title-divider" />
          <span className="truncate text-[13px] text-[var(--color-ink-soft)]">{view === 'chat' ? title : NAV.find((item) => item.id === view)?.label}</span>
        </div>
        <div className="workspace-window-controls no-drag">
          <button type="button" aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setSidebarOpen((open) => !open)} title="Toggle navigation" className="workspace-window-button"><PanelLeftClose size={15} /></button>
          <button type="button" aria-label={contextOpen ? 'Hide task panel' : 'Show task panel'} onClick={() => setContextOpen((open) => !open)} title="Toggle task panel" className="workspace-window-button"><PanelRightClose size={15} /></button>
          <button type="button" aria-label={windowState.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.setWorkspaceFullscreen(!windowState.fullscreen); }} title="Fullscreen" className="workspace-window-button"><Maximize2 size={15} /></button>
          <button type="button" aria-label={windowState.maximized ? 'Restore window' : 'Maximize window'} onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.toggleWorkspaceMaximize(); }} title={windowState.maximized ? 'Restore' : 'Maximize'} className="workspace-window-button">{windowState.maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          <button type="button" aria-label="Minimize Pixel Workspace" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.minimizeWorkspace(); }} className="workspace-window-button">—</button>
          <button type="button" aria-label="Close Pixel Workspace" onClick={() => { if (bridge.kind === 'ready') void bridge.bridge.window.closeWorkspace(); }} className="workspace-window-button workspace-close-button"><X size={15} /></button>
        </div>
      </header>

      <div className="workspace-body">
        {sidebarOpen ? <aside className="workspace-sidebar">
          <button type="button" className="workspace-new-chat" onClick={() => void openNewChat()} disabled={chat.streaming || chat.historyLoading}><Plus size={16} /> New chat</button>
          <nav aria-label="Workspace navigation" className="mt-4 space-y-1">
            {NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setView(id)} className={`workspace-nav-item ${view === id ? 'is-active' : ''}`}><Icon size={16} /><span>{label}</span>{id === 'tasks' && tasks.some((task) => ['running','planning','awaiting_approval','paused'].includes(task.status)) ? <span className="workspace-nav-count">{tasks.filter((task) => ['running','planning','awaiting_approval','paused'].includes(task.status)).length}</span> : null}</button>)}
          </nav>
          <div className="mt-6 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--color-ink-dim)]"><Clock3 size={12} /> Recent chats</div>
          <label className="workspace-search mt-2"><Search size={13} /><input aria-label="Search chats" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search chats" /></label>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {history.length === 0 ? <p className="px-2 py-3 text-[11px] text-[var(--color-ink-dim)]">No matching conversations.</p> : history.map((item) => <button key={item.id} type="button" onClick={() => void openConversation(item.id)} className={`workspace-history-item ${chat.conversationId === item.id ? 'is-active' : ''}`}><span className="block truncate text-[12px]">{item.title}</span><span className="mt-1 block truncate text-[10px] text-[var(--color-ink-dim)]">{item.preview || 'No messages yet'}</span></button>)}
          </div>
          <div className="workspace-project-chip"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /><span className="truncate">{currentProject?.name ?? 'Default project'}</span><button type="button" aria-label="Open project selector" onClick={() => setView('projects')}><ChevronDown size={13} /></button></div>
        </aside> : null}

        <main className="workspace-main">
          {notice ? <div role="status" className="workspace-notice">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={13} /></button></div> : null}
          {pendingMode ? <div className="workspace-mode-confirm" role="alertdialog" aria-label="Confirm agent mode"><div><strong>Switch to {getModeDescriptor(pendingMode).label}?</strong><p>{getModeDescriptor(pendingMode).summary} Pixel will still ask before every consequential action.</p></div><button type="button" onClick={() => setPendingMode(null)}>Cancel</button><button type="button" onClick={() => { setMode(pendingMode); setPendingMode(null); }}>Switch mode</button></div> : null}

          {view === 'chat' ? <section className="workspace-conversation">
            <div className="workspace-chat-heading"><div><h1>{title}</h1><p>{currentProject?.name ?? 'Default project'} · {chat.persistence === 'session' ? 'Session only' : 'Saved locally'}</p></div><div className="flex items-center gap-2"><ModeSwitcher current={activeMode} onRequestMode={chooseMode} variant="inline" /><button type="button" className="workspace-subtle-button" onClick={() => runSearch(window.prompt('Search the web for…') ?? '')}><Search size={14} /> Search web</button></div></div>
            <div className="workspace-transcript selectable" ref={scrollRef} aria-label="Conversation">
              {chat.messages.length === 0 && !chat.streaming ? <div className="workspace-empty"><div className="workspace-mark-halo"><PixelMark size={42} /></div><h2>What would you like to work on?</h2><p>Ask a question, explore an idea, or start an approved task.</p><div className="workspace-suggestions"><button type="button" onClick={() => setDraft('Summarize the key points of a topic for me.')}>Summarize a topic</button><button type="button" onClick={() => setDraft('Help me plan the next steps for my project.')}>Plan a project</button><button type="button" onClick={() => setDraft('Search the web for the latest information about ')}>Search the web</button></div></div> : null}
              {chat.messages.map((message) => <article key={message.id} className={`workspace-message ${message.role === 'user' ? 'workspace-user-message' : 'workspace-assistant-message'}`}>
                {message.role === 'assistant' ? <div className="workspace-message-mark"><PixelMark size={19} /></div> : null}
                <div className="min-w-0 flex-1"><div className="workspace-message-meta"><span>{message.role === 'user' ? 'You' : 'Pixel'}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.aborted ? <span>Stopped</span> : null}</div>{message.error && !message.content ? <p role="alert" className="text-rose-200">{message.error}</p> : <MarkdownMessage text={message.content || (message.aborted ? 'Response stopped before any text arrived.' : '')} />}{message.error && message.content ? <p role="alert" className="mt-2 text-rose-200">{message.error}</p> : null}</div>
              </article>)}
              {chat.streaming ? <article className="workspace-message workspace-assistant-message"><div className="workspace-message-mark"><PixelMark size={19} /></div><div className="min-w-0 flex-1"><div className="workspace-message-meta"><span>Pixel</span><span className="text-cyan-200">{chat.model ?? 'Thinking'}</span></div>{chat.reasoning ? <details className="mb-2 rounded-lg border border-violet-300/15 bg-violet-300/5 p-2"><summary className="cursor-pointer text-[12px] text-violet-200">Reasoning details</summary><p className="mt-2 whitespace-pre-wrap text-[12px] text-[var(--color-ink-dim)]">{chat.reasoning}</p></details> : null}<MarkdownMessage text={chat.content || 'Thinking…'} /></div></article> : null}
              {chat.error ? <p role="alert" className="workspace-error">{chat.error}</p> : null}
            </div>
            <div className="workspace-composer">
              {attachments.length ? <div className="flex flex-wrap gap-2 px-2 pt-2">{attachments.map((image,index) => <span key={`${image.label}-${index}`} className="workspace-attachment"><img src={image.dataUrl} alt="" /><span>{image.label ?? 'Image'}</span><button type="button" aria-label={`Remove ${image.label ?? 'image'}`} onClick={() => setAttachments((items) => items.filter((_,i) => i !== index))}><X size={12} /></button></span>)}</div> : null}
              <textarea aria-label="Message Pixel" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={bridge.kind === 'ready' ? 'Message Pixel…' : 'Desktop bridge unavailable'} disabled={bridge.kind !== 'ready' || chat.historyLoading} rows={1} className="workspace-composer-input selectable" />
              <div className="workspace-composer-footer"><div className="flex items-center gap-1">
                <IconButton label={listening ? 'Stop listening' : 'Voice input'} onClick={() => void toggleVoice()} active={listening}><Mic size={16} /></IconButton>
                <IconButton label="Capture active window" onClick={() => void attachScreenshot()}><span className="text-xs">▣</span></IconButton>
                <IconButton label="Attach images" onClick={attachImage}><Paperclip size={15} /></IconButton>
                <span className="workspace-composer-hint">Enter to send · Shift+Enter for a new line</span>
              </div><div className="flex items-center gap-2">{chat.streaming ? <button type="button" aria-label="Stop response" className="workspace-stop-button" onClick={chat.stop}><Square size={13} /> Stop</button> : <button type="button" aria-label="Send message" className="workspace-send-button" onClick={() => void submit()} disabled={!draft.trim() && attachments.length === 0}><ArrowUp size={17} /></button>}</div></div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(event) => { const files = [...(event.target.files ?? [])].filter((file) => file.type.startsWith('image/')).slice(0, 4); for (const file of files) { const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') setAttachments((items) => [...items, { dataUrl: reader.result as string, mimeType: file.type as ImageAttachment['mimeType'], width: 0, height: 0, source: 'upload' as const, label: file.name }].slice(0,4)); }; reader.readAsDataURL(file); } if (event.target.files?.length && !files.length) setNotice('Pixel can attach images in PNG, JPEG, WebP or GIF format.'); event.target.value = ''; }} />
            </div>
          </section> : null}

          {view === 'projects' ? <ProjectsView projects={projects} draft={projectDraft} setDraft={setProjectDraft} onSelect={async (name) => { if (bridge.kind !== 'ready') return; try { await bridge.bridge.memory.setActiveProject(name); setHistory(await bridge.bridge.history.list({limit:50})); setView('chat'); } catch { setNotice('Pixel could not switch projects while a task is running.'); } }} /> : null}
          {view === 'tasks' ? <TasksView tasks={tasks} audit={audit} onAction={taskAction} onContinue={(id) => { if (bridge.kind === 'ready') void bridge.bridge.tasks.continueAfterHandoff(id).catch(() => setNotice('Pixel could not continue that handoff.')); }} /> : null}
          {view === 'skills' ? <div className="workspace-page"><div className="workspace-page-heading"><h1>Skills & Routines</h1><p>Review implemented workflows and their local schedules.</p></div><AutomationPanel onBack={() => setView('chat')} returnLabel="Back to Workspace" /></div> : null}
          {view === 'memory' ? <div className="workspace-page"><div className="workspace-page-heading"><h1>Project memory</h1><p>Locally stored memories for the selected project.</p></div><MemoryPanel onBack={() => setView('chat')} returnLabel="Back to Workspace" /></div> : null}
          {view === 'tools' ? <ToolsView tools={tools} /> : null}
          {view === 'settings' ? <div className="workspace-settings"><SettingsPanel settings={settings} displays={displays} onPatch={patch} onRequestMode={chooseMode} onClose={() => setView('chat')} hasApiKey={hasApiKey} onSaveApiKey={saveApiKey} onRemoveApiKey={removeApiKey} onTestConnection={testApiKeyConnection} error={settingsError} saving={saving} workspaceLayout /></div> : null}
        </main>

        {contextOpen ? <aside className="workspace-context" aria-label="Task activity">
          <div className="workspace-context-heading"><div><h2>Activity</h2><p>Shared with Pixel Island</p></div><button type="button" aria-label="Close activity panel" onClick={() => setContextOpen(false)}><PanelRightClose size={15} /></button></div>
          {permission ? <div className="mb-3"><PermissionCard request={permission} pending={permissionPending} onDecide={(decision) => void respondPermission(decision)} compact /></div> : null}
          {activeTask ? <div className="mb-3"><TaskStrip task={activeTask} compact onPause={() => taskAction('pause',activeTask.id)} onResume={() => taskAction('resume',activeTask.id)} onCancel={() => taskAction('cancel',activeTask.id)} onContinue={() => { if (bridge.kind === 'ready') void bridge.bridge.tasks.continueAfterHandoff(activeTask.id); }} /></div> : <div className="workspace-context-empty"><ListTodo size={18} /><p>No active task</p><span>Agent activity and approvals appear here.</span></div>}
          {activeTask ? <div className="workspace-step-list"><h3>Execution steps</h3>{activeTask.steps.map((step) => <div className="workspace-step" key={step.id}><span className={`workspace-step-dot step-${step.status}`} /> <div><p>{step.title}</p><span>{step.detail ?? step.toolName ?? step.status}</span></div></div>)}</div> : null}
          {stopped ? <button type="button" className="workspace-emergency is-active" onClick={() => void toggleEmergency()}><ShieldAlert size={15} /> Clear emergency stop</button> : <button type="button" className="workspace-emergency" onClick={() => void toggleEmergency()}><ShieldAlert size={15} /> Emergency stop</button>}
        </aside> : null}
      </div>
      <footer className="workspace-statusbar"><span><i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {bridge.kind === 'ready' ? 'Pixel is ready' : 'Desktop bridge unavailable'}</span><span>{settings.provider.primaryModel} · {getModeDescriptor(activeMode).label}{hasApiKey === false ? ' · API key not configured' : ''}</span></footer>
    </div>
  );
}

function ProjectsView({ projects, draft, setDraft, onSelect }: { projects: ProjectView[]; draft: string; setDraft: (value: string) => void; onSelect: (name: string) => void }): React.JSX.Element {
  return <section className="workspace-page"><div className="workspace-page-heading"><h1>Projects</h1><p>Each project has its own conversations and memory scope.</p></div><form className="workspace-create-project" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onSelect(draft.trim()); }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Create or open a project" aria-label="Project name" maxLength={80} /><button type="submit" disabled={!draft.trim()}><Plus size={15} /> Open project</button></form><div className="workspace-project-grid">{projects.map((project) => <button type="button" key={project.id} onClick={() => onSelect(project.name)} className={`workspace-project-card ${project.active ? 'is-active' : ''}`}><span className="workspace-project-icon"><FolderKanban size={18} /></span><span className="min-w-0 flex-1 text-left"><strong>{project.name}</strong><small>{project.description || (project.active ? 'Current project' : 'Project scope')}</small></span>{project.active ? <Check size={16} className="text-cyan-200" /> : null}</button>)}</div><p className="mt-4 text-[11px] text-[var(--color-ink-dim)]">Pixel stores project names and memory in its local SQLite database. Project deletion is not available in this build.</p></section>;
}

function TasksView({ tasks, audit, onAction, onContinue }: { tasks: TaskRecord[]; audit: AuditEntry[]; onAction: (action: 'pause'|'resume'|'cancel', id: string) => void; onContinue: (id: string) => void }): React.JSX.Element {
  const active = tasks.filter((task) => !['completed','failed','cancelled'].includes(task.status));
  const finished = tasks.filter((task) => ['completed','failed','cancelled'].includes(task.status));
  return <section className="workspace-page"><div className="workspace-page-heading"><h1>Tasks & Activity</h1><p>Durable task status, completed steps, approvals, and audit events.</p></div>{active.length ? <><h2 className="workspace-section-title">Active and waiting</h2><div className="workspace-task-grid">{active.map((task) => { const display = taskDisplayState(task); return <article className="workspace-task-card" key={task.id}><header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status.replaceAll('_',' ')}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header><h3>{task.title}</h3>{task.request ? <p className="workspace-task-request">{task.request}</p> : null}<div className="workspace-task-steps">{task.steps.map((step) => <div key={step.id}><span className={`workspace-step-dot step-${step.status}`} /><span>{step.title}</span>{step.detail ? <small>{step.detail}</small> : null}</div>)}</div>{task.result ? <p className="workspace-task-result">{task.result}</p> : null}<footer>{task.status === 'running' || task.status === 'planning' ? <button type="button" onClick={() => onAction('pause',task.id)}>Pause</button> : null}{task.status === 'paused' ? <button type="button" onClick={() => onAction('resume',task.id)}>Resume</button> : null}{task.reobserveRequired ? <button type="button" onClick={() => onContinue(task.id)}>Continue after review</button> : null}{!['completed','failed','cancelled'].includes(task.status) ? <button className="danger" type="button" onClick={() => onAction('cancel',task.id)}>Cancel</button> : null}</footer></article>; })}</div></> : <div className="workspace-empty-card">No active tasks. Pixel will show approvals and agent execution here.</div>}{finished.length ? <><h2 className="workspace-section-title mt-6">Recent outcomes</h2><div className="workspace-task-grid">{finished.slice(0,12).map((task) => { const display = taskDisplayState(task); return <article className="workspace-task-card" key={task.id}><header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header><h3>{task.title}</h3>{display.verificationPending ? <p className="workspace-task-result">The action finished, but its postcondition still needs verification.</p> : task.result ? <p className="workspace-task-result">{task.result}</p> : <p className="text-[12px] text-[var(--color-ink-dim)]">No saved result.</p>}</article>; })}</div></> : null}<h2 className="workspace-section-title mt-6">Audit activity</h2><div className="workspace-audit-list">{audit.slice(0,30).map((entry) => <article key={entry.id}><span className={`audit-outcome outcome-${entry.outcome}`} /><div><p>{entry.summary}</p>{entry.detail ? <small>{entry.detail}</small> : null}</div><time>{new Date(entry.at).toLocaleTimeString()}</time></article>)}</div></section>;
}

function ToolsView({ tools }: { tools: ToolCatalogEntry[] }): React.JSX.Element {
  return <section className="workspace-page"><div className="workspace-page-heading"><h1>Tools</h1><p>Capabilities currently registered with Pixel. Permission rules still apply to every run.</p></div><div className="workspace-tool-grid">{tools.map((tool) => <article key={tool.name} className="workspace-tool-card"><header><Wrench size={15} /><strong>{tool.name}</strong><span className={`risk risk-${tool.risk}`}>{tool.risk}</span></header><p>{tool.description}</p><footer>{tool.category}{tool.changesState ? ' · changes state' : ' · read only'}{tool.requiresApproval ? ' · approval required' : ''}</footer></article>)}</div></section>;
}

function mergeTask(current: TaskRecord[], next: TaskRecord): TaskRecord[] {
  return [next, ...current.filter((task) => task.id !== next.id)].sort((a,b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}
