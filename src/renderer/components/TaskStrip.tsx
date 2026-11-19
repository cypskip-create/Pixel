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
import { countVerifiedSteps, taskDisplayState } from '@/lib/task-presentation';

interface TaskStripProps {
  task: TaskRecord;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onContinue: () => void;
  compact?: boolean;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  planning: 'Planning',
  running: 'Running',
  pause_requested: 'Pausing',
  awaiting_approval: 'Needs your OK',
  awaiting_user: 'Your turn',
  paused: 'Paused',
  blocked: 'Needs verification',
  cancelling: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<TaskStatus, string> = {
  planning: 'text-neutral-200 border-neutral-400/35 bg-neutral-400/12',
  running: 'text-neutral-100 border-neutral-400/35 bg-neutral-400/12',
  pause_requested: 'text-neutral-100 border-neutral-400/35 bg-neutral-400/12',
  awaiting_approval: 'text-neutral-100 border-neutral-400/45 bg-neutral-400/18',
  awaiting_user: 'text-neutral-100 border-neutral-300/45 bg-neutral-400/14',
  paused: 'text-slate-200 border-slate-400/35 bg-slate-400/12',
  blocked: 'text-neutral-100 border-neutral-400/40 bg-neutral-400/14',
  cancelling: 'text-neutral-100 border-neutral-400/35 bg-neutral-400/12',
  completed: 'text-neutral-100 border-neutral-400/35 bg-neutral-400/12',
  failed: 'text-neutral-100 border-neutral-400/40 bg-neutral-400/14',
  cancelled: 'text-slate-300 border-slate-400/30 bg-slate-400/10',
};

/**
 * A single-line progress rail pinned under the bar while a task runs.
 *
 * It expands in place to at most ~200px. It is not a sidebar, not a panel, and
 * never a full-screen view - the whole point is that the answer stays legible
 * while Pixel works.
 */
export function TaskStrip({ task, onPause, onResume, onCancel, onContinue, compact = false }: TaskStripProps) {
  const [open, setOpen] = useState(false);

  const displayState = taskDisplayState(task);
  const done = countVerifiedSteps(task);
  const total = task.steps.length;
  const progress = total === 0 ? 0 : (done / total) * 100;
  const activeStep =
    task.steps.find((step) => step.status === 'running') ??
    task.steps.find((step) => step.status === 'pending');
  const live = ['running', 'planning', 'pause_requested', 'awaiting_approval', 'cancelling'].includes(task.status);
  const canPause = ['running', 'planning', 'awaiting_approval'].includes(task.status);
  const canResume = task.status === 'paused' && !task.recoveryNote;
  const canCancel = live || task.status === 'awaiting_user' || task.status === 'paused' || task.status === 'blocked';

  return (
    <section
      aria-label={`Task: ${task.title}`}
      data-layout-panel
      className={`pixel-surface animate-slide-down flex ${compact ? 'w-full' : 'w-[460px]'} flex-col overflow-hidden rounded-[var(--cyps-radius)]`}
    >
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-white/8"
      >
        <div
          className="h-full bg-neutral-300/80 transition-[width] duration-500 ease-out"
          style={{ width: `${String(progress)}%` }}
        />
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2">
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${STATUS_TONE[displayState.tone]}`}
        >
          {live ? (
            <Loader2 size={13} strokeWidth={2.4} className="orb-spin" />
          ) : task.status === 'completed' && !displayState.verificationPending ? (
            <Check size={13} strokeWidth={2.8} />
          ) : displayState.verificationPending ? (
            <CircleDashed size={13} strokeWidth={2.4} />
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
              className={`shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide ${STATUS_TONE[displayState.tone]}`}
            >
              {displayState.verificationPending ? displayState.label : STATUS_LABEL[task.status]}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--color-ink-dim)]">
            <span>
              {done}/{total || '?'} {displayState.verificationPending ? 'verified' : 'steps'}
            </span>
            {activeStep ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{truncate(activeStep.title, 40)}</span>
              </>
            ) : null}
          </span>
          {task.recoveryNote ? (
            <span className="mt-0.5 block truncate text-[10px] text-neutral-100/85" title={task.recoveryNote}>
              Interrupted after restart. Review the last step before continuing.
            </span>
          ) : null}
          {task.status === 'awaiting_user' && task.handoffReason ? (
            <span className="mt-0.5 block truncate text-[10px] text-neutral-100/85" title={task.handoffReason}>
              {task.handoffReason}
            </span>
          ) : null}
        </button>

        <span className="sr-only" role="status" aria-live="polite">
          {`Task ${task.title}: ${displayState.verificationPending ? displayState.label : STATUS_LABEL[task.status]}, ${String(done)} of ${String(total)} ${displayState.verificationPending ? 'steps verified' : 'steps complete'}`}
        </span>

        <div className="no-drag flex shrink-0 items-center gap-1">
          {canPause ? (
            <button
              type="button"
              onClick={onPause}
              aria-label="Pause task"
              title="Pause task"
              className="rounded-full border border-[var(--color-border)] bg-white/8 p-1.5 text-[var(--color-ink-soft)] hover:bg-white/16"
            >
              <Pause size={12} strokeWidth={2.6} aria-hidden="true" />
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={onResume}
              className="rounded-full border border-neutral-400/40 bg-neutral-500/20 px-2 py-1 text-[10.5px] font-semibold text-neutral-100 hover:bg-neutral-500/32"
            >
              Resume
            </button>
          ) : null}
          {task.status === 'awaiting_user' ? (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full border border-neutral-300/40 bg-neutral-400/18 px-2 py-1 text-[10px] font-semibold text-neutral-100 hover:bg-neutral-400/28"
            >
              Recheck and continue
            </button>
          ) : null}
          {canCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-neutral-400/40 bg-neutral-500/18 px-2 py-1 text-[10.5px] font-semibold text-neutral-100 hover:bg-neutral-500/32"
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
        <ol className="selectable max-h-48 overflow-y-auto border-t border-[var(--color-border)] px-2.5 py-2">
          {task.steps.length === 0 ? (
            <li className="py-1 text-[11px] text-[var(--color-ink-dim)]">
              Pixel has not planned any steps yet.
            </li>
          ) : (
            task.steps.map((step) => (
              <li key={step.id}>
                <StepRow
                  step={step}
                  verificationPending={(task.pendingVerifications ?? []).some((item) => item.stepId === step.id)}
                />
              </li>
            ))
          )}
          <li className="pt-1 text-[10px] text-[var(--color-ink-dim)]">
            Started {relativeTime(task.createdAt)}
            {task.endedAt !== undefined ? ` · ended ${relativeTime(task.endedAt)}` : ''}
          </li>
          {task.result ? (
            <li className="pt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-soft)]" title={task.result}>
              {truncate(task.result, 320)}
            </li>
          ) : null}
          {displayState.verificationPending ? (
            <li className="pt-1 text-[10.5px] leading-relaxed text-neutral-100/90">
              The action finished, but its postcondition still needs verification.
            </li>
          ) : null}
        </ol>
      ) : null}
    </section>
  );
}

function StepRow({ step, verificationPending }: { step: TaskStep; verificationPending: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span aria-hidden="true" className="mt-0.5 text-[var(--color-ink-dim)]">
        {verificationPending ? (
          <CircleDashed size={12} strokeWidth={2.2} className="text-neutral-200" />
        ) : step.status === 'done' || step.status === 'verified' ? (
          <Check size={12} strokeWidth={2.8} className={step.status === 'verified' ? 'text-neutral-300' : 'text-neutral-200'} />
        ) : step.status === 'running' ? (
          <Loader2 size={12} strokeWidth={2.4} className="orb-spin text-neutral-200" />
        ) : step.status === 'failed' ? (
          <X size={12} strokeWidth={2.8} className="text-neutral-300" />
        ) : step.status === 'skipped' ? (
          <CircleSlash size={12} strokeWidth={2.4} className="text-slate-400" />
        ) : (
          <CircleDashed size={12} strokeWidth={2.2} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[11.5px] leading-snug ${
            verificationPending
              ? 'text-neutral-100'
              : step.status === 'verified'
              ? 'text-neutral-100'
              : step.status === 'done'
              ? 'text-[var(--color-ink-dim)] line-through decoration-white/25'
              : step.status === 'failed'
                ? 'text-neutral-200'
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
        {verificationPending ? (
          <span className="mt-0.5 block text-[9.5px] font-medium text-neutral-200/90">Awaiting postcondition verification</span>
        ) : null}
        {step.status === 'verified' ? (
          <span className="mt-0.5 block text-[9.5px] font-medium text-neutral-200/85">Verified</span>
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
