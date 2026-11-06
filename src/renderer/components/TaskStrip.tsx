import { useState } from 'react';
import {
  Check,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Loader2,
  Pause,
  X,
} from 'lucide-react';
import type { TaskRecord, TaskStatus, TaskStep } from '@shared/types';
import { relativeTime, truncate } from '@/lib/format';

interface TaskStripProps {
  task: TaskRecord;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  planning: 'Planning',
  running: 'Running',
  awaiting_approval: 'Needs your OK',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<TaskStatus, string> = {
  planning: 'text-violet-200 border-violet-400/35 bg-violet-400/12',
  running: 'text-amber-100 border-amber-400/35 bg-amber-400/12',
  awaiting_approval: 'text-amber-100 border-amber-400/45 bg-amber-400/18',
  paused: 'text-slate-200 border-slate-400/35 bg-slate-400/12',
  completed: 'text-emerald-100 border-emerald-400/35 bg-emerald-400/12',
  failed: 'text-rose-100 border-rose-400/40 bg-rose-400/14',
  cancelled: 'text-slate-300 border-slate-400/30 bg-slate-400/10',
};

/**
 * A single-line progress rail pinned under the bar while a task runs.
 *
 * It expands in place to at most ~200px. It is not a sidebar, not a panel, and
 * never a full-screen view - the whole point is that the answer stays legible
 * while Cyps works.
 */
export function TaskStrip({ task, onPause, onResume, onCancel }: TaskStripProps) {
  const [open, setOpen] = useState(false);

  const done = task.steps.filter((step) => step.status === 'done').length;
  const total = task.steps.length;
  const progress = total === 0 ? 0 : (done / total) * 100;
  const activeStep =
    task.steps.find((step) => step.status === 'running') ??
    task.steps.find((step) => step.status === 'pending');
  const live = task.status === 'running' || task.status === 'planning';
  const canResume = task.status === 'paused';

  return (
    <section
      aria-label={`Task: ${task.title}`}
      className="glass animate-slide-down flex w-[460px] flex-col overflow-hidden rounded-[var(--cyps-radius)]"
    >
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-white/8"
      >
        <div
          className="h-full bg-amber-300/80 transition-[width] duration-500 ease-out"
          style={{ width: `${String(progress)}%` }}
        />
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${STATUS_TONE[task.status]}`}
        >
          {live ? (
            <Loader2 size={13} strokeWidth={2.4} className="orb-spin" />
          ) : task.status === 'completed' ? (
            <Check size={13} strokeWidth={2.8} />
          ) : task.status === 'failed' ? (
            <X size={13} strokeWidth={2.8} />
          ) : task.status === 'paused' ? (
            <Pause size={12} strokeWidth={2.6} />
          ) : (
            <CircleSlash size={12} strokeWidth={2.4} />
          )}
        </span>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="no-drag min-w-0 flex-1 text-left"
          title={open ? 'Hide task steps' : 'Show task steps'}
        >
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-[var(--color-ink)]">
              {truncate(task.title, 46)}
            </span>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${STATUS_TONE[task.status]}`}
            >
              {STATUS_LABEL[task.status]}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--color-ink-dim)]">
            <span>
              {done}/{total || '?'} steps
            </span>
            {activeStep ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{truncate(activeStep.title, 40)}</span>
              </>
            ) : null}
          </span>
        </button>

        <span className="sr-only" role="status" aria-live="polite">
          {`Task ${task.title}: ${STATUS_LABEL[task.status]}, ${String(done)} of ${String(total)} steps complete`}
        </span>

        <div className="no-drag flex shrink-0 items-center gap-1">
          {live ? (
            <button
              type="button"
              onClick={onPause}
              aria-label="Pause task"
              title="Pause task"
              className="rounded-full border border-[var(--color-glass-border)] bg-white/8 p-1.5 text-[var(--color-ink-soft)] hover:bg-white/16"
            >
              <Pause size={12} strokeWidth={2.6} aria-hidden="true" />
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-1 text-[10.5px] font-semibold text-emerald-100 hover:bg-emerald-500/32"
            >
              Resume
            </button>
          ) : null}
          {live || canResume ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-rose-400/40 bg-rose-500/18 px-2 py-1 text-[10.5px] font-semibold text-rose-100 hover:bg-rose-500/32"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Hide task steps' : 'Show task steps'}
            className="rounded-full p-1.5 text-[var(--color-ink-dim)] hover:bg-white/10 hover:text-[var(--color-ink)]"
          >
            <ChevronRight
              size={13}
              strokeWidth={2.6}
              aria-hidden="true"
              className="transition-transform duration-[var(--cyps-duration-fast)]"
              style={{ transform: open ? 'rotate(90deg)' : 'none' }}
            />
          </button>
        </div>
      </div>

      {open ? (
        <ol className="selectable max-h-48 overflow-y-auto border-t border-[var(--color-glass-border)] px-2.5 py-2">
          {task.steps.length === 0 ? (
            <li className="py-1 text-[11px] text-[var(--color-ink-dim)]">
              Cyps has not planned any steps yet.
            </li>
          ) : (
            task.steps.map((step) => (
              <li key={step.id}>
                <StepRow step={step} />
              </li>
            ))
          )}
          <li className="pt-1 text-[10px] text-[var(--color-ink-dim)]">
            Started {relativeTime(task.createdAt)}
            {task.endedAt !== undefined ? ` · ended ${relativeTime(task.endedAt)}` : ''}
          </li>
        </ol>
      ) : null}
    </section>
  );
}

function StepRow({ step }: { step: TaskStep }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span aria-hidden="true" className="mt-0.5 text-[var(--color-ink-dim)]">
        {step.status === 'done' ? (
          <Check size={12} strokeWidth={2.8} className="text-emerald-300" />
        ) : step.status === 'running' ? (
          <Loader2 size={12} strokeWidth={2.4} className="orb-spin text-amber-200" />
        ) : step.status === 'failed' ? (
          <X size={12} strokeWidth={2.8} className="text-rose-300" />
        ) : step.status === 'skipped' ? (
          <CircleSlash size={12} strokeWidth={2.4} className="text-slate-400" />
        ) : (
          <CircleDashed size={12} strokeWidth={2.2} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[11.5px] leading-snug ${
            step.status === 'done'
              ? 'text-[var(--color-ink-dim)] line-through decoration-white/25'
              : step.status === 'failed'
                ? 'text-rose-200'
                : 'text-[var(--color-ink-soft)]'
          }`}
        >
          {step.title}
        </span>
        {step.detail !== undefined && step.detail.length > 0 ? (
          <span className="mt-0.5 block truncate text-[10px] text-[var(--color-ink-dim)]" title={step.detail}>
            {step.detail}
          </span>
        ) : null}
        {step.toolName !== undefined ? (
          <code className="mt-0.5 inline-block rounded bg-white/8 px-1 font-mono text-[9.5px] text-[var(--color-ink-dim)]">
            {step.toolName}
          </code>
        ) : null}
      </span>
      <span className="shrink-0 text-[9.5px] text-[var(--color-ink-dim)]">
        {step.startedAt !== undefined ? relativeTime(step.startedAt) : ''}
      </span>
    </div>
  );
}
