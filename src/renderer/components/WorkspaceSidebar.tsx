import { useState, type FormEvent } from 'react';
import {
  Brain, Check, ChevronDown, ChevronRight, FileText, FolderKanban, ListTodo, MessagesSquare,
  PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Settings, Sparkles, Trash2,
  Wrench, X,
} from 'lucide-react';
import { PenLine } from 'lucide-react';
import type { ConversationSummary, ProjectView } from '@shared/types';

export type WorkspaceView = 'chat' | 'projects' | 'tasks' | 'notes' | 'skills' | 'memory' | 'tools' | 'board' | 'settings';

const LIBRARY_ITEMS: Array<{ id: Exclude<WorkspaceView, 'chat' | 'settings'>; label: string; icon: typeof FolderKanban }> = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'tasks', label: 'Tasks & Activity', icon: ListTodo },
  { id: 'notes', label: 'Notes & Planning', icon: FileText },
  { id: 'skills', label: 'Skills & Routines', icon: Sparkles },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'board', label: 'Pixel Board', icon: PenLine },
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
  const [libraryOpen, setLibraryOpen] = useState(false);
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

  return (
    <aside className="workspace-sidebar" data-collapsed={collapsed} aria-label="Workspace sidebar">
      <div className="workspace-sidebar-top">
        <button type="button" className="workspace-new-chat" onClick={onNewChat} disabled={disabled} title="New chat">
          <Plus size={16} aria-hidden="true" />
          <span>New chat</span>
        </button>
        <button
          type="button"
          className="workspace-sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="workspace-sidebar-nav" aria-label="Workspace navigation">
        <button
          type="button"
          className={`workspace-nav-item ${view === 'chat' ? 'is-active' : ''}`}
          aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => onViewChange('chat')}
          title="Chats"
        >
          <MessagesSquare size={16} aria-hidden="true" /><span>Chats</span>
        </button>

        <button
          type="button"
          className={`workspace-nav-item workspace-library-trigger ${LIBRARY_ITEMS.some((item) => item.id === view) ? 'is-active' : ''}`}
          aria-expanded={libraryOpen}
          aria-controls="workspace-library-nav"
          onClick={() => setLibraryOpen((open) => !open)}
          title="Library"
        >
          <FolderKanban size={16} aria-hidden="true" />
          <span>Library</span>
          {!collapsed ? (libraryOpen ? <ChevronDown size={14} className="workspace-nav-chevron" /> : <ChevronRight size={14} className="workspace-nav-chevron" />) : null}
        </button>

        {libraryOpen ? (
          <div id="workspace-library-nav" className="workspace-library-nav">
            {LIBRARY_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`workspace-nav-item workspace-nav-item-nested ${view === id ? 'is-active' : ''}`}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => onViewChange(id)}
                title={label}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                {id === 'tasks' && activeTaskCount > 0 ? <span className="workspace-nav-count">{activeTaskCount}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      <section className="workspace-recent" aria-label="Recent conversations">
        <div className="workspace-section-label">
          <span>Recent chats</span>
          {!collapsed ? <span className="workspace-history-count">{history.length}</span> : null}
        </div>
        {!collapsed ? (
          <label className="workspace-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search chats"
              value={historySearch}
              onChange={(event) => onHistorySearchChange(event.target.value.slice(0, 120))}
              placeholder="Search chats"
            />
          </label>
        ) : null}

        {error ? <p role="alert" className="workspace-sidebar-error">{error}</p> : null}

        {!collapsed ? (
          <div className="workspace-history-list">
            {history.length === 0 ? <p className="workspace-sidebar-empty">{historySearch ? 'No matching chats.' : 'No conversations yet.'}</p> : null}
            {history.map((item) => (
              <div key={item.id} className={`workspace-history-row ${selectedConversationId === item.id ? 'is-active' : ''}`}>
                {renaming?.id === item.id ? (
                  <form className="workspace-rename-form" onSubmit={(event) => void submitRename(event)}>
                    <input
                      aria-label="Conversation title"
                      value={renameDraft}
                      maxLength={80}
                      autoFocus
                      onChange={(event) => setRenameDraft(event.target.value)}
                    />
                    <button type="submit" aria-label="Save conversation title" disabled={!renameDraft.trim()}><Check size={14} /></button>
                    <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={14} /></button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="workspace-history-open"
                      disabled={disabled}
                      aria-current={selectedConversationId === item.id ? 'page' : undefined}
                      onClick={() => onOpenConversation(item.id)}
                      title={item.title}
                    >
                      <span className="workspace-history-title">{item.title}</span>
                      <time>{relativeDate(item.updatedAt)}</time>
                    </button>
                    <div className="workspace-history-actions">
                      <button
                        type="button"
                        aria-label={`Rename ${item.title}`}
                        title={`Rename ${item.title}`}
                        disabled={disabled}
                        onClick={() => { setRenaming(item); setRenameDraft(item.title); }}
                      ><Pencil size={13} /></button>
                      <button
                        type="button"
                        aria-label={`Delete ${item.title}`}
                        title={`Delete ${item.title}`}
                        disabled={disabled}
                        onClick={() => setDeleteTarget(item)}
                      ><Trash2 size={13} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="workspace-sidebar-bottom">
        <button type="button" className="workspace-project-selector" onClick={() => onViewChange('projects')} title={`Project: ${currentProject?.name ?? 'Default project'}`}>
          <FolderKanban size={15} aria-hidden="true" />
          <span>{currentProject?.name ?? 'Default project'}</span>
        </button>
        <button
          type="button"
          className={`workspace-nav-item workspace-settings-link ${view === 'settings' ? 'is-active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => onViewChange('settings')}
          title="Settings"
        >
          <Settings size={16} aria-hidden="true" /><span>Settings</span>
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
