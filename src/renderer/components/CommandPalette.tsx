import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  group: 'Conversations' | 'Workspace' | 'Navigation' | 'Models';
  label: string;
  subtitle?: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previouslyFocused.current) {
      previouslyFocused.current.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.group.toLowerCase().includes(q) ||
        (cmd.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const grouped = new Map<string, Array<{ cmd: PaletteCommand; flatIdx: number }>>();
  filtered.forEach((cmd, flatIdx) => {
    const list = grouped.get(cmd.group) ?? [];
    list.push({ cmd, flatIdx });
    grouped.set(cmd.group, list);
  });

  const execute = (cmd: PaletteCommand | undefined): void => {
    if (!cmd || cmd.disabled) return;
    onClose();
    cmd.onSelect();
  };

  return (
    <div
      className="workspace-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="workspace-palette-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((i) => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((i) => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            execute(filtered[selectedIndex]);
          }
        }}
      >
        <div className="workspace-palette-input-row">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search commands"
            placeholder="Type a command, conversation, or model…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="workspace-palette-kbd">Esc</kbd>
        </div>

        <div className="workspace-palette-list" role="listbox" aria-label="Available commands">
          {filtered.length === 0 ? (
            <p className="workspace-palette-empty">No matching commands for &ldquo;{query}&rdquo;.</p>
          ) : (
            [...grouped.entries()].map(([group, entries]) => (
              <div key={group} className="workspace-palette-group">
                <div className="workspace-palette-group-title">{group}</div>
                {entries.map(({ cmd, flatIdx }) => {
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={cmd.disabled}
                      className={`workspace-palette-item ${isSelected ? 'is-selected' : ''}`}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => execute(cmd)}
                    >
                      <span className="workspace-palette-item-main">
                        <Command size={12} aria-hidden="true" />
                        <span>{cmd.label}</span>
                        {cmd.subtitle ? (
                          <span className="workspace-palette-item-sub">{cmd.subtitle}</span>
                        ) : null}
                      </span>
                      {cmd.shortcut ? (
                        <kbd className="workspace-palette-kbd">{cmd.shortcut}</kbd>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
