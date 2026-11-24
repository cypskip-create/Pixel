import { useState, type FormEvent } from 'react';
import {
  Activity, Bot, Check, Clock, Compass, FileText, FolderKanban, FolderOpen, Layers, LayoutGrid, MessageSquare,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, Puzzle, Radio, Search, Settings, Share2, Trash2, Upload, User, Webhook, X,
} from 'lucide-react';
import type { ConversationSummary, ProjectView } from '@shared/types';

export type WorkspaceView =
  | 'chat'
  | 'command-center'
  | 'projects'
  | 'library'
  | 'artifacts'
  | 'tasks'
  | 'cron'
  | 'notes'
  | 'skills'
  | 'memory'
  | 'tools'
  | 'plugins'
  | 'capabilities'
  | 'messaging'
  | 'webhooks'
  | 'profiles'
  | 'agents'
  | 'starmap'
  | 'session-import'
  | 'board'
  | 'settings';

const NAV_ITEMS: Array<{ id: 'command-center' | 'projects' | 'library' | 'board' | 'tasks'; label: string; icon: typeof FolderKanban }> = [
  { id: 'command-center', label: 'Command Center', icon: Compass },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'library', label: 'Library', icon: FolderOpen },
  { id: 'board', label: 'Pixel Board', icon: LayoutGrid },
  { id: 'tasks', label: 'Running Tasks', icon: Activity },
];

const DESKTOP_DESTINATIONS: Array<{
  id: 'capabilities' | 'messaging' | 'webhooks' | 'artifacts' | 'cron' | 'profiles' | 'agents' | 'starmap' | 'session-import';
  label: string;
  icon: typeof FolderKanban;
}> = [
  { id: 'capabilities', label: 'Capabilities', icon: Puzzle },
  { id: 'messaging', label: 'Messaging', icon: Radio },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'artifacts', label: 'Artifacts', icon: Layers },
  { id: 'cron', label: 'Schedules', icon: Clock },
  { id: 'profiles', label: 'Profiles', icon: User },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'starmap', label: 'Starmap', icon: Share2 },
  { id: 'session-import', label: 'Import Session', icon: Upload },
];

interface WorkspaceSidebarProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  history: ConversationSummary[];
  selectedConversationId: string | null;
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
  onOpenConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, title: string) => Promise<boolean>;
  onDeleteConversation: (id: string) => Promise<boolean>;
  currentProject: ProjectView | undefined;
  activeTaskCount: number;
  disabled: boolean;
}

export function WorkspaceSidebar({
  view, onViewChange, collapsed, onToggleCollapsed, history, selectedConversationId,
  historySearch, onHistorySearchChange, onOpenConversation, onNewChat,
  onRenameConversation, onDeleteConversation, currentProject, activeTaskCount, disabled,
}: WorkspaceSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(Boolean(historySearch));
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!renaming || !renameDraft.trim()) return;
    const saved = await onRenameConversation(renaming.id, renameDraft.trim());
    if (saved) {
      setRenaming(null);
      setRenameDraft('');
      setError(null);
    } else {
      setError('Could not rename this chat.');
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    const deleted = await onDeleteConversation(deleteTarget.id);
    if (deleted) {
      setDeleteTarget(null);
      setError(null);
    } else {
      setError('Could not delete this chat.');
    }
  };

  const showSearch = searchOpen || historySearch.length > 0;

  return (
    <aside className="workspace-sidebar" data-collapsed={collapsed} aria-label="Workspace sidebar">
      <div className="workspace-sidebar-top">
        <button type="button" className="workspace-new-chat" onClick={onNewChat} disabled={disabled} title="New Chat">
          <Plus size={15} aria-hidden="true" /><span>New Chat</span>
        </button>
        <button
          type="button"
          className="workspace-sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={onToggleCollapsed}
        >{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
      </div>

      <nav className="workspace-sidebar-nav" aria-label="Workspace navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`workspace-nav-item ${view === id ? 'is-active' : ''}`}
            aria-label={label}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onViewChange(id)}
            title={label}
          >
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
            {id === 'tasks' && activeTaskCount > 0 ? <span className="workspace-nav-count">{activeTaskCount}</span> : null}
          </button>
        ))}
      </nav>

      <div className="workspace-sidebar-divider" aria-hidden="true" />

      <nav className="workspace-sidebar-nav" aria-label="Desktop destinations">
        {DESKTOP_DESTINATIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`workspace-nav-item ${view === id ? 'is-active' : ''}`}
            aria-label={label}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onViewChange(id)}
            title={label}
          >
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="workspace-sidebar-divider" aria-hidden="true" />

      <section className="workspace-recent" aria-label="Recent chats">
        <div className="workspace-section-label">
          <span>Recent Chats</span>
          <button
            type="button"
            className="workspace-search-toggle"
            aria-label="Search recent chats"
            aria-pressed={showSearch}
            title="Search recent chats"
            onClick={() => {
              if (showSearch && historySearch) onHistorySearchChange('');
              setSearchOpen((open) => !open);
            }}
          >
            <Search size={13} aria-hidden="true" />
          </button>
        </div>

        {showSearch ? (
          <label className="workspace-search">
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search chats"
              value={historySearch}
              onChange={(event) => onHistorySearchChange(event.target.value.slice(0, 120))}
              placeholder="Search chats…"
            />
          </label>
        ) : null}

        {currentProject && currentProject.name !== 'Default project' ? (
          <div className="workspace-project-pill" title={`Active project: ${currentProject.name}`}>
            <FolderKanban size={11} aria-hidden="true" />
            <span>{currentProject.name}</span>
          </div>
        ) : null}

        {error ? <p role="alert" className="workspace-sidebar-error">{error}</p> : null}

        <div className="workspace-history-list">
          {history.length === 0 ? <p className="workspace-sidebar-empty">{historySearch ? 'No matching chats.' : 'No conversations yet.'}</p> : null}
          {history.map((item) => {
            const isActive = view === 'chat' && selectedConversationId === item.id;
            return (
              <div key={item.id} className={`workspace-history-row ${isActive ? 'is-active' : ''}`}>
                {renaming?.id === item.id ? (
                  <form className="workspace-rename-form" onSubmit={(event) => void submitRename(event)}>
                    <input aria-label="Conversation title" value={renameDraft} maxLength={80} autoFocus onChange={(event) => setRenameDraft(event.target.value)} />
                    <button type="submit" aria-label="Save conversation title" disabled={!renameDraft.trim()}><Check size={14} /></button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={14} /></button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="workspace-history-open"
                      disabled={disabled}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onOpenConversation(item.id)}
                      title={`${item.title} · ${relativeDate(item.updatedAt)}`}
                    >
                      <MessageSquare size={14} aria-hidden="true" />
                      <span className="workspace-history-title">{item.title}</span>
                    </button>
                    <div className="workspace-history-actions">
                      <button type="button" aria-label={`Rename ${item.title}`} title={`Rename ${item.title}`} disabled={disabled} onClick={() => { setRenaming(item); setRenameDraft(item.title); }}><Pencil size={13} /></button>
                      <button type="button" aria-label={`Delete ${item.title}`} title={`Delete ${item.title}`} disabled={disabled} onClick={() => setDeleteTarget(item)}><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="workspace-sidebar-bottom">
        <button
          type="button"
          className={`workspace-nav-item ${view === 'notes' ? 'is-active' : ''}`}
          aria-label="Notes & Planning"
          aria-current={view === 'notes' ? 'page' : undefined}
          onClick={() => onViewChange('notes')}
          title="Notes & Planning"
        ><FileText size={15} aria-hidden="true" /><span>Notes & Planning</span></button>
        <button
          type="button"
          className={`workspace-nav-item workspace-settings-link ${view === 'settings' ? 'is-active' : ''}`}
          aria-label="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => onViewChange('settings')}
          title="Settings"
        >
          <Settings size={15} aria-hidden="true" /><span>Settings</span>
        </button>
      </div>

      {deleteTarget ? (
        <div className="workspace-sidebar-confirm" role="alertdialog" aria-labelledby="workspace-delete-title" aria-describedby="workspace-delete-description">
          <h2 id="workspace-delete-title">Delete this chat?</h2>
          <p id="workspace-delete-description">“{deleteTarget.title}” will be removed from local history.</p>
          <div>
            <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="is-danger" onClick={() => void confirmDelete()}>Delete</button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function relativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
