import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, ChevronRight, Square, X } from 'lucide-react';
import type { ChatMessage } from '@shared/types';

interface ConversationTranscriptProps {
  messages: ChatMessage[];
  content: string;
  reasoning: string;
  streaming: boolean;
  error: string | null;
  persistence: 'persistent' | 'session';
  onStop: () => void;
  onDismiss: () => void;
}

export function ConversationTranscript({
  messages,
  content,
  reasoning,
  streaming,
  error,
  persistence,
  onStop,
  onDismiss,
}: ConversationTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, content]);

  return (
    <section aria-label="Conversation transcript" data-layout-panel className="glass flex w-[460px] flex-col overflow-hidden rounded-[var(--cyps-radius)]" style={{ maxHeight: 'min(46vh, 320px)' }}>
      <div ref={scrollRef} className="selectable min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {messages.map((message) => (
          <article key={message.id} className={message.role === 'user' ? 'ml-7 rounded-xl bg-sky-300/10 px-2.5 py-2' : 'mr-3 rounded-xl bg-white/5 px-2.5 py-2'}>
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">{message.role === 'user' ? 'You' : 'Pixel'}{message.aborted ? ' · Stopped' : ''}</p>
            {message.error && !message.content ? <p role="alert" className="text-[11px] text-rose-200">{message.error}</p> : null}
            <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--color-ink)]">{message.content || (message.aborted ? 'Response stopped before any text arrived.' : '')}</p>
            {message.error && message.content ? <p role="alert" className="mt-1 text-[10px] text-rose-200">{message.error}</p> : null}
          </article>
        ))}
        {streaming ? (
          <article className="mr-3 rounded-xl bg-white/5 px-2.5 py-2">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-dim)]">Pixel · Responding</p>
            {reasoning.trim() ? (
              <details open={reasoningOpen} onToggle={(event) => setReasoningOpen(event.currentTarget.open)} className="mb-1.5 border-b border-white/8 pb-1.5">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-violet-200">
                  <ChevronRight size={11} aria-hidden="true" className={reasoningOpen ? 'rotate-90' : ''} />
                  <Brain size={11} aria-hidden="true" /> Thought process
                </summary>
                {reasoningOpen ? <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--color-ink-dim)]">{reasoning}</p> : null}
              </details>
            ) : null}
            <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--color-ink)]">{content || 'Thinking…'}</p>
          </article>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[10.5px] text-rose-200">
            <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />{error}
          </p>
        ) : null}
      </div>
      <footer className="flex items-center justify-between border-t border-[var(--color-glass-border)] px-2.5 py-1.5">
        <span className="text-[9.5px] text-[var(--color-ink-dim)]">{persistence === 'session' ? 'This chat is only saved for this session' : 'Saved on this device'}</span>
        {streaming ? (
          <button type="button" onClick={onStop} className="no-drag flex items-center gap-1 rounded-full border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-100 hover:bg-rose-500/20"><Square size={10} aria-hidden="true" /> Stop</button>
        ) : (
          <button type="button" aria-label="Close transcript" onClick={onDismiss} className="no-drag rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-white/8 hover:text-[var(--color-ink)]"><X size={12} aria-hidden="true" /></button>
        )}
      </footer>
    </section>
  );
}
