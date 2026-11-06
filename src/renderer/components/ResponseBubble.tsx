import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, ChevronRight, Copy, Check, Volume2 } from 'lucide-react';
import { IconButton } from '@/components/IconButton';

interface ResponseBubbleProps {
  /** Visible answer text, appended as deltas arrive. */
  content: string;
  /** Reasoning stream, shown separately when the model emits it. */
  reasoning: string;
  streaming: boolean;
  error: string | null;
  onCollapse: () => void;
  onStop: () => void;
  /** 0 disables the auto-dismiss countdown entirely. */
  autoDismissMs?: number;
  onDismiss?: () => void;
}

/**
 * The streaming answer surface.
 *
 * Deliberately capped: max ~46% of a 1080px-tall screen and 200px of internal
 * scroll, so an answer can never become "a large dashboard covering the
 * screen". Reasoning tokens render in a collapsed <details> rather than being
 * concatenated into the answer, because the two streams mean different things.
 */
export function ResponseBubble(props: ResponseBubbleProps) {
  const {
    content,
    reasoning,
    streaming,
    error,
    onCollapse,
    onStop,
    autoDismissMs = 0,
    onDismiss,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(autoDismissMs);

  // Follow the tail of the stream unless the user has scrolled up to read.
  const pinnedToBottom = useRef(true);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !pinnedToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [content, reasoning, reasoningOpen]);

  const handleScroll = (): void => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinnedToBottom.current = distanceFromBottom < 24;
  };

  // Optional auto-collapse after a finished, non-error answer.
  useEffect(() => {
    if (autoDismissMs <= 0 || streaming || error !== null || !onDismiss) return;
    setRemaining(autoDismissMs);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const left = autoDismissMs - (Date.now() - startedAt);
      if (left <= 0) {
        window.clearInterval(timer);
        onDismiss();
        return;
      }
      setRemaining(left);
    }, 250);
    return () => window.clearInterval(timer);
  }, [autoDismissMs, streaming, error, onDismiss, content]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* Clipboard may be denied; the text stays selectable. */
    }
  };

  const hasReasoning = reasoning.trim().length > 0;
  const showCountdown = autoDismissMs > 0 && !streaming && error === null && onDismiss !== undefined;

  return (
    <section
      aria-label="Cyps response"
      className="glass animate-slide-down flex w-[460px] flex-col overflow-hidden rounded-[var(--cyps-radius)]"
      style={{ maxHeight: 'min(46vh, 320px)' }}
    >
      {hasReasoning ? (
        <div className="border-b border-[var(--color-glass-border)]">
          <button
            type="button"
            onClick={() => setReasoningOpen((open) => !open)}
            aria-expanded={reasoningOpen}
            className="no-drag flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-[var(--color-ink-dim)] transition-colors duration-[var(--cyps-duration-fast)] hover:bg-white/6 hover:text-[var(--color-ink-soft)]"
          >
            <ChevronRight
              size={12}
              strokeWidth={2.6}
              aria-hidden="true"
              className="transition-transform duration-[var(--cyps-duration-fast)]"
              style={{ transform: reasoningOpen ? 'rotate(90deg)' : 'none' }}
            />
            <Brain size={12} strokeWidth={2.2} aria-hidden="true" />
            {streaming ? 'Thinking…' : 'Thought process'}
            {streaming ? (
              <span
                aria-hidden="true"
                className="ml-1 h-1 w-1 animate-pulse rounded-full bg-violet-300"
              />
            ) : (
              <span className="ml-auto text-[10px] opacity-70">
                {reasoning.trim().length} chars
              </span>
            )}
          </button>
          {reasoningOpen ? (
            <div className="selectable max-h-40 overflow-y-auto whitespace-pre-wrap px-3 pb-2.5 text-[11.5px] leading-relaxed text-[var(--color-ink-dim)]">
              {reasoning}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="selectable flex-1 overflow-y-auto px-3 py-2.5"
      >
        {error !== null ? (
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-rose-200">
            <AlertTriangle size={14} strokeWidth={2.3} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : content.length === 0 && streaming && !hasReasoning ? (
          <p className="shimmer-text text-[12.5px]">Thinking…</p>
        ) : (
          <p
            className={`whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)] ${
              streaming ? 'stream-caret' : ''
            }`}
          >
            {content}
          </p>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[var(--color-glass-border)] px-2 py-1.5">
        <div className="flex items-center gap-1">
          <IconButton label={copied ? 'Copied' : 'Copy answer'} onClick={() => void copy()} disabled={content.length === 0}>
            {copied ? (
              <Check size={14} strokeWidth={2.6} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={2.2} aria-hidden="true" />
            )}
          </IconButton>
          <span className="flex items-center gap-1 px-1 text-[10px] text-[var(--color-ink-dim)]">
            <Volume2 size={11} strokeWidth={2.2} aria-hidden="true" />
            Spoken aloud
          </span>
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="no-drag rounded-full border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-100 transition-colors duration-[var(--cyps-duration-fast)] hover:bg-rose-500/32"
          >
            Stop
          </button>
        ) : (
          <div className="flex items-center gap-1">
            {showCountdown ? (
              <span className="px-1 text-[10px] text-[var(--color-ink-dim)]">
                Hiding in {Math.ceil(remaining / 1000)}s
              </span>
            ) : null}
            <button
              type="button"
              onClick={onCollapse}
              className="no-drag rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink-dim)] transition-colors duration-[var(--cyps-duration-fast)] hover:bg-white/10 hover:text-[var(--color-ink)]"
            >
              Dismiss
            </button>
          </div>
        )}
      </footer>
    </section>
  );
}
