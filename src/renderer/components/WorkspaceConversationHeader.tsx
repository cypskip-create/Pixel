import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, MoreHorizontal, Search, X } from 'lucide-react';
import type { Mode } from '@shared/types';
import { CompactModeSelector } from '@/components/CompactModeSelector';

interface WorkspaceConversationHeaderProps {
  title: string;
  projectName?: string;
  currentMode: Mode;
  onRequestMode: (mode: Mode) => void;
  onSearchWeb: (query: string) => void;
  canSearch: boolean;
  hasTaskDetails: boolean;
  onOpenTaskDetails: () => void;
}

export function WorkspaceConversationHeader({
  title, projectName, currentMode, onRequestMode, onSearchWeb, canSearch,
  hasTaskDetails, onOpenTaskDetails,
}: WorkspaceConversationHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    setSearchOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen && !searchOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [closeMenu, menuOpen, searchOpen]);

  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchInputRef.current?.focus());
    else if (menuOpen) window.requestAnimationFrame(() => firstMenuItemRef.current?.focus());
  }, [menuOpen, searchOpen]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const searchValue = query.trim();
    if (!searchValue || !canSearch) return;
    onSearchWeb(searchValue);
    setQuery('');
    closeMenu();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (active + 1 + items.length) % items.length
          : (active - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <header className="workspace-chat-heading" data-conversation-header>
      <div className="workspace-conversation-title">
        <h1 title={title}>{title}</h1>
        {projectName ? <span>{projectName}</span> : null}
      </div>
      <div className="workspace-conversation-controls">
        <CompactModeSelector current={currentMode} onRequestMode={onRequestMode} />
        <div ref={rootRef} className="workspace-conversation-menu-anchor">
          <button
            ref={menuButtonRef}
            type="button"
            className="workspace-icon-control"
            aria-label="More conversation actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen || searchOpen}
            title="More"
            onClick={() => {
              if (searchOpen) {
                setSearchOpen(false);
                setMenuOpen(true);
              } else setMenuOpen((open) => !open);
            }}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>

          {menuOpen && !searchOpen ? (
            <div className="workspace-context-menu" role="menu" aria-label="Conversation actions" onKeyDown={onMenuKeyDown}>
              <button
                ref={firstMenuItemRef}
                type="button"
                role="menuitem"
                disabled={!canSearch}
                onClick={() => { setMenuOpen(false); setSearchOpen(true); }}
              >
                <Search size={15} aria-hidden="true" /> Search the web…
              </button>
              {hasTaskDetails ? (
                <button type="button" role="menuitem" onClick={() => { closeMenu(); onOpenTaskDetails(); }}>
                  <MoreHorizontal size={15} aria-hidden="true" /> Task details
                </button>
              ) : null}
            </div>
          ) : null}

          {searchOpen ? (
            <form className="workspace-web-search" role="search" onSubmit={submitSearch}>
              <label htmlFor="workspace-web-search-input">Search the web</label>
              <div>
                <input
                  ref={searchInputRef}
                  id="workspace-web-search-input"
                  value={query}
                  maxLength={500}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Enter a search"
                />
                <button type="submit" aria-label="Open search results" disabled={!query.trim()}><ArrowUp size={15} /></button>
                <button type="button" aria-label="Close web search" onClick={() => closeMenu(true)}><X size={14} /></button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
