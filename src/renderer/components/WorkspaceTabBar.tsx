import { Columns2, Command, FolderTree, Plus, Terminal, X } from 'lucide-react';
import type { WorkspaceSessionTab } from '@/lib/workspaceTabs';

export interface WorkspaceTabBarProps {
  tabs: WorkspaceSessionTab[];
  activeTabId: string;
  splitEnabled: boolean;
  rightRailOpen: boolean;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onToggleSplit: () => void;
  onToggleRightRail: (tab?: 'files' | 'preview' | 'terminal' | 'context') => void;
  onOpenCommandPalette: () => void;
}

export function WorkspaceTabBar({
  tabs,
  activeTabId,
  splitEnabled,
  rightRailOpen,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onToggleSplit,
  onToggleRightRail,
  onOpenCommandPalette,
}: WorkspaceTabBarProps): React.JSX.Element {
  return (
    <div className="workspace-tabbar" role="tablist" aria-label="Conversation tabs">
      <div className="workspace-tabbar-scroll">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`workspace-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
              title={tab.title}
            >
              {tab.busy ? (
                <span className="workspace-tab-busy" aria-label="Running in background" />
              ) : null}
              <span className="workspace-tab-title">{tab.title}</span>
              {tab.draft.trim() && !isActive ? (
                <span className="workspace-tab-draft" title="Unsent draft" aria-label="Has draft" />
              ) : null}
              <button
                type="button"
                className="workspace-tab-close"
                aria-label={`Close tab ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="workspace-tab-new"
          onClick={onNewTab}
          aria-label="New conversation tab"
          title="New tab (Ctrl+T)"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="workspace-tabbar-actions">
        <button
          type="button"
          className="workspace-tabbar-btn"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette"
          title="Command Palette (Ctrl+K)"
        >
          <Command size={12} aria-hidden="true" />
          <span className="workspace-tabbar-kbd">Ctrl+K</span>
        </button>
        <button
          type="button"
          className={`workspace-tabbar-btn ${splitEnabled ? 'is-active' : ''}`}
          onClick={onToggleSplit}
          aria-label="Toggle split pane"
          aria-pressed={splitEnabled}
          title="Toggle split pane (Ctrl+\\)"
        >
          <Columns2 size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`workspace-tabbar-btn ${rightRailOpen ? 'is-active' : ''}`}
          onClick={() => onToggleRightRail('files')}
          aria-label="Toggle workspace files and preview"
          aria-pressed={rightRailOpen}
          title="Files & Preview (Ctrl+J)"
        >
          <FolderTree size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="workspace-tabbar-btn"
          onClick={() => onToggleRightRail('terminal')}
          aria-label="Toggle terminal panel"
          title="Terminal (Ctrl+`)"
        >
          <Terminal size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
