/**
 * Stage 9 Full-Page Hermes-Style Desktop Destinations for Pixel.
 *
 * Strictly monochrome surface tokens (`--color-surface`, `--color-border`,
 * `--color-ink`, `--color-ink-dim`, `--color-accent`, `--color-danger`),
 * backed by Pixel's real Python-first IPC services (`profiles`, `artifacts`,
 * `starmap`, `sessionImport`, `gateway`, `routines`, `history`, `tasks`,
 * `system.diagnostics`).
 */

import { useEffect, useState } from 'react';
import type { ConversationSummary, DiagnosticsSnapshot, RoutineRecord, TaskRecord } from '@shared/types';

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
            className={`rounded-lg border px-3 py-1 text-[11.5px] font-medium ${
              tab === t ? 'border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-ink)]' : 'border-[var(--color-border)] text-[var(--color-ink-dim)]'
            }`}
          >
            {t[0].toUpperCase() + t.slice(1)}
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
              Platform: {diag?.platform ?? 'win32'} {diag?.release ?? ''} ({diag?.arch ?? 'x64'}) · CPUs: {diag?.cpuCount ?? '—'}
            </p>
            <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">
              Gateway: {gwStatus?.running ? 'Running' : 'Stopped'} · Active Remote Sessions: {Number(gwStatus?.activeSessions ?? 0)}
            </p>
          </div>
        </div>
      ) : null}

      {tab === 'usage' ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
          <strong className="text-[var(--color-ink)]">Measured Workspace Activity</strong>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">
            Conversations recorded: {sessions.length} · Agent tasks tracked: {tasks.length} · Completed tasks: {tasks.filter((t) => t.status === 'completed').length}
          </p>
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
          <strong className="text-[var(--color-ink)]">Safe Maintenance</strong>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink-dim)]">Refresh live diagnostics and clear expired permission grants.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void reload()} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Refresh Diagnostics</button>
            <button type="button" onClick={() => void window.cyps?.permissions.clearExpired()} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Clear Expired Grants</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 2. Profiles (Isolated Profiles + Soul/Instructions Editor)
 * ------------------------------------------------------------------ */

export function ProfilesPage(): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cyps?.profiles : undefined;
  const [profiles, setProfiles] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
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
    const res = await api.create({ name: name.trim(), instructions: instructions.trim() });
    setNotice(res.ok ? `Created profile "${name.trim()}".` : String(res.error ?? 'Could not create profile.'));
    if (res.ok) {
      setName('');
      setInstructions('');
      await reload();
    }
  };

  return (
    <section className="workspace-page" aria-label="Profiles">
      <div className="workspace-page-heading">
        <h1>Profiles</h1>
        <p>Isolated desktop profiles with separate instructions, artifact scopes, and default-profile protection.</p>
      </div>
      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
        <div className="text-[12px] font-medium text-[var(--color-ink)]">Create Profile</div>
        <input
          type="text"
          aria-label="New profile name"
          placeholder="Work / Research / Personal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
        />
        <textarea
          aria-label="Profile instructions"
          placeholder="Optional profile system instructions / persona…"
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full rounded border border-[var(--color-border)] bg-black/20 px-2.5 py-1.5 text-[12px] text-[var(--color-ink)]"
        />
        <button type="button" disabled={!name.trim()} onClick={() => void handleCreate()} className="rounded border border-[var(--color-border)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">
          Create Profile
        </button>
      </div>

      <div className="space-y-2">
        {profiles.map((p) => {
          const id = String(p.id ?? '');
          const isActive = Boolean(p.active);
          const isDefault = Boolean(p.isDefault);
          return (
            <div key={id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
              <div>
                <strong className="text-[var(--color-ink)]">{String(p.name ?? id)}</strong>
                <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">
                  {isActive ? 'Active' : 'Inactive'}{isDefault ? ' · Default (Protected)' : ''}
                </span>
                {p.instructions ? <p className="mt-0.5 text-[11px] text-[var(--color-ink-dim)]">{String(p.instructions).slice(0, 120)}</p> : null}
              </div>
              <div className="flex gap-2 text-[11px]">
                {!isActive ? (
                  <button type="button" onClick={() => void api?.switch(id).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">Switch</button>
                ) : null}
                {!isDefault ? (
                  <button type="button" onClick={() => void api?.delete(id).then(reload)} className="text-[var(--color-danger)]">Delete</button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 3. Agents (Live Delegation & Active Task Tree)
 * ------------------------------------------------------------------ */

export function AgentsPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);

  const reload = async (): Promise<void> => {
    const list = await window.cyps?.tasks.list().catch(() => []);
    setTasks(list ?? []);
  };

  useEffect(() => {
    void reload();
    return window.cyps?.tasks.onUpdate(() => void reload());
  }, []);

  return (
    <section className="workspace-page" aria-label="Agents">
      <div className="workspace-page-heading">
        <h1>Agents &amp; Delegation</h1>
        <p>Live agent runs, delegated child tasks, step progress, and cancellation controls.</p>
      </div>
      {tasks.length === 0 ? (
        <div className="workspace-empty-card">No agent runs or delegated tasks recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <strong className="text-[var(--color-ink)]">{t.title}</strong>
                  <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">{t.status} · {t.steps.length} step(s)</span>
                </div>
                {t.status === 'running' ? (
                  <button type="button" onClick={() => void window.cyps?.tasks.cancel(t.id)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-danger)]">Cancel</button>
                ) : null}
              </div>
              {t.steps.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-ink-dim)]">
                  {t.steps.slice(-5).map((s) => (
                    <li key={s.id}>[{s.status}] {s.title}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 4. Artifacts Library
 * ------------------------------------------------------------------ */

export function ArtifactsPage({ projectId }: { projectId?: string }): React.JSX.Element {
  const api = typeof window !== 'undefined' ? window.cyps?.artifacts : undefined;
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const reload = async (): Promise<void> => {
    if (!api) return;
    setItems(await api.list({ projectId, kind, query }).catch(() => []));
  };

  useEffect(() => {
    void reload();
  }, [projectId, kind, query]);

  return (
    <section className="workspace-page" aria-label="Artifacts">
      <div className="workspace-page-heading">
        <h1>Artifacts</h1>
        <p>Generated images, documents, reports, and code outputs scoped to your active profile and project.</p>
      </div>
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
            return (
              <div key={id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
                <div>
                  <strong className="text-[var(--color-ink)]">{String(a.name ?? id)}</strong>
                  <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">{String(a.kind ?? 'file')} · {String(a.mimeType ?? '')}</span>
                  {a.previewText ? <p className="mt-0.5 text-[11px] text-[var(--color-ink-dim)]">{String(a.previewText).slice(0, 140)}</p> : null}
                </div>
                <button type="button" onClick={() => void api?.delete(id).then(reload)} className="text-[11px] text-[var(--color-danger)]">Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 5. Cron (Connected to Existing Pixel SQLite Scheduler)
 * ------------------------------------------------------------------ */

export function CronPage(): React.JSX.Element {
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);

  const reload = async (): Promise<void> => {
    setRoutines(await window.cyps?.routines.list().catch(() => []) ?? []);
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <section className="workspace-page" aria-label="Cron Scheduler">
      <div className="workspace-page-heading">
        <h1>Cron &amp; Scheduled Jobs</h1>
        <p>Backed by Pixel&apos;s SQLite routine scheduler with lease locking, timezone awareness, and cancellation.</p>
      </div>
      {routines.length === 0 ? (
        <div className="workspace-empty-card">No scheduled routines configured yet. Create a skill routine to schedule recurring tasks.</div>
      ) : (
        <div className="space-y-2">
          {routines.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
              <div>
                <strong className="text-[var(--color-ink)]">{r.name}</strong>
                <span className="ml-2 text-[11px] text-[var(--color-ink-dim)]">{r.localTime} ({r.timezone}) · {r.enabled ? 'Enabled' : 'Paused'}</span>
              </div>
              <div className="flex gap-2 text-[11px]">
                <button type="button" onClick={() => void window.cyps?.routines.setEnabled(r.id, !r.enabled).then(reload)} className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-ink)]">
                  {r.enabled ? 'Pause' : 'Resume'}
                </button>
                <button type="button" onClick={() => void window.cyps?.routines.delete(r.id).then(reload)} className="text-[var(--color-danger)]">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 6. Starmap (Grounded Memory, Skills, Sessions & Artifacts Graph)
 * ------------------------------------------------------------------ */

export function StarmapPage(): React.JSX.Element {
  const [graph, setGraph] = useState<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const reload = async (): Promise<void> => {
    const res = await window.cyps?.starmap?.build().catch(() => null);
    if (res && Array.isArray(res.nodes)) {
      setGraph({ nodes: res.nodes as Array<Record<string, unknown>>, edges: (res.edges as Array<Record<string, unknown>>) ?? [] });
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <section className="workspace-page" aria-label="Starmap">
      <div className="workspace-page-heading">
        <h1>Starmap</h1>
        <p>Grounded relationship graph of real memories, skills, conversations, and artifacts (zero synthetic nodes).</p>
      </div>
      <div className="mb-3 flex items-center justify-between text-[11.5px] text-[var(--color-ink-dim)]">
        <span>{graph.nodes.length} node(s) · {graph.edges.length} grounded edge(s)</span>
        <button type="button" onClick={() => void reload()} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-ink)]">Refresh</button>
      </div>
      {graph.nodes.length === 0 ? (
        <div className="workspace-empty-card">No memories, skills, sessions, or artifacts in this project yet.</div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <svg viewBox="0 0 600 260" className="h-[240px] w-full" role="img" aria-label="Memory and activity graph">
            {graph.nodes.slice(0, 36).map((n, idx) => {
              const cx = 50 + (idx % 6) * 100;
              const cy = 35 + Math.floor(idx / 6) * 40;
              return (
                <g key={String(n.id)} onClick={() => setSelected(n)} style={{ cursor: 'pointer' }}>
                  <circle cx={cx} cy={cy} r={selected?.id === n.id ? 9 : 6} fill="currentColor" opacity={0.85} />
                  <text x={cx + 10} y={cy + 4} fontSize="9" fill="currentColor" opacity={0.75}>
                    {String(n.label ?? n.id).slice(0, 14)}
                  </text>
                </g>
              );
            })}
          </svg>
          {selected ? (
            <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-[11.5px]">
              <strong className="text-[var(--color-ink)]">[{String(selected.kind)}] {String(selected.label)}</strong>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 7. Session Import (JSON & Markdown Conversation Importer)
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
        <p>Validate, preview, and safely import JSON or Markdown conversation exports without overwriting existing history.</p>
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <select aria-label="Import format" value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'markdown')} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-ink)]">
            <option value="json">JSON Export</option>
            <option value="markdown">Markdown Transcript</option>
          </select>
          <button type="button" onClick={() => void handlePreview()} className="rounded border border-[var(--color-border)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">Preview</button>
          <button type="button" disabled={!preview?.ok || Boolean(preview?.duplicate)} onClick={() => void handleImport()} className="rounded border border-[var(--color-border)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">Import</button>
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
 * 8. Dedicated Messaging & Webhooks Pages (with One-Time Secret Reveal)
 * ------------------------------------------------------------------ */

export function DedicatedMessagingPage(): React.JSX.Element {
  const gwApi = typeof window !== 'undefined' ? window.cyps?.gateway : undefined;
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [tgToken, setTgToken] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
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
  const pendingPairings = Array.isArray(status?.pendingPairings) ? (status.pendingPairings as Array<Record<string, unknown>>) : [];
  const pairedDevices = Array.isArray(status?.pairedDevices) ? (status.pairedDevices as Array<Record<string, unknown>>) : [];

  return (
    <section className="workspace-page" aria-label="Messaging">
      <div className="workspace-page-heading">
        <h1>Messaging &amp; Remote Access</h1>
        <p>Connect authorized messaging platforms and paired devices to Pixel&apos;s primary Python agent.</p>
      </div>
      <div className="mb-3 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px]">
        <span>Gateway: <strong>{running ? 'Running' : 'Stopped'}</strong> · {fullAdapters.length} primary native adapters</span>
        <button type="button" onClick={() => void (running ? gwApi?.stop() : gwApi?.start('127.0.0.1', 0))?.then(reload)} className="rounded border border-[var(--color-border)] px-3 py-1 text-[11.5px] text-[var(--color-ink)]">
          {running ? 'Stop Gateway' : 'Start Gateway'}
        </button>
      </div>

      {revealedToken ? (
        <div className="mb-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 text-[11.5px]" role="alert">
          <strong className="text-[var(--color-ink)]">One-Time Paired Device Token (shown once — copy now):</strong>
          <pre className="mt-1 overflow-x-auto rounded bg-black/30 p-2 text-[11px] text-[var(--color-ink)]">{revealedToken}</pre>
          <button type="button" onClick={() => setRevealedToken(null)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]">I have copied this token</button>
        </div>
      ) : null}

      {notice ? <p className="mb-2 text-[11.5px] text-[var(--color-ink-dim)]" role="status">{notice}</p> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
          <div className="mb-1.5 font-medium text-[var(--color-ink)]">Telegram Bot Connection</div>
          <div className="flex gap-2">
            <input type="password" aria-label="Telegram token" placeholder="123456:ABC..." value={tgToken} onChange={(e) => setTgToken(e.target.value)} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <button type="button" disabled={!tgToken.trim()} onClick={() => void gwApi?.platformConfigure('telegram', { botToken: tgToken.trim() }, true).then((r) => { setTgToken(''); setNotice(r.ok ? 'Telegram connected.' : String(r.error ?? 'Failed.')); return reload(); })} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Connect</button>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[12px]">
          <div className="mb-1.5 font-medium text-[var(--color-ink)]">Pair Remote Device</div>
          <div className="flex gap-2">
            <input type="text" aria-label="Device name" placeholder="Laptop / Tablet" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className="flex-1 rounded border border-[var(--color-border)] bg-black/20 px-2 py-1 text-[11.5px] text-[var(--color-ink)]" />
            <button type="button" disabled={!deviceName.trim()} onClick={() => void gwApi?.devicePair(deviceName.trim()).then((r) => { setDeviceName(''); if (r.ok && r.token) setRevealedToken(r.token); return reload(); })} className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-ink)]">Pair</button>
          </div>
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

      <div className="space-y-1.5">
        <div className="text-[11.5px] font-medium text-[var(--color-ink)]">Paired Devices ({pairedDevices.length})</div>
        {pairedDevices.map((d) => (
          <div key={String(d.id)} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11.5px]">
            <span>{String(d.name)} · project={String(d.projectId)}</span>
            <button type="button" onClick={() => void gwApi?.deviceRevoke(String(d.id)).then(reload)} className="text-[var(--color-danger)]">Revoke</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DedicatedWebhooksPage(): React.JSX.Element {
  const gwApi = typeof window !== 'undefined' ? window.cyps?.gateway : undefined;
  const [routes, setRoutes] = useState<Array<Record<string, unknown>>>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

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
          <button type="button" onClick={() => setRevealedSecret(null)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-ink)]">I have saved this secret</button>
        </div>
      ) : null}

      <div className="mb-4 flex gap-2">
        <input type="text" aria-label="Webhook name" placeholder="GitHub Push / CI Alert" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]" />
        <button type="button" disabled={!name.trim()} onClick={() => void gwApi?.webhookCreate(name.trim()).then((r) => { setName(''); if (r.ok && r.signingSecret) setRevealedSecret(r.signingSecret); return reload(); })} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-ink)]">Create Route</button>
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
