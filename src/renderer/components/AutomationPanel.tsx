import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock3, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { RoutineRecord, RoutineRunRecord, SkillDraftRequest, SkillRecord } from '@shared/types';
import { readBridge } from '@/lib/bridge';

interface AutomationPanelProps {
  onBack: () => void;
}

const EMPTY_SKILL: SkillDraftRequest = {
  schemaVersion: 1,
  name: 'Public status check',
  purpose: 'Open the public status page and report its current service state.',
  triggers: ['check the public service status'],
  inputs: [],
  requiredTools: ['browser_navigate', 'browser_inspect'],
  steps: [
    {
      ordinal: 0,
      kind: 'tool',
      locator: 'browser_navigate',
      action: 'browser_navigate',
      params: { url: 'https://status.example.com' },
      expectation: { urlPrefix: 'https://status.example.com' },
      approvalRequired: true,
    },
    {
      ordinal: 1,
      kind: 'tool',
      locator: 'browser_inspect',
      action: 'browser_inspect',
      params: {},
      expectation: { statusTextVisible: true },
      approvalRequired: false,
    },
  ],
  decisionBranches: ['If a service is degraded, include its name and visible status.'],
  verificationRules: ['Read the resulting page and confirm the service status is present.'],
  failureHandling: ['Stop if the page cannot be reached or the status cannot be verified.'],
  approvalRequirements: ['Pixel rechecks current policy and requests approval for consequential actions.'],
};

export function AutomationPanel({ onBack }: AutomationPanelProps): React.JSX.Element {
  const bridge = useMemo(() => readBridge(), []);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [routines, setRoutines] = useState<RoutineRecord[]>([]);
  const [draftJson, setDraftJson] = useState(() => JSON.stringify(EMPTY_SKILL, null, 2));
  const [reviewing, setReviewing] = useState<SkillRecord | null>(null);
  const [routineName, setRoutineName] = useState('Daily status check');
  const [localTime, setLocalTime] = useState('09:00');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [history, setHistory] = useState<Record<string, RoutineRunRecord[]>>({});
  const [retryConfirmation, setRetryConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    const [nextSkills, nextRoutines] = await Promise.all([
      bridge.bridge.skills.list(),
      bridge.bridge.routines.list(),
    ]);
    setSkills(nextSkills);
    setRoutines(nextRoutines);
    setSelectedSkillId((current) => current || nextSkills.find((skill) => skill.status === 'active' && !skill.inputs.some((input) => input.required))?.id || '');
  }, [bridge]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(messageOf(cause)));
  }, [refresh]);

  const schedulableSkills = useMemo(
    () => skills.filter((skill) => skill.status === 'active' && !skill.inputs.some((input) => input.required)),
    [skills],
  );

  const createDraft = useCallback(async () => {
    if (bridge.kind !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(draftJson);
      const created = await bridge.bridge.skills.createDraft(parsed as SkillDraftRequest);
      setSkills((current) => [created, ...current]);
      setReviewing(created);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, draftJson]);

  const activate = useCallback(async (skillId: string) => {
    if (bridge.kind !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const active = await bridge.bridge.skills.activate(skillId);
      setSkills((current) => current.map((skill) => skill.id === active.id ? active : skill));
      setReviewing(null);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, refresh]);

  const deleteSkill = useCallback(async (skillId: string) => {
    if (bridge.kind !== 'ready') return;
    setError(null);
    try {
      const removed = await bridge.bridge.skills.delete(skillId);
      if (!removed) throw new Error('This skill could not be deleted. Remove routines that reference it first.');
      setSkills((current) => current.filter((skill) => skill.id !== skillId));
      setReviewing(null);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge]);

  const createRoutine = useCallback(async () => {
    if (bridge.kind !== 'ready' || !selectedSkillId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await bridge.bridge.routines.create({
        skillId: selectedSkillId,
        name: routineName,
        localTime,
        timezone,
      });
      setRoutines((current) => [...current, created].sort((a, b) => a.localTime.localeCompare(b.localTime)));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, localTime, routineName, selectedSkillId, timezone]);

  const toggleRoutine = useCallback(async (routine: RoutineRecord) => {
    if (bridge.kind !== 'ready') return;
    try {
      await bridge.bridge.routines.setEnabled(routine.id, !routine.enabled);
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge, refresh]);

  const deleteRoutine = useCallback(async (routine: RoutineRecord) => {
    if (bridge.kind !== 'ready') return;
    try {
      const removed = await bridge.bridge.routines.delete(routine.id);
      if (!removed) throw new Error('Cancel the active run and try again.');
      setRoutines((current) => current.filter((item) => item.id !== routine.id));
      setHistory((current) => { const next = { ...current }; delete next[routine.id]; return next; });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge]);

  const loadHistory = useCallback(async (routine: RoutineRecord) => {
    if (bridge.kind !== 'ready') return;
    try {
      const rows = await bridge.bridge.routines.history(routine.id);
      setHistory((current) => ({ ...current, [routine.id]: rows }));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge]);

  const cancelRoutine = useCallback(async (routine: RoutineRecord) => {
    if (bridge.kind !== 'ready') return;
    await bridge.bridge.routines.cancel(routine.id).catch((cause: unknown) => setError(messageOf(cause)));
    await loadHistory(routine);
  }, [bridge, loadHistory]);

  const retryRoutine = useCallback(async (routine: RoutineRecord) => {
    if (bridge.kind !== 'ready') return;
    try {
      const queued = await bridge.bridge.routines.retry(routine.id);
      if (!queued) throw new Error('The retry could not be queued. Check whether Pixel is stopped or already running this routine.');
      setRetryConfirmation(null);
      await loadHistory(routine);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [bridge, loadHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2.5">
      <button type="button" onClick={onBack} className="no-drag mb-2 flex w-fit items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-[var(--color-ink-soft)] hover:bg-white/8">
        <ArrowLeft size={12} aria-hidden="true" /> Back to settings
      </button>
      <p className="mb-2 text-[10.5px] leading-snug text-[var(--color-ink-dim)]">
        Skills stay in this project and run only after review. Routines run while Pixel is open; missed times are skipped, and a failed run pauses that routine.
      </p>
      {error ? <p role="alert" className="mb-2 rounded-lg border border-rose-400/35 bg-rose-500/12 px-2 py-1.5 text-[10.5px] text-rose-100">{error}</p> : null}

      {reviewing ? (
        <section className="mb-2 rounded-xl border border-amber-300/35 bg-amber-300/8 p-2">
          <h3 className="text-[11px] font-semibold text-amber-100">Review draft: {reviewing.name}</h3>
          <p className="mt-1 text-[10px] text-[var(--color-ink-soft)]">{reviewing.purpose}</p>
          <pre className="selectable mt-1 max-h-32 overflow-auto rounded-lg bg-black/20 p-1.5 font-mono text-[9px] leading-relaxed text-[var(--color-ink-dim)]">{JSON.stringify(reviewing, null, 2)}</pre>
          <div className="mt-1.5 flex gap-1.5">
            <button disabled={busy} type="button" onClick={() => void activate(reviewing.id)} className="rounded-lg bg-emerald-500/25 px-2 py-1 text-[10px] font-semibold text-emerald-100 disabled:opacity-50">Approve and activate</button>
            <button type="button" onClick={() => void deleteSkill(reviewing.id)} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-[var(--color-ink-soft)]">Discard</button>
          </div>
        </section>
      ) : null}

      <section className="mb-2 rounded-xl border border-[var(--color-glass-border)] bg-white/4 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-dim)]"><Plus size={11} /> Create skill draft</div>
        <p className="mb-1 text-[9.5px] text-[var(--color-ink-dim)]">Paste a typed skill definition. Typed values must use declared inputs; literal text is rejected.</p>
        <textarea aria-label="Skill definition JSON" value={draftJson} onChange={(event) => setDraftJson(event.target.value)} spellCheck={false} className="no-drag selectable h-24 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-1.5 font-mono text-[9px] text-[var(--color-ink-soft)] outline-none focus:border-sky-300/50" />
        <button disabled={busy} type="button" onClick={() => void createDraft()} className="mt-1 rounded-lg border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-[10px] font-medium text-sky-100 disabled:opacity-50">Save draft for review</button>
      </section>

      <section className="mb-2 rounded-xl border border-[var(--color-glass-border)] bg-white/4 p-2">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-dim)]"><Check size={11} /> Project skills</h3>
          <button type="button" onClick={() => void refresh().catch((cause: unknown) => setError(messageOf(cause)))} aria-label="Refresh skills and routines" className="rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-white/10"><RefreshCw size={11} /></button>
        </div>
        {skills.length === 0 ? <p className="px-1 py-1 text-[10px] text-[var(--color-ink-dim)]">No saved skills yet.</p> : skills.map((skill) => (
          <div key={skill.id} className="flex items-center gap-1 border-t border-white/6 py-1">
            <button type="button" onClick={() => setReviewing(skill)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[10.5px] text-[var(--color-ink-soft)]">{skill.name} · v{skill.version}</span>
              <span className="text-[9px] uppercase tracking-wide text-[var(--color-ink-dim)]">{skill.status}</span>
            </button>
            {skill.status === 'draft' ? <button type="button" onClick={() => setReviewing(skill)} className="rounded-md px-1.5 py-1 text-[9.5px] text-amber-100 hover:bg-white/8">Review</button> : null}
            <button type="button" onClick={() => void deleteSkill(skill.id)} aria-label={`Delete ${skill.name}`} className="rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-rose-500/15 hover:text-rose-100"><Trash2 size={11} /></button>
          </div>
        ))}
      </section>

      <section className="mb-2 rounded-xl border border-[var(--color-glass-border)] bg-white/4 p-2">
        <h3 className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-dim)]"><Clock3 size={11} /> Daily routine</h3>
        <select aria-label="Skill for routine" value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)} className="no-drag mb-1 w-full rounded-lg border border-white/10 bg-black/20 px-1.5 py-1 text-[10px] text-[var(--color-ink-soft)]">
          <option value="">Choose a reviewed skill</option>
          {schedulableSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-1">
          <input aria-label="Routine name" value={routineName} onChange={(event) => setRoutineName(event.target.value)} className="no-drag min-w-0 rounded-lg border border-white/10 bg-black/20 px-1.5 py-1 text-[10px] text-[var(--color-ink-soft)]" />
          <input aria-label="Daily run time" type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} className="no-drag min-w-0 rounded-lg border border-white/10 bg-black/20 px-1.5 py-1 text-[10px] text-[var(--color-ink-soft)]" />
        </div>
        <input aria-label="IANA timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="no-drag mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-1.5 py-1 text-[10px] text-[var(--color-ink-soft)]" />
        <button disabled={busy || !selectedSkillId} type="button" onClick={() => void createRoutine()} className="mt-1 rounded-lg border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-[10px] font-medium text-sky-100 disabled:opacity-50">Schedule daily</button>
      </section>

      <section className="mb-1 rounded-xl border border-[var(--color-glass-border)] bg-white/4 p-2">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-dim)]">Routines</h3>
        {routines.length === 0 ? <p className="px-1 py-1 text-[10px] text-[var(--color-ink-dim)]">No routines scheduled.</p> : routines.map((routine) => (
          <div key={routine.id} className="border-t border-white/6 py-1.5">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-ink-soft)]">{routine.name} · {routine.localTime} {routine.timezone}</span>
              <button type="button" onClick={() => void toggleRoutine(routine)} aria-label={`${routine.enabled ? 'Pause' : 'Resume'} ${routine.name}`} className="rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-white/10">{routine.enabled ? <Pause size={11} /> : <Play size={11} />}</button>
              <button type="button" onClick={() => void deleteRoutine(routine)} aria-label={`Delete ${routine.name}`} className="rounded-md p-1 text-[var(--color-ink-dim)] hover:bg-rose-500/15 hover:text-rose-100"><Trash2 size={11} /></button>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-[9px] text-[var(--color-ink-dim)]">{routine.enabled ? 'Active while Pixel is open' : 'Paused'}</span>
              <button type="button" onClick={() => void loadHistory(routine)} className="text-[9px] text-sky-200/80 hover:text-sky-100">Refresh history</button>
              {history[routine.id]?.some((run) => run.status === 'running') ? <button type="button" onClick={() => void cancelRoutine(routine)} className="text-[9px] text-rose-200">Stop current run</button> : null}
            </div>
            {['failed', 'denied'].includes(history[routine.id]?.[0]?.status ?? '') ? (
              retryConfirmation === routine.id ? (
                <div className="mt-1 rounded-lg border border-amber-300/20 bg-amber-300/8 p-1.5">
                  <p className="text-[9px] text-amber-100">The earlier attempt may have partly completed. Pixel will inspect the current state and still ask for required approvals.</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => void retryRoutine(routine)} className="text-[9px] font-semibold text-amber-100">Confirm one-time retry</button>
                    <button type="button" onClick={() => setRetryConfirmation(null)} className="text-[9px] text-[var(--color-ink-dim)]">Keep paused</button>
                  </div>
                </div>
              ) : <button type="button" onClick={() => setRetryConfirmation(routine.id)} className="mt-1 text-[9px] text-amber-100/90">Retry once…</button>
            ) : null}
            {history[routine.id]?.slice(0, 3).map((run) => <p key={run.id} className="mt-0.5 truncate text-[9px] text-[var(--color-ink-dim)]">{new Date(run.startedAt).toLocaleString()} · {run.status}{run.failure ? ` · ${run.failure}` : ''}</p>)}
          </div>
        ))}
      </section>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
