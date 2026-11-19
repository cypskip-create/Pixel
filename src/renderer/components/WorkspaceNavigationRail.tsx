import { Brain, FolderKanban, ListTodo, MessagesSquare, PenLine, Settings, ShieldAlert, Wrench } from 'lucide-react';
import type { WorkspaceView } from './WorkspaceSidebar';

interface Props {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  emergencyStopped: boolean;
  onEmergencyStop: () => void;
}

const PRIMARY_ITEMS = [
  { view: 'chat', label: 'Chats', icon: MessagesSquare },
  { view: 'projects', label: 'Projects', icon: FolderKanban },
  { view: 'tasks', label: 'Tasks and activity', icon: ListTodo },
  { view: 'board', label: 'Pixel Board', icon: PenLine },
  { view: 'tools', label: 'Tools', icon: Wrench },
  { view: 'memory', label: 'Memory', icon: Brain },
] as const;

/** Compact app-section rail beside the independently scrolling chat sidebar. */
export function WorkspaceNavigationRail({ view, onViewChange, emergencyStopped, onEmergencyStop }: Props): React.JSX.Element {
  return (
    <nav className="workspace-rail" aria-label="Pixel sections">
      <div className="workspace-rail-items">
        {PRIMARY_ITEMS.map(({ view: itemView, label, icon: Icon }) => (
          <button
            key={itemView}
            type="button"
            className={`workspace-rail-button${view === itemView ? ' is-active' : ''}`}
            aria-label={label}
            aria-current={view === itemView ? 'page' : undefined}
            title={label}
            onClick={() => onViewChange(itemView)}
          >
            <Icon size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="workspace-rail-bottom">
        <button
          type="button"
          className={`workspace-rail-button workspace-rail-stop${emergencyStopped ? ' is-active' : ''}`}
          aria-label={emergencyStopped ? 'Clear emergency stop' : 'Emergency stop'}
          aria-pressed={emergencyStopped}
          title={emergencyStopped ? 'Clear emergency stop' : 'Emergency stop'}
          onClick={onEmergencyStop}
        ><ShieldAlert size={18} aria-hidden="true" /></button>
        <button
          type="button"
          className={`workspace-rail-button${view === 'settings' ? ' is-active' : ''}`}
          aria-label="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          title="Settings"
          onClick={() => onViewChange('settings')}
        ><Settings size={18} aria-hidden="true" /></button>
      </div>
    </nav>
  );
}
