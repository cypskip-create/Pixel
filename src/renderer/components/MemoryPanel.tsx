import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, History, Save, Search, Trash2 } from 'lucide-react';
import type { MemoryRecordView, MemoryRevisionView } from '@shared/types';
import { readBridge } from '@/lib/bridge';

interface MemoryPanelProps { onBack: () => void; returnLabel?: string }

export function MemoryPanel({ onBack, returnLabel = 'Back to settings' }: MemoryPanelProps): React.JSX.Element {
  const bridge = useMemo(() => readBridge(), []);
  const [memories, setMemories] = useState<MemoryRecordView[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeProject, setActiveProject] = useState('');
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Record<string, MemoryRevisionView[]>>({});

  const refresh = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    const [items, projects] = await Promise.all([bridge.bridge.memory.list(), bridge.bridge.memory.listProjects()]);
    setMemories(items);
    setActiveProject(projects.find((project) => project.active)?.name ?? 'Current project');
  }, [bridge]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(messageOf(cause)));
  }, [refresh]);

  const exportMemory = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    try {
      const bundle = await bridge.bridge.memory.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pixel-memory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge]);

  const saveEdit = useCallback(async (id: string) => {
    if (bridge.kind !== 'ready') return;
    try {
      const updated = await bridge.bridge.memory.update(id, { content: editText });
      setMemories((current) => current.map((memory) => memory.id === id ? updated : memory));
      setEditingId(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge, editText]);

  const deleteMemory = useCallback(async (id: string) => {
    if (bridge.kind !== 'ready') return;
    try {
      const removed = await bridge.bridge.memory.delete(id);
      if (!removed) throw new Error('The memory could not be deleted.');
      setMemories((current) => current.filter((memory) => memory.id !== id));
      setConfirmDeleteId(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge]);

  const toggleHistory = useCallback(async (id: string) => {
    if (historyFor === id) { setHistoryFor(null); return; }
    if (bridge.kind !== 'ready') return;
    try {
      const history = await bridge.bridge.memory.history(id);
      setRevisions((current) => ({ ...current, [id]: history }));
      setHistoryFor(id);
    } catch (cause) { setError(messageOf(cause)); }
  }, [bridge, historyFor]);

  const visibleMemories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? memories.filter((memory) => `${memory.kind} ${memory.content} ${memory.source} ${memory.tags.join(' ')}`.toLocaleLowerCase().includes(query)) : memories;
  }, [memories, search]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
      <button type="button" onClick={onBack} className="no-drag mb-2 flex w-fit items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-ink-soft)] hover:bg-white/8">
        <ArrowLeft size={12} aria-hidden="true" /> {returnLabel}
      </button>
      <div className="mb-2 flex items-start gap-2">
        <p className="flex-1 text-[10.5px] leading-snug text-[var(--color-ink-dim)]">Project: <span className="text-[var(--color-ink-soft)]">{activeProject}</span>. Automatic saves are local; credentials and copied webpage instructions are excluded.</p>
        <button type="button" onClick={() => void exportMemory()} className="no-drag flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[9.5px] text-[var(--color-ink-soft)] hover:bg-white/8"><Download size={10} /> Export</button>
      </div>
      {error ? <p role="alert" className="mb-2 rounded-lg border border-neutral-400/35 bg-neutral-500/12 px-2 py-1.5 text-[10.5px] text-neutral-100">{error}</p> : null}
      <label className="no-drag mb-2 flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-black/10 px-2.5 py-1.5 text-[10px] text-[var(--color-ink-dim)]">
        <Search size={12} aria-hidden="true" /><input aria-label="Search project memories" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project memories" className="min-w-0 flex-1 bg-transparent text-[10.5px] text-[var(--color-ink-soft)] outline-none placeholder:text-[var(--color-ink-dim)]" />
      </label>
      {memories.length === 0 ? <p className="rounded-xl border border-white/8 bg-white/4 px-2.5 py-3 text-[10.5px] text-[var(--color-ink-dim)]">This project has no saved memories.</p> : visibleMemories.map((memory) => (
        <article key={memory.id} className="mb-1.5 rounded-xl border border-[var(--color-border)] bg-white/4 p-2">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[9px] font-semibold uppercase tracking-wide text-neutral-200/90">{memory.kind} · {memory.confidence} · {originLabel(memory)}</span>
            <span className="shrink-0 text-[9px] text-[var(--color-ink-dim)]" title={`Created ${new Date(memory.createdAt).toLocaleString()}`}>Updated {new Date(memory.updatedAt).toLocaleDateString()}</span>
          </div>
          {editingId === memory.id ? (
            <>
              <textarea aria-label="Edit memory content" value={editText} onChange={(event) => setEditText(event.target.value)} maxLength={4_000} className="no-drag selectable mt-1 min-h-14 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-1.5 text-[10px] text-[var(--color-ink-soft)] outline-none focus:border-neutral-300/50" />
              <div className="mt-1 flex gap-1.5">
                <button type="button" onClick={() => void saveEdit(memory.id)} className="flex items-center gap-1 rounded-md bg-neutral-500/20 px-2 py-1 text-[9.5px] text-neutral-100"><Save size={10} /> Save correction</button>
                <button type="button" onClick={() => setEditingId(null)} className="rounded-md px-2 py-1 text-[9.5px] text-[var(--color-ink-dim)]">Cancel</button>
              </div>
            </>
          ) : <p className="selectable mt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-soft)]">{memory.content}</p>}
          <p className="mt-1 truncate text-[9px] text-[var(--color-ink-dim)]" title={memory.source}>Source: {memory.source} · Created {new Date(memory.createdAt).toLocaleDateString()}</p>
          <div className="mt-1 flex items-center gap-2">
            {editingId !== memory.id ? <button type="button" onClick={() => { setError(null); setEditingId(memory.id); setEditText(memory.content); }} className="text-[9px] text-neutral-200/80 hover:text-neutral-100">Correct</button> : null}
            {editingId !== memory.id ? <button type="button" onClick={() => void toggleHistory(memory.id)} className="flex items-center gap-1 text-[9px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink-soft)]"><History size={10} /> {historyFor === memory.id ? 'Hide changes' : 'History'}</button> : null}
            {confirmDeleteId === memory.id ? (
              <>
                <span className="text-[9px] text-neutral-200">Delete permanently?</span>
                <button type="button" onClick={() => void deleteMemory(memory.id)} className="text-[9px] font-semibold text-neutral-100">Confirm</button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-[9px] text-[var(--color-ink-dim)]">Keep</button>
              </>
            ) : <button type="button" onClick={() => { setError(null); setConfirmDeleteId(memory.id); }} aria-label={`Delete memory ${memory.id}`} className="flex items-center gap-1 text-[9px] text-neutral-200/80 hover:text-neutral-100"><Trash2 size={10} /> Delete</button>}
          </div>
          {historyFor === memory.id ? <div className="mt-2 border-t border-white/8 pt-1.5">{(revisions[memory.id] ?? []).length === 0 ? <p className="text-[9px] text-[var(--color-ink-dim)]">No changes recorded.</p> : revisions[memory.id]?.map((revision, index) => <div key={`${revision.updatedAt}-${index}`} className="mb-1"><p className="text-[9px] text-[var(--color-ink-dim)]">{revision.reason} · {new Date(revision.updatedAt).toLocaleString()} · {revision.confidence}</p><p className="selectable text-[10px] text-[var(--color-ink-soft)]">{revision.content}</p><p className="text-[9px] text-[var(--color-ink-dim)]">Source: {revision.source}</p></div>)}</div> : null}
        </article>
      ))}
      {memories.length === 50 ? <p className="pt-1 text-[9px] text-[var(--color-ink-dim)]">Showing the 50 most recent entries. Export includes all entries in this project.</p> : null}
    </div>
  );
}

function originLabel(memory: MemoryRecordView): string {
  if (memory.tags.includes('verified-task')) return 'Verified task outcome';
  if (memory.tags.includes('user-requested')) return 'User requested';
  if (memory.source.startsWith('auto:')) return 'Automatically saved';
  return 'User or source';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
