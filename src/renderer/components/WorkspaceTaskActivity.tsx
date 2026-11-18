import {
  Activity, Check, CircleDashed, CircleSlash, Loader2, Pause, Play, ShieldCheck, X,
} from 'lucide-react';
import type { TaskRecord, TaskStatus, TaskStep } from '@shared/types';
import { taskDisplayState } from '@/lib/task-presentation';

interface TaskActivityIndicatorProps {
  task: TaskRecord;
  onOpenDetails: () => void;
}

const TASK_LABEL: Record<TaskStatus, string> = {
  planning: 'Planning',
  running: 'Working',
  pause_requested: 'Pausing',
  awaiting_approval: 'Waiting for approval',
  awaiting_user: 'Waiting for you',
  paused: 'Paused',
  blocked: 'Blocked',
  cancelling: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

export function WorkspaceTaskActivity({ task, onOpenDetails }: TaskActivityIndicatorProps) {
  const display = taskDisplayState(task);
  const activeStep = task.steps.find((step) => step.status === 'running')
    ?? task.steps.find((step) => step.status === 'pending');
  const label = display.verificationPending ? 'Awaiting verification' : TASK_LABEL[task.status];

  return (
    <div className="workspace-task-activity" role="status" aria-live="polite" data-task-activity>
      <Activity size={15} aria-hidden="true" />
      <span className={`workspace-task-activity-state status-${display.tone}`}>{label}</span>
      <span className="workspace-task-activity-title">{activeStep?.title ?? task.title}</span>
      <button type="button" className="workspace-task-activity-action" onClick={onOpenDetails}>Details</button>
    </div>
  );
}

interface WorkspaceTaskDetailsProps {
  task: TaskRecord | null;
  onClose: () => void;
  onOpenTasks: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onContinue: (id: string) => void;
}

export function WorkspaceTaskDetails({
  task, onClose, onOpenTasks, onPause, onResume, onCancel, onContinue,
}: WorkspaceTaskDetailsProps) {
  const display = task ? taskDisplayState(task) : null;
  const canPause = task !== null && ['running', 'planning', 'awaiting_approval'].includes(task.status);
  const canResume = task?.status === 'paused' && !task.recoveryNote;
  const canCancel = task !== null && !['completed', 'failed', 'cancelled', 'cancelling'].includes(task.status);
  const canContinue = task?.status === 'awaiting_user' || task?.reobserveRequired === true;

  return (
    <aside className="workspace-context" aria-label="Task details" data-task-details>
      <header className="workspace-context-heading">
        <div>
          <h2>Task details</h2>
          {task ? <p>{display?.verificationPending ? 'Awaiting verification' : TASK_LABEL[task.status]}</p> : null}
        </div>
        <button type="button" aria-label="Close task details" onClick={onClose}><X size={16} /></button>
      </header>

      {task ? (
        <div className="workspace-task-detail-content">
          <div className="workspace-task-detail-title">
            <h3>{task.title}</h3>
            {task.request && task.request !== task.title ? <p>{task.request}</p> : null}
          </div>

          {task.recoveryNote ? <p className="workspace-task-recovery">{task.recoveryNote}</p> : null}
          {task.checkpoint?.summary ? <p className="workspace-task-checkpoint">{task.checkpoint.summary}</p> : null}

          <div className="workspace-task-actions">
            {canPause ? <button type="button" onClick={() => onPause(task.id)}><Pause size={14} /> Pause</button> : null}
            {canResume ? <button type="button" onClick={() => onResume(task.id)}><Play size={14} /> Resume</button> : null}
            {canContinue ? <button type="button" className="is-primary" onClick={() => onContinue(task.id)}>Recheck and continue</button> : null}
            {canCancel ? <button type="button" className="is-danger" onClick={() => onCancel(task.id)}>Cancel</button> : null}
          </div>

          <section className="workspace-task-detail-section" aria-label="Execution steps">
            <h3>Steps</h3>
            {task.steps.length === 0 ? <p className="workspace-task-detail-empty">Steps will appear as Pixel plans the work.</p> : (
              <ol>
                {task.steps.map((step) => (
                  <TaskStepRow
                    key={step.id}
                    step={step}
                    verificationPending={(task.pendingVerifications ?? []).some((item) => item.stepId === step.id)}
                  />
                ))}
              </ol>
            )}
          </section>

          {task.evidence?.length ? (
            <section className="workspace-task-detail-section" aria-label="Task evidence">
              <h3>Evidence</h3>
              <ol className="workspace-task-evidence">
                {task.evidence.map((item) => (
                  <li key={item.id}>
                    <span>{item.summary}</span>
                    <small>{item.source} · {new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {display?.verificationPending ? (
            <p role="status" className="workspace-task-verification">The action finished; the requested result has not been confirmed.</p>
          ) : null}
          {task.result ? <p className="workspace-task-result">{task.result}</p> : null}
        </div>
      ) : (
        <div className="workspace-context-empty">
          <p>No task is active.</p>
          <button type="button" onClick={onOpenTasks}>Open task history</button>
        </div>
      )}
    </aside>
  );
}

function TaskStepRow({ step, verificationPending }: { step: TaskStep; verificationPending: boolean }) {
  const state = verificationPending ? 'Awaiting verification' : STEP_LABEL[step.status];

  return (
    <li className={`workspace-task-detail-step step-${step.status}`}>
      <span className="workspace-task-step-icon" aria-hidden="true">
        {verificationPending ? <CircleDashed size={15} />
          : step.status === 'verified' ? <ShieldCheck size={15} />
            : step.status === 'done' ? <Check size={15} />
              : step.status === 'running' ? <Loader2 size={15} />
                : step.status === 'failed' ? <X size={15} />
                  : step.status === 'skipped' ? <CircleSlash size={15} />
                    : <CircleDashed size={15} />}
      </span>
      <div>
        <span className="workspace-task-step-title">{step.title}</span>
        <span className="workspace-task-step-state">{state}</span>
        {step.detail ? <p>{step.detail}</p> : null}
        {step.toolName ? <code>{step.toolName}</code> : null}
      </div>
    </li>
  );
}

const STEP_LABEL: Record<TaskStep['status'], string> = {
  pending: 'Waiting',
  running: 'Running',
  done: 'Action ran',
  verified: 'Verified',
  failed: 'Failed',
  skipped: 'Skipped',
};
