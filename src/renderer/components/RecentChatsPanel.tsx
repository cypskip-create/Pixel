import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clock3, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import type { ConversationSummary } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';

const PAGE_SIZE = 30;

interface RecentChatsPanelProps {
  selectedId: string | null;
  disabled?: boolean;
  onOpen: (id: string) => Promise<boolean>;
  onNew: () => Promise<boolean>;
  onClose: () => void;
}

export function RecentChatsPanel({ selectedId, disabled = false, onOpen, onNew, onClose }: RecentChatsPanelProps) {
  const bridge = useBridge();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const requestSequence = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (start: number, append: boolean) => {
    const requestId = ++requestSequence.current;
    if (bridge.kind !== 'ready') {
      setItems([]);
      setError('Chat history needs the desktop bridge.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await bridge.bridge.history.list({ limit: PAGE_SIZE, offset: start, search });
      if (requestSequence.current !== requestId) return;
      setItems((previous) => append ? mergeSummaries(previous, page) : page);
      setOffset(start + page.length);
      setHasMore(page.length === PAGE_SIZE && start + page.length < 50);
    } catch {
      if (requestSequence.current === requestId) setError('Recent chats could not be loaded.');
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, [bridge, search]);

  useEffect(() => {
    setOffset(0);
    void load(0, false);
    return () => { requestSequence.current += 1; };
  }, [load]);

  const groups = useMemo(() => groupConversations(items), [items]);

  const rename = async (item: ConversationSummary): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    const title = renameDraft.trim();
    if (!title) return;
    try {
      const updated = await bridge.bridge.history.rename(item.id, title);
      if (updated) {
        setItems((previous) => previous.map((candidate) => candidate.id === item.id ? updated : candidate));
        setRenamingId(null);
        setRenameDraft('');
      }
    } catch {
      setError('Pixel could not rename that conversation.');
    }
  };

  const remove = async (): Promise<void> => {
    if (bridge.kind !== 'ready' || !deleteId) return;
    try {
      await bridge.bridge.history.delete(deleteId);
      setItems((previous) => previous.filter((item) => item.id !== deleteId));
      const removedActive = deleteId === selectedId;
      setDeleteId(null);
      if (removedActive) await onNew();
    } catch {
      setError('Pixel could not delete that conversation.');
    }
  };

  const clear = async (): Promise<void> => {
    if (bridge.kind !== 'ready') return;
    try {
      await bridge.bridge.history.clear();
      setItems([]);
      setClearConfirm(false);
      await onNew();
    } catch {
      setError('Pixel could not clear chat history.');
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (clearConfirm) setClearConfirm(false);
      else if (deleteId !== null) setDeleteId(null);
      else if (renamingId !== null) {
        setRenamingId(null);
        setRenameDraft('');
      } else {
        onClose();
      }
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [clearConfirm, deleteId, onClose, renamingId]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  return (
    <section
      ref={panelRef}
      aria-label="Recent Chats"
      data-layout-panel
      className="glass-raised relative flex w-[460px] flex-col overflow-hidden rounded-[var(--cyps-radius)] border border-[var(--color-glass-border)] shadow-[0_14px_42px_rgb(0_0_0/0.3)]"
      style={{ maxHeight: 'min(56vh, 420px)' }}
    >
      <header className="flex items-center gap-2 border-b border-[var(--color-glass-border)] px-3 py-2">
        <Clock3 size={14} aria-hidden="true" className="text-sky-300" />
        <h2 className="flex-1 text-[12.5px] font-semibold text-[var(--color-ink)]">Recent Chats</h2>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void onNew()}
          className="no-drag inline-flex items-center gap-1 rounded-lg border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-300/18 disabled:opacity-45"
        >
          <MessageSquarePlus size={12} aria-hidden="true" /> New Chat
        </button>
        <button type="button" aria-label="Close Recent Chats" onClick={onClose} className="no-drag rounded-lg p-1 text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)]">
          <X size={13} aria-hidden="true" />
        </button>
      </header>

      <label className="mx-3 my-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/15 px-2 py-1.5 text-[var(--color-ink-dim)] focus-within:border-sky-300/45">
        <Search size={13} aria-hidden="true" />
        <input
          aria-label="Search Chats"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value.slice(0, 120))}
          placeholder="Search Chats"
          className="no-drag min-w-0 flex-1 bg-transparent text-[11px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)]"
        />
      </label>

      {error ? <p role="alert" className="mx-3 mb-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[10.5px] text-rose-200">{error}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && items.length === 0 ? <p role="status" className="px-2 py-6 text-center text-[11px] text-[var(--color-ink-dim)]">Loading chats…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="px-5 py-7 text-center">
            <p className="text-[12px] font-medium text-[var(--color-ink-soft)]">No conversations yet</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-dim)]">Start a new chat and Pixel will keep the thread here when history is enabled.</p>
          </div>
        ) : null}

        {groups.map(([group, conversations]) => (
          <section key={group} aria-label={group} className="mb-2">
            <h3 className="px-2 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-dim)]">{group}</h3>
            <ul className="space-y-1">
              {conversations.map((item) => (
                <li key={item.id}>
                  <div className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 transition-colors ${item.id === selectedId ? 'bg-sky-300/12 ring-1 ring-sky-300/20' : 'hover:bg-white/6'}`}>
                    {renamingId === item.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1"
                        onSubmit={(event) => { event.preventDefault(); void rename(item); }}
                      >
                        <input aria-label="Conversation title" autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value.slice(0, 80))} className="no-drag min-w-0 flex-1 rounded-md border border-white/12 bg-black/20 px-1.5 py-1 text-[11px] text-[var(--color-ink)] outline-none" />
                        <button type="submit" aria-label="Save conversation title" className="no-drag rounded-md p-1 text-emerald-200 hover:bg-white/10"><Check size={12} aria-hidden="true" /></button>
                        <button type="button" aria-label="Cancel rename" onClick={() => setRenamingId(null)} className="no-drag rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-white/10"><X size={12} aria-hidden="true" /></button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={disabled || loading}
                        onClick={() => void onOpen(item.id).then((opened) => { if (!opened) setError('Finish or cancel the active task before switching conversations.'); })}
                        className="no-drag min-w-0 flex-1 text-left disabled:opacity-45"
                      >
                        <span className="block truncate text-[11px] font-medium text-[var(--color-ink)]">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--color-ink-dim)]">{item.preview || 'No messages yet'}{item.persistence === 'session' ? ' · Session only' : ''}</span>
                      </button>
                    )}
                    {renamingId !== item.id ? (
                      <>
                        <span className="shrink-0 text-[9px] text-[var(--color-ink-dim)]">{relativeDate(item.updatedAt)}</span>
                        <button type="button" aria-label={`Rename ${item.title}`} onClick={() => { setRenameDraft(item.title); setRenamingId(item.id); }} className="no-drag rounded-md p-1 text-[var(--color-ink-dim)] opacity-0 hover:bg-white/10 hover:text-[var(--color-ink)] group-hover:opacity-100 focus:opacity-100"><Pencil size={11} aria-hidden="true" /></button>
                        <button type="button" aria-label={`Delete ${item.title}`} onClick={() => setDeleteId(item.id)} className="no-drag rounded-md p-1 text-[var(--color-ink-dim)] opacity-0 hover:bg-rose-500/15 hover:text-rose-200 group-hover:opacity-100 focus:opacity-100"><Trash2 size={11} aria-hidden="true" /></button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {hasMore ? <button type="button" disabled={loading} onClick={() => void load(offset, true)} className="no-drag m-1 w-[calc(100%-8px)] rounded-lg px-2 py-1.5 text-[10.5px] text-sky-200 hover:bg-white/6 disabled:opacity-50">{loading ? 'Loading…' : 'Load older chats'}</button> : null}
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--color-glass-border)] px-3 py-1.5">
        <span className="text-[9.5px] text-[var(--color-ink-dim)]">{items.length} {items.length === 1 ? 'conversation' : 'conversations'}</span>
        <button type="button" disabled={disabled || items.length === 0} onClick={() => setClearConfirm(true)} className="no-drag rounded-md px-2 py-1 text-[10px] text-[var(--color-ink-dim)] hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40">Clear History</button>
      </footer>

      {deleteId ? (
        <ConfirmDialog title="Delete this conversation?" detail="This removes its saved transcript and cannot be undone." confirmLabel="Delete" onConfirm={() => void remove()} onCancel={() => setDeleteId(null)} />
      ) : null}
      {clearConfirm ? (
        <ConfirmDialog title="Clear all chat history?" detail="Saved conversations and session-only chats will be removed." confirmLabel="Clear History" onConfirm={() => void clear()} onCancel={() => setClearConfirm(false)} />
      ) : null}
    </section>
  );
}

function ConfirmDialog({ title, detail, confirmLabel, onConfirm, onCancel }: {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-modal="true" aria-label={title} className="absolute inset-x-5 top-1/2 z-10 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#111722] p-3 shadow-2xl">
      <p className="text-[12px] font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-dim)]">{detail}</p>
      <div className="mt-3 flex justify-end gap-1.5">
        <button type="button" autoFocus onClick={onCancel} className="no-drag rounded-lg border border-white/10 px-2.5 py-1 text-[10.5px] text-[var(--color-ink-soft)] hover:bg-white/8">Cancel</button>
        <button type="button" onClick={onConfirm} className="no-drag rounded-lg border border-rose-300/25 bg-rose-500/15 px-2.5 py-1 text-[10.5px] font-medium text-rose-100 hover:bg-rose-500/25">{confirmLabel}</button>
      </div>
    </div>
  );
}

function mergeSummaries(current: ConversationSummary[], next: ConversationSummary[]): ConversationSummary[] {
  const values = new Map(current.map((item) => [item.id, item]));
  for (const item of next) values.set(item.id, item);
  return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function groupConversations(items: ConversationSummary[]): Array<[string, ConversationSummary[]]> {
  const today = startOfDay(Date.now());
  const groups = new Map<string, ConversationSummary[]>();
  for (const item of items) {
    const days = Math.floor((today - startOfDay(item.updatedAt)) / 86_400_000);
    const group = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Previous days' : 'Older';
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return ['Today', 'Yesterday', 'Previous days', 'Older']
    .flatMap((group) => groups.has(group) ? [[group, groups.get(group) as ConversationSummary[]] as [string, ConversationSummary[]]] : []);
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function relativeDate(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(delta / 86_400_000);
  if (days === 0) return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
