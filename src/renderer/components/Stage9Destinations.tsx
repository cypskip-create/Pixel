/**
 * Stage 9 Full-Page Hermes-Style Desktop Destinations for Pixel.
 *
 * Strictly monochrome surface tokens + Pixel blue accent (`--color-surface`,
 * `--color-border`, `--color-ink`, `--color-ink-dim`, `--color-accent`,
 * `--color-danger`), zero raw chromatic Tailwind classes, zero orange.
 * Backed by Pixel's authoritative Python-first IPC services and canonical stores.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  ConversationSummary,
  DiagnosticsSnapshot,
  MissedRunPolicy,
  RoutineRecord,
  RoutineRunRecord,
  RoutineScheduleKind,
  SkillRecord,
  TaskRecord,
} from '@shared/types';

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 1. Command Center (Sessions, System, Usage, Maintenance)
 * ------------------------------------------------------------------ */

export function CommandCenterPage({
  onOpenConversation,
}: {
  onOpenConversation?: (id: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<'sessions' | 'system' | 'usage' | 'maintenance'>('sessions');
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState('');
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);
  const [gwStatus, setGwStatus] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [maintNotice, setMaintNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    const cyps = typeof window !== 'undefined' ? window.cyps : undefined;
    if (!cyps) return;
    const [h, d, t, g] = await Promise.all([
      cyps.history.list().catch(() => []),
      cyps.system.diagnostics().catch(() => null),
      cyps.tasks.list().catch(() => []),
      cyps.gateway?.status().catch(() => null) ?? Promise.resolve(null),
    ]);
    setSessions(h);
    setDiag(d);
    setTasks(t);
    setGwStatus(g);
  };

  useEffect(() => {
    void reload();
  }, []);

  const filteredSessions = sessions.filter(
    (s) => !search.trim() || s.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const totalMemGb = diag ? (diag.totalMemoryBytes / (1024 ** 3)).toFixed(1) : '—';
  const freeMemGb = diag ? (diag.freeMemoryBytes / (1024 ** 3)).toFixed(1) : '—';

  return (
    <section className="workspace-page" aria-label="Command Center">
      <div className="workspace-page-heading">
        <h1>Command Center</h1>
        <p>Live sessions, Python runtime health, measured task usage, and safe maintenance diagnostics.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Command Center sections">
        {(['sessions', 'system', 'usage', 'maintenance'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md border px-3 py-1 text-[12px] capitalize ${
              tab === t
                ? 'border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-ink)]'
                : 'border-[var(--color-border)] text-[var(--color-ink-dim)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'sessions' ? (
        <div className="space-y-2">
          <input
            type="search"
            aria-label="Search sessions"
            placeholder="Filter conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]"
          />
          {filteredSessions.length === 0 ? (
            <div className="workspace-empty-card">No conversations match your filter.</div>
          ) : (
            filteredSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
                <div>
                  <strong className="text-[var(--color-ink)]">{s.title}</strong>
                  <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">{new Date(s.updatedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-2 text-[11px]">
                  {onOpenConversation ? (
                    <button type="button" onClick={() => onOpenConversation(s.id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Open</button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void window.cyps?.history.delete(s.id).then(reload)}
                    className="text-[var(--color-danger)]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'system' ? (
        <div className="space-y-2 text-[12px]">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <strong className="text-[var(--color-ink)]">Runtime &amp; Platform Health</strong>
            <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">
              Platform: {diag?.platform ?? 'win32'} {diag?.release ?? ''} ({diag?.arch ?? 'x64'}) · CPUs: {diag?.cpuCount ?? '—'} · Memory: {freeMemGb} / {totalMemGb} GB free
            </p>
            <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">
              Gateway: {gwStatus?.running ? 'Running' : 'Stopped'} · Active Remote Sessions: {Number(gwStatus?.activeSessions ?? 0)} · Deliveries: {Number(gwStatus?.deliveries ?? 0)}
            </p>
          </div>
        </div>
      ) : null}

      {tab === 'usage' ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px] space-y-1">
          <strong className="text-[var(--color-ink)]">Measured Workspace Activity</strong>
          <p className="text-[11.5px] text-[var(--color-ink-dim)]">
            Conversations recorded: {sessions.length} · Agent tasks tracked: {tasks.length} · Active: {tasks.filter((t) => t.status === 'running').length} · Completed: {tasks.filter((t) => t.status === 'completed').length} · Failed: {tasks.filter((t) => t.status === 'failed').length}
          </p>
          <p className="text-[11px] text-[var(--color-ink-dim)]">
            Note: Only real local workspace counters are shown; unmeasured token/cost estimates are intentionally omitted.
          </p>
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
          <strong className="text-[var(--color-ink)]">Safe Maintenance</strong>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">Refresh live diagnostics and clear expired permission grants.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void reload().then(() => setMaintNotice('Diagnostics refreshed.'))} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Refresh Diagnostics</button>
            <button type="button" onClick={() => void window.cyps?.permissions.clearExpired().then((n) => setMaintNotice(`Cleared ${n} expired permission grant(s).`))} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Clear Expired Grants</button>
          </div>
          {maintNotice ? <p className="mt-2 text-[11px] text-[var(--color-ink-dim)]" role="status">{maintNotice}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Profiles (Isolated Profiles, Edit, Overrides & Confirmed Delete)
 * ------------------------------------------------------------------ */

export function ProfilesPage(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cyps?.profiles : undefined;
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [providerOverride, setProviderOverride] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', description: '', instructions: '', providerOverride: '', modelOverride: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    if (!api) return;
    const res = await api.list().catch(() => ({ ok: false, activeProfileId: 'default', profiles: [] }));
    setProfiles(res.profiles ?? []);
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleCreate = async (): Promise<void> => {
    if (!api || !name.trim()) return;
    const res = await api.create({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      providerOverride: providerOverride.trim(),
      modelOverride: modelOverride.trim(),
    });
    setNotice(res.ok ? `Created profile "${name.trim()}".` : String(res.error ?? 'Could not create profile.'));
    if (res.ok) {
      setName('');
      setDescription('');
      setInstructions('');
      setProviderOverride('');
      setModelOverride('');
      await reload();
    }
  };

  const startEdit = (p: Record<string, unknown>): void => {
    setEditingId(String(p.id ?? ''));
    setEditDraft({
      name: String(p.name ?? ''),
      description: String(p.description ?? ''),
      instructions: String(p.instructions ?? ''),
      providerOverride: String(p.providerOverride ?? ''),
      modelOverride: String(p.modelOverride ?? ''),
    });
  };

  const saveEdit = async (): Promise<void> => {
    if (!api || !editingId) return;
    const res = await api.update(editingId, editDraft);
    setNotice(res.ok ? `Updated profile "${editDraft.name || editingId}".` : String(res.error ?? 'Could not update profile.'));
    if (res.ok) {
      setEditingId(null);
      await reload();
    }
  };

  const confirmDelete = async (id: string): Promise<void> => {
    if (!api) return;
    const res = await api.delete(id);
    setConfirmDeleteId(null);
    setNotice(res.ok ? 'Profile deleted safely.' : String(res.error ?? 'Could not delete profile.'));
    await reload();
  };

  return (
    <section className="workspace-page" aria-label="Profiles">
      <div className="workspace-page-heading">
        <h1>Profiles</h1>
        <p>Isolated desktop profiles with separate history, memory, skills, artifacts, instructions, and model overrides.</p>
      </div>
      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
        <div className="text-[12px] font-medium text-[var(--color-ink)]">Create Profile</div>
        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="text"
            aria-label="New profile name"
            placeholder="Work / Research / Personal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
          />
          <input
            type="text"
            aria-label="New profile description"
            placeholder="Short description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
          />
        </div>
        <textarea
          aria-label="Profile instructions"
          placeholder="Profile system instructions / persona applied to local and remote turns…"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
        />
        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="text"
            aria-label="Provider override"
            placeholder="Provider override (optional, e.g. openai)"
            value={providerOverride}
            onChange={(e) => setProviderOverride(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1 text-[11.5px] text-[var(--color-ink)]"
          />
          <input
            type="text"
            aria-label="Model override"
            placeholder="Model override (optional, e.g. gpt-4o)"
            value={modelOverride}
            onChange={(e) => setModelOverride(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1 text-[11.5px] text-[var(--color-ink)]"
          />
        </div>
        <button type="button" disabled={!name.trim()} onClick={() => void handleCreate()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">
          Create Profile
        </button>
      </div>

      <div className="space-y-2">
        {profiles.map((p) => {
          const id = String(p.id ?? '');
          const isActive = Boolean(p.active);
          const isDefault = Boolean(p.isDefault);
          const isEditing = editingId === id;
          return (
            <div key={id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
              {isEditing ? (
                <div className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      aria-label="Edit profile name"
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[12px] text-[var(--color-ink)]"
                    />
                    <input
                      type="text"
                      aria-label="Edit profile description"
                      value={editDraft.description}
                      onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                      className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[12px] text-[var(--color-ink)]"
                    />
                  </div>
                  <textarea
                    aria-label="Edit profile instructions"
                    rows={2}
                    value={editDraft.instructions}
                    onChange={(e) => setEditDraft((d) => ({ ...d, instructions: e.target.value }))}
                    className="w-full rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[12px] text-[var(--color-ink)]"
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type="text"
                      aria-label="Edit provider override"
                      placeholder="Provider override"
                      value={editDraft.providerOverride}
                      onChange={(e) => setEditDraft((d) => ({ ...d, providerOverride: e.target.value }))}
                      className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
                    />
                    <input
                      type="text"
                      aria-label="Edit model override"
                      placeholder="Model override"
                      value={editDraft.modelOverride}
                      onChange={(e) => setEditDraft((d) => ({ ...d, modelOverride: e.target.value }))}
                      className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
                    />
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    <button type="button" onClick={() => void saveEdit()} className="rounded border border-[var(--color-accent)] px-2.5 py-0.5 text-[var(--color-ink)]">Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded border border-[var(--color-border)] px-2.5 py-0.5 text-[var(--color-ink-dim)]">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-[var(--color-ink)]">{String(p.name ?? id)}</strong>
                    <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">
                      {isActive ? 'Active' : 'Inactive'}{isDefault ? ' · Default (Protected)' : ''}
                      {p.modelOverride ? ` · model=${String(p.modelOverride)}` : ''}
                    </span>
                    {p.description ? <p className="mt-0.5 text-[11px] text-[var(--color-ink-dim)]">{String(p.description)}</p> : null}
                    {p.instructions ? <p className="mt-0.5 text-[11px] text-[var(--color-ink-dim)]">Instructions: {String(p.instructions).slice(0, 140)}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {!isActive ? (
                      <button type="button" onClick={() => void api?.switch(id).then(() => { setNotice(`Switched to profile "${String(p.name ?? id)}".`); return reload(); })} className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-ink)]">Switch</button>
                    ) : null}
                    <button type="button" onClick={() => startEdit(p)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Edit</button>
                    {!isDefault ? (
                      confirmDeleteId === id ? (
                        <>
                          <button type="button" onClick={() => void confirmDelete(id)} className="rounded border border-[var(--color-danger)] px-2 py-0.5 text-[var(--color-danger)]">Confirm Delete</button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-[var(--color-ink-dim)]">Cancel</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(id)} className="text-[var(--color-danger)]">Delete</button>
                      )
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Agents (Real Parent/Child Delegation Tree + Live Status)
 * ------------------------------------------------------------------ */

export function AgentsPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);

  const reload = async (): Promise<void> => {
    const [list, d] = await Promise.all([
      window.cyps?.tasks.list().catch(() => []) ?? Promise.resolve([]),
      window.cyps?.system.diagnostics().catch(() => null) ?? Promise.resolve(null),
    ]);
    setTasks(list);
    setDiag(d);
  };

  useEffect(() => {
    void reload();
    return window.cyps?.tasks.onUpdate(() => void reload());
  }, []);

  const { roots, childrenByParent } = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const childMap = new Map<string, TaskRecord[]>();
    const rootList: TaskRecord[] = [];
    for (const t of tasks) {
      if (t.parentTaskId && ids.has(t.parentTaskId)) {
        const arr = childMap.get(t.parentTaskId) ?? [];
        arr.push(t);
        childMap.set(t.parentTaskId, arr);
      } else {
        rootList.push(t);
      }
    }
    return { roots: rootList, childrenByParent: childMap };
  }, [tasks]);

  const renderTaskNode = (t: TaskRecord, depth: number): React.JSX.Element => {
    const children = childrenByParent.get(t.id) ?? [];
    return (
      <div
        key={t.id}
        data-task-node={t.id}
        data-parent-task={t.parentTaskId ?? ''}
        style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 18}px` } : undefined}
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <strong className="text-[var(--color-ink)]">{t.title}</strong>
            {t.specialistId ? (
              <span className="ml-2 rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-ink)]">
                specialist:{t.specialistId}
              </span>
            ) : null}
            <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">
              {t.status} · {t.steps.length} step(s){children.length > 0 ? ` · ${children.length} delegated child(ren)` : ''}
            </span>
          </div>
          <div className="flex gap-1.5 text-[11px]">
            {t.status === 'running' ? (
              <button type="button" onClick={() => void window.cyps?.tasks.pause(t.id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Pause</button>
            ) : null}
            {t.status === 'paused' ? (
              <button type="button" onClick={() => void window.cyps?.tasks.resume(t.id)} className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-ink)]">Resume</button>
            ) : null}
            {t.status === 'running' || t.status === 'paused' ? (
              <button type="button" onClick={() => void window.cyps?.tasks.cancel(t.id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-danger)]">Cancel</button>
            ) : null}
          </div>
        </div>
        {t.steps.length > 0 ? (
          <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-ink-dim)]">
            {t.steps.slice(-5).map((s) => (
              <li key={s.id}>[{s.status}] {s.title}{s.detail ? ` — ${s.detail.slice(0, 90)}` : ''}</li>
            ))}
          </ul>
        ) : null}
        {children.length > 0 ? (
          <div className="mt-2 space-y-2 border-l border-[var(--color-border)] pl-2" aria-label={`Delegated subtasks of ${t.title}`}>
            {children.map((child) => renderTaskNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="workspace-page" aria-label="Agents">
      <div className="workspace-page-heading">
        <h1>Agents &amp; Delegation</h1>
        <p>Live root agent runs, nested delegated specialist tasks, step progress, and runtime controls.</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11.5px] text-[var(--color-ink-dim)]">
        <span>
          Runtime: Python v2 ({diag?.platform ?? 'win32'}) · Running: {tasks.filter((t) => t.status === 'running').length} · Completed: {tasks.filter((t) => t.status === 'completed').length} · Failed: {tasks.filter((t) => t.status === 'failed').length}
        </span>
        <button type="button" onClick={() => void reload()} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]">Refresh</button>
      </div>
      {roots.length === 0 ? (
        <div className="workspace-empty-card">No agent runs or delegated tasks recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {roots.map((root) => renderTaskNode(root, 0))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Artifacts Library (Preview, Safe Open, Reveal & Profile Scoped)
 * ------------------------------------------------------------------ */

export function ArtifactsPage({ projectId }: { projectId?: string }): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cyps?.artifacts : undefined;
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    if (!api) return;
    const next = await api.list({ projectId, kind, query }).catch(() => []);
    setItems(next);
    if (selected && !next.some((item) => item.id === selected.id)) {
      setSelected(null);
    }
  };

  useEffect(() => {
    void reload();
  }, [projectId, kind, query]);

  const handleOpen = async (id: string): Promise<void> => {
    if (!api?.open) return;
    const res = await api.open(id);
    if (!res.ok) setNotice(res.error ?? 'Could not open artifact.');
  };

  const handleReveal = async (id: string): Promise<void> => {
    if (!api?.reveal) return;
    const res = await api.reveal(id);
    if (!res.ok) setNotice(res.error ?? 'Could not reveal artifact folder.');
  };

  return (
    <section className="workspace-page" aria-label="Artifacts">
      <div className="workspace-page-heading">
        <h1>Artifacts</h1>
        <p>Generated images, documents, reports, and code outputs scoped to your active profile and project.</p>
      </div>
      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}
      <div className="mb-3 flex gap-2">
        <input
          type="search"
          aria-label="Search artifacts"
          placeholder="Search artifacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]"
        />
        <select
          aria-label="Filter artifact kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
        >
          <option value="all">All types</option>
          <option value="image">Images</option>
          <option value="document">Documents</option>
          <option value="code">Code</option>
          <option value="report">Reports</option>
          <option value="file">Files</option>
        </select>
      </div>
      {items.length === 0 ? (
        <div className="workspace-empty-card">No artifacts registered for this profile yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => {
            const id = String(a.id ?? '');
            const isSelected = selected?.id === id;
            return (
              <div key={id} className={`rounded-lg border px-3 py-2 text-[12px] bg-[var(--color-surface)] ${isSelected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setSelected(isSelected ? null : a)} className="text-left min-w-0 flex-1">
                    <strong className="text-[var(--color-ink)]">{String(a.name ?? id)}</strong>
                    <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">
                      {String(a.kind ?? 'file')} · {String(a.mimeType ?? '')}{Number(a.sizeBytes) > 0 ? ` · ${Number(a.sizeBytes)} B` : ''}
                    </span>
                  </button>
                  <div className="flex gap-2 text-[11px]">
                    {a.filePath ? (
                      <>
                        <button type="button" onClick={() => void handleOpen(id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Open</button>
                        <button type="button" onClick={() => void handleReveal(id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Reveal</button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => void api?.delete(id).then(reload)} className="text-[var(--color-danger)]">Remove</button>
                  </div>
                </div>
                {isSelected ? (
                  <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-ink-dim)] space-y-1">
                    {a.filePath ? <div>Path: <code>{String(a.filePath)}</code> ({a.fileExists === false ? 'missing on disk' : 'verified'})</div> : null}
                    <div>Profile: {String(a.profileId ?? 'default')} · Project: {String(a.projectId ?? 'default')}</div>
                    {a.previewText ? <pre className="mt-1 whitespace-pre-wrap rounded bg-black/20 p-2 text-[11px] text-[var(--color-ink)]">{String(a.previewText)}</pre> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Cron (Full Dedicated Scheduler Surface on Canonical SQLite Store)
 * ------------------------------------------------------------------ */

export function CronPage(): React.JSX.Element {
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [name, setName] = useState('');
  const [skillId, setSkillId] = useState('');
  const [scheduleKind, setScheduleKind] = useState<RoutineScheduleKind>('daily');
  const [localTime, setLocalTime] = useState('09:00');
  const [cronExpression, setCronExpression] = useState('0 9 * * 1-5');
  const [intervalMinutes, setIntervalMinutes] = useState('60');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [missedRunPolicy, setMissedRunPolicy] = useState<MissedRunPolicy>('skip');
  const [historyById, setHistoryById] = useState<Record<string, RoutineRunRecord[]>>({});
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editScheduleKind, setEditScheduleKind] = useState<RoutineScheduleKind>('daily');
  const [editLocalTime, setEditLocalTime] = useState('09:00');
  const [editCronExpression, setEditCronExpression] = useState('0 9 * * 1-5');
  const [editIntervalMinutes, setEditIntervalMinutes] = useState('60');
  const [editTimezone, setEditTimezone] = useState('UTC');
  const [editMissedRunPolicy, setEditMissedRunPolicy] = useState<MissedRunPolicy>('skip');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    const [rList, sList] = await Promise.all([
      window.cyps?.routines.list().catch(() => []) ?? Promise.resolve([]),
      window.cyps?.skills.list().catch(() => []) ?? Promise.resolve([]),
    ]);
    setRoutines(rList);
    const activeSkills = sList.filter((s) => s.status === 'active');
    setSkills(activeSkills);
    setSkillId((cur) => cur || activeSkills[0]?.id || '');
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleCreate = async (): Promise<void> => {
    const api = window.cyps?.routines;
    if (!api || !name.trim() || !skillId) return;
    try {
      await api.create({
        skillId,
        name: name.trim(),
        localTime,
        timezone,
        scheduleKind,
        ...(scheduleKind === 'cron' || scheduleKind === 'weekly' ? { cronExpression } : {}),
        ...(scheduleKind === 'interval' ? { intervalMs: Math.max(1, Number(intervalMinutes) || 60) * 60_000 } : {}),
        missedRunPolicy,
        inputValues: {},
      });
      setName('');
      setNotice('Scheduled routine created.');
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not create routine.');
    }
  };

  const toggleHistory = async (routineId: string): Promise<void> => {
    if (expandedHistoryId === routineId) {
      setExpandedHistoryId(null);
      return;
    }
    const runs = await window.cyps?.routines.history(routineId, 20).catch(() => []) ?? [];
    setHistoryById((prev) => ({ ...prev, [routineId]: runs }));
    setExpandedHistoryId(routineId);
  };

  const saveEdit = async (routineId: string): Promise<void> => {
    try {
      const updated = await window.cyps?.routines.update?.(routineId, {
        name: editName.trim(),
        scheduleKind: editScheduleKind,
        localTime: editLocalTime,
        ...(editScheduleKind === 'cron' || editScheduleKind === 'weekly' ? { cronExpression: editCronExpression.trim() } : {}),
        ...(editScheduleKind === 'interval' ? { intervalMs: Math.max(1, Number(editIntervalMinutes) || 60) * 60_000 } : {}),
        timezone: editTimezone.trim(),
        missedRunPolicy: editMissedRunPolicy,
      });
      setEditingId(null);
      setNotice(updated ? 'Routine updated.' : 'Could not update routine.');
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update routine.');
    }
  };

  return (
    <section className="workspace-page" aria-label="Cron Scheduler">
      <div className="workspace-page-heading">
        <h1>Cron &amp; Scheduled Jobs</h1>
        <p>Backed by Pixel&apos;s SQLite routine scheduler with lease locking, timezone awareness, run-now, history, retry, and cancellation.</p>
      </div>
      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2 text-[12px]">
        <div className="font-medium text-[var(--color-ink)]">Create Scheduled Routine</div>
        <div className="grid gap-2 md:grid-cols-2">
          <input
            type="text"
            aria-label="Routine name"
            placeholder="Morning briefing / Repo check"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1 text-[12px] text-[var(--color-ink)]"
          />
          <select
            aria-label="Routine skill"
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1 text-[12px] text-[var(--color-ink)]"
          >
            {skills.length === 0 ? <option value="">No active skills available</option> : null}
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <select
            aria-label="Schedule kind"
            value={scheduleKind}
            onChange={(e) => setScheduleKind(e.target.value as RoutineScheduleKind)}
            className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]"
          >
            <option value="daily">Daily</option>
            <option value="cron">Cron Expression</option>
            <option value="interval">Interval (min)</option>
          </select>
          {scheduleKind === 'cron' ? (
            <input type="text" aria-label="Cron expression" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
          ) : scheduleKind === 'interval' ? (
            <input type="number" min={1} aria-label="Interval minutes" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
          ) : (
            <input type="time" aria-label="Local time" value={localTime} onChange={(e) => setLocalTime(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
          )}
          <input type="text" aria-label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
          <select aria-label="Missed run policy" value={missedRunPolicy} onChange={(e) => setMissedRunPolicy(e.target.value as MissedRunPolicy)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]">
            <option value="skip">Skip missed</option>
            <option value="notify_only">Notify only</option>
            <option value="run_once">Catch up once</option>
            <option value="catch_up_window">Bounded catch-up</option>
          </select>
        </div>
        <button type="button" disabled={!name.trim() || !skillId} onClick={() => void handleCreate()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">
          Create Routine
        </button>
      </div>

      {routines.length === 0 ? (
        <div className="workspace-empty-card">No scheduled routines configured yet. Create a routine above using any active skill.</div>
      ) : (
        <div className="space-y-2">
          {routines.map((r) => {
            const runs = historyById[r.id] ?? [];
            const isEditing = editingId === r.id;
            return (
              <div key={r.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 md:grid-cols-3">
                      <input type="text" aria-label="Edit routine name" value={editName} onChange={(e) => setEditName(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[12px] text-[var(--color-ink)]" />
                      <select aria-label="Edit schedule kind" value={editScheduleKind} onChange={(e) => setEditScheduleKind(e.target.value as RoutineScheduleKind)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]">
                        <option value="daily">Daily</option>
                        <option value="cron">Cron Expression</option>
                        <option value="interval">Interval (min)</option>
                      </select>
                      {editScheduleKind === 'cron' || editScheduleKind === 'weekly' ? (
                        <input type="text" aria-label="Edit cron expression" value={editCronExpression} onChange={(e) => setEditCronExpression(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]" />
                      ) : editScheduleKind === 'interval' ? (
                        <input type="number" min={1} aria-label="Edit interval minutes" value={editIntervalMinutes} onChange={(e) => setEditIntervalMinutes(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]" />
                      ) : (
                        <input type="time" aria-label="Edit routine time" value={editLocalTime} onChange={(e) => setEditLocalTime(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]" />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="text" aria-label="Edit routine timezone" value={editTimezone} onChange={(e) => setEditTimezone(e.target.value)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]" />
                      <select aria-label="Edit missed run policy" value={editMissedRunPolicy} onChange={(e) => setEditMissedRunPolicy(e.target.value as MissedRunPolicy)} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-0.5 text-[11.5px] text-[var(--color-ink)]">
                        <option value="skip">Skip missed</option>
                        <option value="notify_only">Notify only</option>
                        <option value="run_once">Catch up once</option>
                        <option value="catch_up_window">Bounded catch-up</option>
                      </select>
                      <button type="button" onClick={() => void saveEdit(r.id)} className="rounded border border-[var(--color-accent)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink)]">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-[11px] text-[var(--color-ink-dim)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="text-[var(--color-ink)]">{r.name}</strong>
                      <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">
                        {r.scheduleKind === 'interval' && r.intervalMs
                          ? `every ${Math.round(r.intervalMs / 60_000)}m`
                          : (r.cronExpression ? r.cronExpression : r.localTime)} ({r.timezone}) · {r.enabled ? 'Enabled' : 'Paused'}
                        {r.lastStatus ? ` · last=${r.lastStatus}` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <button type="button" onClick={() => void window.cyps?.routines.runNow?.(r.id).then((ok) => { setNotice(ok ? `Triggered "${r.name}".` : 'Could not run routine right now.'); return reload(); })} className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[var(--color-ink)]">Run Now</button>
                      <button type="button" onClick={() => void window.cyps?.routines.setEnabled(r.id, !r.enabled).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">{r.enabled ? 'Pause' : 'Resume'}</button>
                      <button type="button" onClick={() => {
                        setEditingId(r.id);
                        setEditName(r.name);
                        setEditScheduleKind(r.scheduleKind ?? 'daily');
                        setEditLocalTime(r.localTime);
                        setEditCronExpression(r.cronExpression ?? '0 9 * * 1-5');
                        setEditIntervalMinutes(r.intervalMs ? String(Math.max(1, Math.round(r.intervalMs / 60_000))) : '60');
                        setEditTimezone(r.timezone);
                        setEditMissedRunPolicy(r.missedRunPolicy ?? 'skip');
                      }} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Edit</button>
                      <button type="button" onClick={() => void toggleHistory(r.id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">History</button>
                      <button type="button" onClick={() => void window.cyps?.routines.cancel(r.id).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink-dim)]">Cancel Run</button>
                      <button type="button" onClick={() => void window.cyps?.routines.retry(r.id).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink-dim)]">Retry</button>
                      <button type="button" onClick={() => void window.cyps?.routines.delete(r.id).then(reload)} className="text-[var(--color-danger)]">Delete</button>
                    </div>
                  </div>
                )}
                {expandedHistoryId === r.id ? (
                  <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-ink-dim)] space-y-1">
                    {runs.length === 0 ? <div>No execution runs recorded yet.</div> : runs.map((run) => (
                      <div key={run.id}>
                        [{run.status}] {new Date(run.startedAt).toLocaleString()} {run.summary ? `— ${run.summary}` : ''} {run.failure ? `· Error: ${run.failure}` : ''}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 6. Starmap (Interactive Graph with Visible Edges, Zoom/Pan & Timeline)
 * ------------------------------------------------------------------ */

export function StarmapPage(): React.JSX.Element {
  const [graph, setGraph] = useState<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
  }>({ nodes: [], edges: [], timeline: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'timeline'>('graph');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const reload = async (): Promise<void> => {
    const res = await window.cyps?.starmap?.build().catch(() => null);
    if (res && Array.isArray(res.nodes)) {
      setGraph({
        nodes: res.nodes as Array<Record<string, unknown>>,
        edges: (res.edges as Array<Record<string, unknown>>) ?? [],
        timeline: (res.timeline as Array<Record<string, unknown>>) ?? [],
      });
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Deterministic circular-cluster layout grouped by node kind so edges are clearly visible.
  const positioned = useMemo(() => {
    const visible = graph.nodes.slice(0, 48);
    const coords = new Map<string, { x: number; y: number; node: Record<string, unknown> }>();
    const total = Math.max(1, visible.length);
    visible.forEach((n, idx) => {
      const angle = (idx / total) * Math.PI * 2;
      const radius = visible.length <= 8 ? 90 : 110 + (idx % 2) * 35;
      const x = Math.round(300 + Math.cos(angle) * radius);
      const y = Math.round(145 + Math.sin(angle) * (radius * 0.72));
      coords.set(String(n.id), { x, y, node: n });
    });
    return coords;
  }, [graph.nodes]);

  const selectedEdges = useMemo(() => {
    if (!selected) return [];
    const sid = String(selected.id);
    return graph.edges.filter((e) => String(e.source) === sid || String(e.target) === sid);
  }, [graph.edges, selected]);

  return (
    <section className="workspace-page" aria-label="Starmap">
      <div className="workspace-page-heading">
        <h1>Starmap</h1>
        <p>Grounded relationship graph of real memories, skills, conversations, and artifacts (zero synthetic nodes).</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[var(--color-ink-dim)]">
        <span>{graph.nodes.length} node(s) · {graph.edges.length} grounded edge(s)</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setViewMode('graph')} className={`rounded border px-2 py-0.5 ${viewMode === 'graph' ? 'border-[var(--color-accent)] text-[var(--color-ink)]' : 'border-[var(--color-border)]'}`}>Graph</button>
          <button type="button" onClick={() => setViewMode('timeline')} className={`rounded border px-2 py-0.5 ${viewMode === 'timeline' ? 'border-[var(--color-accent)] text-[var(--color-ink)]' : 'border-[var(--color-border)]'}`}>Timeline</button>
          {viewMode === 'graph' ? (
            <>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">+</button>
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">-</button>
              <button type="button" aria-label="Pan left" onClick={() => setPan((p) => ({ ...p, x: p.x - 30 }))} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">←</button>
              <button type="button" aria-label="Pan right" onClick={() => setPan((p) => ({ ...p, x: p.x + 30 }))} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">→</button>
              <button type="button" aria-label="Reset view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Reset</button>
            </>
          ) : null}
          <button type="button" onClick={() => void reload()} className="rounded border border-[var(--color-border)] px-2.5 py-0.5 text-[var(--color-ink)]">Refresh</button>
        </div>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="workspace-empty-card">No memories, skills, sessions, or artifacts in this project yet.</div>
      ) : viewMode === 'timeline' ? (
        <div className="space-y-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11.5px]">
          {graph.timeline.length === 0 ? (
            <div className="text-[var(--color-ink-dim)]">No timestamped records available yet.</div>
          ) : (
            graph.timeline.map((t, i) => (
              <div key={`${String(t.id)}-${i}`} className="flex items-center justify-between border-b border-[var(--color-border)] py-1 last:border-b-0">
                <span><strong className="text-[var(--color-ink)]">[{String(t.kind)}]</strong> {String(t.label)}</span>
                <span className="text-[var(--color-ink-dim)]">{new Date(Number(t.timestamp)).toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <svg viewBox="0 0 600 290" className="h-[270px] w-full" role="img" aria-label="Memory and activity graph">
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {graph.edges.map((e, idx) => {
                const src = positioned.get(String(e.source));
                const dst = positioned.get(String(e.target));
                if (!src || !dst) return null;
                return (
                  <line
                    key={`${String(e.source)}-${String(e.target)}-${idx}`}
                    data-edge-relation={String(e.relation ?? 'related')}
                    x1={src.x}
                    y1={src.y}
                    x2={dst.x}
                    y2={dst.y}
                    stroke="currentColor"
                    strokeOpacity={0.35}
                    strokeWidth={1.25}
                  />
                );
              })}
              {[...positioned.entries()].map(([id, { x, y, node }]) => {
                const kind = String(node.kind ?? 'node');
                const isSel = selected?.id === node.id;
                return (
                  <g key={id} data-node-kind={kind} onClick={() => setSelected(node)} style={{ cursor: 'pointer' }}>
                    {kind === 'artifact' ? (
                      <rect x={x - 6} y={y - 6} width={12} height={12} fill="currentColor" opacity={isSel ? 1 : 0.8} />
                    ) : kind === 'skill' ? (
                      <polygon points={`${x},${y - 7} ${x + 7},${y + 5} ${x - 7},${y + 5}`} fill="currentColor" opacity={isSel ? 1 : 0.8} />
                    ) : (
                      <circle cx={x} cy={y} r={isSel ? 9 : 6} fill="currentColor" opacity={isSel ? 1 : 0.85} />
                    )}
                    <text x={x + 10} y={y + 4} fontSize="9" fill="currentColor" opacity={0.8}>
                      {String(node.label ?? id).slice(0, 16)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {selected ? (
            <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11.5px] space-y-1">
              <strong className="text-[var(--color-ink)]">[{String(selected.kind)}] {String(selected.label)}</strong>
              <div className="text-[11px] text-[var(--color-ink-dim)]">
                Connected edges: {selectedEdges.length}
                {selectedEdges.length > 0 ? ` (${selectedEdges.map((e) => String(e.relation)).join(', ')})` : ''}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 7. Session Import (Safe 2-Phase JSON & Markdown Importer)
 * ------------------------------------------------------------------ */

export function SessionImportPage(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cyps?.sessionImport : undefined;
  const [rawText, setRawText] = useState('');
  const [format, setFormat] = useState<'json' | 'markdown'>('json');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handlePreview = async (): Promise<void> => {
    if (!api || !rawText.trim()) return;
    setStatus(null);
    setPreview(await api.preview(rawText, format));
  };

  const handleImport = async (): Promise<void> => {
    if (!api || !rawText.trim()) return;
    const res = await api.commit(rawText, format);
    if (res.ok) {
      setStatus(`Imported ${String(res.imported)} session(s) (${String(res.messages)} message(s)).`);
      setRawText('');
      setPreview(null);
    } else {
      setStatus(String(res.error ?? 'Import failed.'));
    }
  };

  return (
    <section className="workspace-page" aria-label="Session Import">
      <div className="workspace-page-heading">
        <h1>Session Import</h1>
        <p>Validate, preview, and safely import JSON or Markdown conversation exports into HistoryStore without overwriting existing history.</p>
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <select aria-label="Import format" value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'markdown')} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-ink)]">
            <option value="json">JSON Export</option>
            <option value="markdown">Markdown Transcript</option>
          </select>
          <button type="button" onClick={() => void handlePreview()} className="rounded border border-[var(--color-border)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">Preview</button>
          <button type="button" disabled={!preview?.ok || Boolean(preview?.duplicate)} onClick={() => void handleImport()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">Import</button>
        </div>
        <textarea
          aria-label="Session export content"
          rows={6}
          placeholder='Paste JSON ({"title":"...","messages":[{"role":"user","content":"..."}]}) or Markdown (User: ... / Assistant: ...)'
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-[12px] text-[var(--color-ink)]"
        />
        {preview ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11.5px]">
            {preview.ok
              ? `Ready: ${String(preview.sessionCount)} session(s), ${String(preview.messageCount)} message(s)${preview.duplicate ? ' (Duplicate detected — already imported)' : ''}`
              : String(preview.error ?? 'Invalid export.')}
          </div>
        ) : null}
        {status ? <p className="text-[11.5px] text-[var(--color-ink-dim)]" role="status">{status}</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 8. Dedicated Messaging & Webhooks Pages (All Primary Adapters + Copy)
 * ------------------------------------------------------------------ */

type PrimaryPlatformKey = 'telegram' | 'discord' | 'slack' | 'whatsapp_cloud' | 'matrix' | 'email';

export function DedicatedMessagingPage(): React.JSX.Element {
  const gwApi = typeof window !== 'undefined' ? window.cyps?.gateway : undefined;
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [selectedAdapter, setSelectedAdapter] = useState<PrimaryPlatformKey>('telegram');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [deviceName, setDeviceName] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    if (gwApi) setStatus(await gwApi.status().catch(() => null));
  };

  useEffect(() => {
    void reload();
  }, []);

  const running = Boolean(status?.running);
  const platforms = Array.isArray(status?.platforms) ? (status.platforms as Array<Record<string, unknown>>) : [];
  const fullAdapters = platforms.filter((p) => p.supportLevel === 'full_adapter');
  const extendedPlatforms = platforms.filter((p) => p.tier === 'extended');
  const pendingPairings = Array.isArray(status?.pendingPairings) ? (status.pendingPairings as Array<Record<string, unknown>>) : [];
  const pairedDevices = Array.isArray(status?.pairedDevices) ? (status.pairedDevices as Array<Record<string, unknown>>) : [];

  const activePlatformRow = platforms.find((p) => String(p.id) === selectedAdapter);

  const connectSelectedAdapter = async (): Promise<void> => {
    if (!gwApi) return;
    const payload: Record<string, unknown> = { ...fields };
    const res = await gwApi.platformConfigure(selectedAdapter, payload, true);
    setFields({});
    setNotice(res.ok ? `${selectedAdapter} connected.` : String(res.error ?? `Could not connect ${selectedAdapter}.`));
    await reload();
  };

  return (
    <section className="workspace-page" aria-label="Messaging">
      <div className="workspace-page-heading">
        <h1>Messaging &amp; Remote Access</h1>
        <p>Configure authorized messaging adapters and paired devices backed by Pixel&apos;s Python Gateway.</p>
      </div>
      <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
        <span>Gateway: <strong>{running ? 'Running' : 'Stopped'}</strong> · {fullAdapters.length} full bidirectional adapters + Email SMTP outbound</span>
        <button type="button" onClick={() => void (running ? gwApi?.stop() : gwApi?.start('127.0.0.1', 0))?.then(reload)} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">
          {running ? 'Stop Gateway' : 'Start Gateway'}
        </button>
      </div>

      {revealedToken ? (
        <div className="mb-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 text-[11.5px]" role="alert">
          <strong className="text-[var(--color-ink)]">One-Time Paired Device Token (shown once — copy now):</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-[var(--color-ink)]">{revealedToken}</pre>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => void copyTextToClipboard(revealedToken).then((ok) => setTokenCopied(ok))}
              className="rounded border border-[var(--color-accent)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink)]"
            >
              {tokenCopied ? 'Copied' : 'Copy Token'}
            </button>
            <button type="button" onClick={() => { setRevealedToken(null); setTokenCopied(false); }} className="rounded border border-[var(--color-border)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink)]">
              I have copied this token
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px] space-y-2.5">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Primary messaging adapters">
          {(
            [
              ['telegram', 'Telegram'],
              ['discord', 'Discord'],
              ['slack', 'Slack'],
              ['whatsapp_cloud', 'WhatsApp Cloud'],
              ['matrix', 'Matrix'],
              ['email', 'Email (SMTP Outbound)'],
            ] as Array<[PrimaryPlatformKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selectedAdapter === key}
              onClick={() => { setSelectedAdapter(key); setFields({}); }}
              className={`rounded border px-2.5 py-1 text-[11.5px] ${selectedAdapter === key ? 'border-[var(--color-accent)] text-[var(--color-ink)]' : 'border-[var(--color-border)] text-[var(--color-ink-dim)]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-[var(--color-ink-dim)]">
          <span>
            Status: {activePlatformRow?.connected ? 'Connected' : activePlatformRow?.configured ? 'Configured' : 'Disconnected'}
            {' · Support level: '}
            <code>{String(activePlatformRow?.supportLevel ?? (selectedAdapter === 'email' ? 'outbound_only' : selectedAdapter === 'telegram' || selectedAdapter === 'slack' ? 'full_adapter' : 'partial'))}</code>
          </span>
          {activePlatformRow?.connected ? (
            <button type="button" onClick={() => void gwApi?.platformDisconnect(selectedAdapter).then(reload)} className="text-[var(--color-danger)]">Disconnect</button>
          ) : null}
        </div>

        {selectedAdapter === 'telegram' ? (
          <div className="flex gap-2">
            <input type="password" aria-label="Telegram token" placeholder="Bot token (123456:ABC...)" value={fields.botToken ?? ''} onChange={(e) => setFields({ botToken: e.target.value })} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <button type="button" disabled={!(fields.botToken ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
          </div>
        ) : null}

        {selectedAdapter === 'discord' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <input type="password" aria-label="Discord bot token" placeholder="Discord Bot Token" value={fields.botToken ?? ''} onChange={(e) => setFields((f) => ({ ...f, botToken: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <div className="flex gap-2">
              <input type="text" aria-label="Discord application ID" placeholder="Application ID (optional)" value={fields.applicationId ?? ''} onChange={(e) => setFields((f) => ({ ...f, applicationId: e.target.value }))} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
              <button type="button" disabled={!(fields.botToken ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
            </div>
          </div>
        ) : null}

        {selectedAdapter === 'slack' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <input type="password" aria-label="Slack bot token" placeholder="Slack Bot Token (xoxb-...)" value={fields.botToken ?? ''} onChange={(e) => setFields((f) => ({ ...f, botToken: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <div className="flex gap-2">
              <input type="password" aria-label="Slack signing secret" placeholder="Signing Secret (optional)" value={fields.signingSecret ?? ''} onChange={(e) => setFields((f) => ({ ...f, signingSecret: e.target.value }))} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
              <button type="button" disabled={!(fields.botToken ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
            </div>
          </div>
        ) : null}

        {selectedAdapter === 'whatsapp_cloud' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <input type="password" aria-label="WhatsApp access token" placeholder="Meta Cloud API Access Token" value={fields.accessToken ?? ''} onChange={(e) => setFields((f) => ({ ...f, accessToken: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <div className="flex gap-2">
              <input type="text" aria-label="WhatsApp phone number ID" placeholder="Phone Number ID" value={fields.phoneNumberId ?? ''} onChange={(e) => setFields((f) => ({ ...f, phoneNumberId: e.target.value }))} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
              <button type="button" disabled={!(fields.accessToken ?? '').trim() || !(fields.phoneNumberId ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
            </div>
          </div>
        ) : null}

        {selectedAdapter === 'matrix' ? (
          <div className="grid gap-2 md:grid-cols-3">
            <input type="text" aria-label="Matrix homeserver URL" placeholder="https://matrix.org" value={fields.homeserverUrl ?? ''} onChange={(e) => setFields((f) => ({ ...f, homeserverUrl: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <input type="password" aria-label="Matrix access token" placeholder="Access Token" value={fields.accessToken ?? ''} onChange={(e) => setFields((f) => ({ ...f, accessToken: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <button type="button" disabled={!(fields.homeserverUrl ?? '').trim() || !(fields.accessToken ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
          </div>
        ) : null}

        {selectedAdapter === 'email' ? (
          <div className="grid gap-2 md:grid-cols-4">
            <input type="text" aria-label="SMTP host" placeholder="smtp.example.com" value={fields.smtpHost ?? ''} onChange={(e) => setFields((f) => ({ ...f, smtpHost: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <input type="text" aria-label="From address" placeholder="pixel@example.com" value={fields.fromAddress ?? ''} onChange={(e) => setFields((f) => ({ ...f, fromAddress: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <input type="password" aria-label="SMTP password" placeholder="App password (optional)" value={fields.password ?? ''} onChange={(e) => setFields((f) => ({ ...f, password: e.target.value }))} className="rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <button type="button" disabled={!(fields.smtpHost ?? '').trim() || !(fields.fromAddress ?? '').trim()} onClick={() => void connectSelectedAdapter()} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Connect SMTP</button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
        <div className="mb-1.5 font-medium text-[var(--color-ink)]">Pair Remote Device</div>
        <div className="flex gap-2">
          <input type="text" aria-label="Device name" placeholder="Laptop / Tablet" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
          <button type="button" disabled={!deviceName.trim()} onClick={() => void gwApi?.devicePair(deviceName.trim()).then((r) => { setDeviceName(''); if (r.ok && r.token) { setRevealedToken(r.token); setTokenCopied(false); } return reload(); })} className="rounded border border-[var(--color-accent)] px-3 py-1 text-[11px] text-[var(--color-ink)]">Pair</button>
        </div>
      </div>

      {pendingPairings.length > 0 ? (
        <div className="mb-3 space-y-1.5">
          <div className="text-[11.5px] font-medium text-[var(--color-ink)]">Pending Pairing Requests</div>
          {pendingPairings.map((p) => (
            <div key={String(p.code)} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11.5px]">
              <span>{String(p.platform)} · {String(p.accountId)} ({String(p.code)})</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => void gwApi?.pairingApprove(String(p.code)).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Approve</button>
                <button type="button" onClick={() => void gwApi?.pairingReject(String(p.code)).then(reload)} className="text-[var(--color-danger)]">Reject</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mb-4 space-y-1.5">
        <div className="text-[11.5px] font-medium text-[var(--color-ink)]">Paired Devices ({pairedDevices.length})</div>
        {pairedDevices.map((d) => (
          <div key={String(d.id)} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11.5px]">
            <span>{String(d.name)} · project={String(d.projectId)}</span>
            <button type="button" onClick={() => void gwApi?.deviceRevoke(String(d.id)).then(reload)} className="text-[var(--color-danger)]">Revoke</button>
          </div>
        ))}
      </div>

      {extendedPlatforms.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px]">
          <div className="mb-1.5 font-medium text-[var(--color-ink)]">Extended Platforms ({extendedPlatforms.length}) — Honest Capability Status</div>
          <div className="grid gap-1 md:grid-cols-2 text-[var(--color-ink-dim)]">
            {extendedPlatforms.map((ep) => (
              <div key={String(ep.id)} className="flex items-center justify-between border-b border-[var(--color-border)] py-0.5">
                <span>{String(ep.name)}</span>
                <code>{String(ep.supportLevel)}</code>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function DedicatedWebhooksPage(): React.JSX.Element {
  const gwApi = typeof window !== 'undefined' ? window.cyps?.gateway : undefined;
  const [routes, setRoutes] = useState<Array<Record<string, unknown>>>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const reload = async (): Promise<void> => {
    if (!gwApi) return;
    const [st, hist] = await Promise.all([
      gwApi.status().catch(() => null),
      gwApi.webhookHistory(30).catch(() => []),
    ]);
    setRoutes(Array.isArray(st?.webhooks) ? (st.webhooks as Array<Record<string, unknown>>) : []);
    setHistory(Array.isArray(hist) ? hist : []);
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <section className="workspace-page" aria-label="Webhooks">
      <div className="workspace-page-heading">
        <h1>Webhooks</h1>
        <p>HMAC-SHA256 verified event routes with route-scoped replay protection and delivery history.</p>
      </div>

      {revealedSecret ? (
        <div className="mb-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 text-[11.5px]" role="alert">
          <strong className="text-[var(--color-ink)]">One-Time Webhook Signing Secret (shown once — copy now):</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-[var(--color-ink)]">{revealedSecret}</pre>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => void copyTextToClipboard(revealedSecret).then((ok) => setSecretCopied(ok))}
              className="rounded border border-[var(--color-accent)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink)]"
            >
              {secretCopied ? 'Copied' : 'Copy Secret'}
            </button>
            <button type="button" onClick={() => { setRevealedSecret(null); setSecretCopied(false); }} className="rounded border border-[var(--color-border)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink)]">
              I have saved this secret
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex gap-2">
        <input type="text" aria-label="Webhook name" placeholder="GitHub Push / CI Alert" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]" />
        <button type="button" disabled={!name.trim()} onClick={() => void gwApi?.webhookCreate(name.trim()).then((r) => { setName(''); if (r.ok && r.signingSecret) { setRevealedSecret(r.signingSecret); setSecretCopied(false); } return reload(); })} className="rounded-lg border border-[var(--color-accent)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]">Create Route</button>
      </div>

      <div className="space-y-2">
        {routes.map((r) => {
          const id = String(r.id ?? '');
          const enabled = Boolean(r.enabled);
          return (
            <div key={id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
              <div>
                <strong className="text-[var(--color-ink)]">{String(r.name ?? id)}</strong>
                <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">{String(r.path ?? '')} · project={String(r.projectId ?? 'default')}</span>
              </div>
              <div className="flex gap-2 text-[11px]">
                <button type="button" onClick={() => void gwApi?.webhookSetEnabled(id, !enabled).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">{enabled ? 'Disable' : 'Enable'}</button>
                <button type="button" onClick={() => void gwApi?.webhookDelete(id).then(reload)} className="text-[var(--color-danger)]">Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {history.length > 0 ? (
        <div className="mt-4">
          <h2 className="workspace-section-title mb-2">Recent Deliveries ({history.length})</h2>
          <div className="space-y-1 text-[11px] text-[var(--color-ink-dim)]">
            {history.slice(-10).map((h, i) => (
              <div key={i} className="rounded border border-[var(--color-border)] px-2.5 py-1">
                {String(h.routeId)} · {h.ok ? 'Accepted' : `Rejected (${String(h.reason ?? 'error')})`} · event={String(h.event ?? '—')}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
