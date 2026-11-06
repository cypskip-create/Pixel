import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ArrowUp,
  Camera,
  ChevronDown,
  Ear,
  Image as ImageIcon,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import type { AssistantState, ImageAttachment, Mode } from '@shared/types';
import { getModeDescriptor } from '@shared/types';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/IconButton';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { truncate } from '@/lib/format';

/** The bar is deliberately narrow: it is a companion, not a workspace. */
export const BAR_WIDTH = 460;

interface InputBarProps {
  mode: Mode;
  state: AssistantState;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onCollapse: () => void;
  onAttachScreenshot: () => void;
  onAttachFile: () => void;
  onToggleListening: () => void;
  listening: boolean;
  attachments: ImageAttachment[];
  onRemoveAttachment: (index: number) => void;
  onRequestMode: (mode: Mode) => void;
  modeMenuOpen: boolean;
  onToggleModeMenu: () => void;
  onCloseModeMenu: () => void;
  busy: boolean;
  /** Blocks submission when the native bridge is unavailable. */
  disabled: boolean;
}

const PLACEHOLDER: Record<Mode, string> = {
  guide: 'Ask Cyps to explain something…',
  hybrid: 'Ask Cyps, or tell it what you need…',
  agent: 'Tell Cyps what to do on this computer…',
};

export function InputBar(props: InputBarProps) {
  const {
    mode,
    state,
    draft,
    onDraftChange,
    onSubmit,
    onStop,
    onCollapse,
    onAttachScreenshot,
    onAttachFile,
    onToggleListening,
    listening,
    attachments,
    onRemoveAttachment,
    onRequestMode,
    modeMenuOpen,
    onToggleModeMenu,
    onCloseModeMenu,
    busy,
    disabled,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptor = getModeDescriptor(mode);
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !busy && !disabled;

  // Auto-focus on activation: the user opened this to type.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }, []);

  // Grow with content, then scroll internally. Never taller than 5 lines.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${String(Math.min(node.scrollHeight, 104))}px`;
  }, [draft]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (canSend) onSubmit();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // First Escape closes an open menu; a second collapses the bar.
        if (modeMenuOpen) {
          onCloseModeMenu();
          return;
        }
        onCollapse();
      }
    },
    [canSend, onSubmit, onCollapse, modeMenuOpen, onCloseModeMenu],
  );

  const modeChip = useMemo(
    () => (
      <button
        type="button"
        onClick={onToggleModeMenu}
        aria-haspopup="menu"
        aria-expanded={modeMenuOpen}
        aria-label={`Mode: ${descriptor.label}. ${descriptor.summary} Change mode.`}
        className="no-drag flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-glass-border)] bg-white/7 px-2 py-1 text-[11px] font-medium text-[var(--color-ink-soft)] transition-colors duration-[var(--cyps-duration-fast)] hover:bg-white/14 hover:text-[var(--color-ink)]"
      >
        {descriptor.allowsStateChange ? (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        ) : (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-300" />
        )}
        {descriptor.label}
        <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />
      </button>
    ),
    [descriptor, modeMenuOpen, onToggleModeMenu],
  );

  return (
    <section
      aria-label="Cyps input"
      style={{ width: BAR_WIDTH }}
      className="glass-raised animate-slide-down relative flex flex-col gap-2 rounded-[var(--cyps-radius)] p-2.5"
    >
      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 px-1" aria-label="Attached images">
          {attachments.map((attachment, index) => (
            <li key={`${attachment.source}-${String(index)}`}>
              <span className="flex items-center gap-1.5 rounded-lg border border-[var(--color-glass-border)] bg-white/7 py-0.5 pl-1 pr-1.5 text-[10px] text-[var(--color-ink-soft)]">
                <img
                  src={attachment.dataUrl}
                  alt=""
                  className="h-5 w-8 rounded object-cover"
                  aria-hidden="true"
                />
                <span className="max-w-[110px] truncate">
                  {truncate(attachment.label ?? 'Screenshot', 22)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  aria-label={`Remove attachment ${attachment.label ?? 'screenshot'}`}
                  className="no-drag rounded-full p-0.5 hover:bg-white/15"
                >
                  <X size={10} strokeWidth={3} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        {/* Left rail: the orb doubles as the status indicator. */}
        <div className="no-drag flex shrink-0 items-center pb-0.5 pl-0.5">
          <Avatar state={state} size={28} halo />
        </div>

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? 'Native bridge unavailable' : PLACEHOLDER[mode]}
          aria-label="Message Cyps"
          className="selectable min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)] disabled:cursor-not-allowed"
        />

        <div className="no-drag flex shrink-0 items-center gap-1 pb-0.5">
          <IconButton
            label={listening ? 'Stop listening' : 'Hold to talk'}
            onClick={onToggleListening}
            active={listening}
            tone={listening ? 'primary' : 'ghost'}
            disabled={disabled}
          >
            <Ear size={15} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>

          <IconButton
            label="Attach screenshot of active window"
            onClick={onAttachScreenshot}
            disabled={disabled}
          >
            <Camera size={15} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>

          <IconButton label="Attach a file" onClick={onAttachFile} disabled={disabled}>
            <Paperclip size={15} strokeWidth={2.2} aria-hidden="true" />
          </IconButton>

          {busy ? (
            <IconButton label="Stop generating" onClick={onStop} tone="danger">
              <Square size={13} strokeWidth={3} aria-hidden="true" />
            </IconButton>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send message"
              title="Send message (Enter)"
              className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/25 text-sky-50 transition-colors duration-[var(--cyps-duration-fast)] hover:bg-sky-500/40 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-white/7 disabled:text-[var(--color-ink-dim)]"
            >
              <ArrowUp size={16} strokeWidth={2.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <div className="relative flex items-center gap-1.5">
          {modeChip}
          <span className="text-[10px] text-[var(--color-ink-dim)]">
            {descriptor.allowsStateChange ? 'Can act on your PC' : 'Read-only'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-[var(--color-ink-dim)]">
          <span className="hidden sm:inline">
            <kbd className="rounded bg-white/8 px-1 py-px font-sans">Enter</kbd> send
          </span>
          <span className="hidden sm:inline">
            <kbd className="rounded bg-white/8 px-1 py-px font-sans">Esc</kbd> hide
          </span>
          {attachments.length > 0 ? (
            <span className="flex items-center gap-1">
              <ImageIcon size={10} strokeWidth={2.4} aria-hidden="true" />
              {attachments.length}
            </span>
          ) : null}
        </div>
      </div>

      {modeMenuOpen ? (
        <ModeSwitcher
          current={mode}
          onRequestMode={onRequestMode}
          onDismiss={onCloseModeMenu}
          variant="popover"
        />
      ) : null}
    </section>
  );
}
