import { useEffect, useState } from 'react';
import type { AuditEntry, TaskRecord } from '@shared/types';
import { taskDisplayState } from '@/lib/task-presentation';

interface WorkspaceTasksProps {
  tasks: TaskRecord[];
  audit: AuditEntry[];
  projectName?: string;
  onAction: (action: 'pause' | 'resume' | 'cancel', id: string) => void;
  onContinue: (id: string) => void;
  onRecord: (id: string) => void;
}

const ACTIVE_OR_ATTENTION_STATUSES = new Set<string>([
  'running',
  'planning',
  'queued',
  'awaiting_approval',
  'waiting_input',
  'paused',
  'scheduled',
  'recovering',
  'blocked',
  'failed',
]);

function formatElapsed(createdAt: number, finishedAt: number | undefined, now: number): string {
  const end = finishedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rem}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function WorkspaceTasks({ tasks, audit, projectName, onAction, onContinue, onRecord }: WorkspaceTasksProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const runningTasks = tasks.filter((task) => ACTIVE_OR_ATTENTION_STATUSES.has(task.status));
  const historyTasks = tasks.filter((task) => !ACTIVE_OR_ATTENTION_STATUSES.has(task.status));
  const hasLiveExecution = runningTasks.some((task) => task.status === 'running' || task.status === 'planning' || task.status === 'recovering');
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const childCountByParent = new Map<string, number>();
  for (const task of tasks) {
    if (task.parentTaskId) {
      childCountByParent.set(task.parentTaskId, (childCountByParent.get(task.parentTaskId) ?? 0) + 1);
    }
  }

  useEffect(() => {
    if (!hasLiveExecution) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveExecution]);

  return (
    <section className="workspace-page" aria-label="Running Tasks">
      <div className="workspace-page-heading">
        <h1>Running Tasks</h1>
        <p>Active, queued, scheduled, recovering, paused, and failed tasks requiring attention.</p>
      </div>

      {runningTasks.length ? (
        <div className="workspace-task-grid">
          {runningTasks.map((task) => {
            const display = taskDisplayState(task);
            const currentStep = [...task.steps].reverse().find((step) => step.status === 'running' || step.status === 'failed' || step.status === 'done' || step.status === 'verified');
            const isTerminalFailed = task.status === 'failed';
            const canPause = task.status === 'running' || task.status === 'planning';
            const canResume = task.status === 'paused' && (!task.recoveryNote || task.safeToResume === true);
            const canCancel = !isTerminalFailed && task.status !== 'completed' && task.status !== 'cancelled';
            const parentTask = task.parentTaskId ? taskById.get(task.parentTaskId) : undefined;
            const childCount = childCountByParent.get(task.id) ?? 0;
            const scopeLabel = task.executionScope === 'desktop_session' ? 'Desktop session' : 'Headless';

            return (
              <article className="workspace-task-card" key={task.id} data-task-id={task.id} data-execution-scope={task.executionScope ?? 'headless'}>
                <header>
                  <span className={`workspace-task-status status-${display.tone}`}>
                    {display.verificationPending ? display.label : task.status.replaceAll('_', ' ')}
                  </span>
                  <span className="text-[10.5px] text-[var(--color-ink-dim)]">
                    {scopeLabel}
                    {task.specialistId ? ` · ${task.specialistId}` : ''}
                    {task.routineId ? ' · scheduled' : ''}
                    {childCount > 0 ? ` · ${childCount} ${childCount === 1 ? 'subtask' : 'subtasks'}` : ''}
                  </span>
                  <time title={new Date(task.createdAt).toLocaleString()}>
                    {formatElapsed(task.createdAt, task.endedAt, now)}
                  </time>
                </header>
                <h3>{task.title}</h3>
                {projectName ? <p className="text-[11px] text-[var(--color-ink-dim)]">Project: {projectName}</p> : null}
                {parentTask ? (
                  <p className="text-[11px] text-[var(--color-ink-dim)]">Subtask of: {parentTask.title}</p>
                ) : null}
                {task.request ? <p className="workspace-task-request">{task.request}</p> : null}
                {task.recoveryNote ? (
                  <p className="text-[11px] text-[var(--color-warning)]" role="status">{task.recoveryNote}</p>
                ) : null}
                {currentStep ? (
                  <p className="text-[11px] text-[var(--color-ink-soft)]">
                    Current step: <strong>{currentStep.title}</strong>
                  </p>
                ) : null}
                <div className="workspace-task-steps">
                  {task.steps.map((step) => (
                    <div key={step.id}>
                      <span className={`workspace-step-dot step-${step.status}`} />
                      <span>{step.title}</span>
                      {step.detail ? <small>{step.detail}</small> : null}
                    </div>
                  ))}
                </div>
                {task.result ? <p className="workspace-task-result">{task.result}</p> : null}
                <footer>
                  {canPause ? <button type="button" onClick={() => onAction('pause', task.id)}>Pause</button> : null}
                  {canResume ? <button type="button" onClick={() => onAction('resume', task.id)}>Resume</button> : null}
                  {task.reobserveRequired ? <button type="button" onClick={() => onContinue(task.id)}>Continue after review</button> : null}
                  {canCancel ? <button className="danger" type="button" onClick={() => onAction('cancel', task.id)}>Cancel</button> : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="workspace-empty-card">No running tasks right now. Completed tasks move automatically to task history below.</div>
      )}

      {historyTasks.length ? (
        <details className="mt-6">
          <summary className="workspace-section-title cursor-pointer">Task History ({historyTasks.length})</summary>
          <div className="workspace-task-grid mt-3">
            {historyTasks.slice(0, 16).map((task) => {
              const display = taskDisplayState(task);
              const canRecord = task.status === 'completed' && !task.reobserveRequired
                && !display.verificationPending && task.steps.length > 0;
              return (
                <article className="workspace-task-card" key={task.id}>
                  <header>
                    <span className={`workspace-task-status status-${display.tone}`}>
                      {display.verificationPending ? display.label : task.status}
                    </span>
                    <time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time>
                  </header>
                  <h3>{task.title}</h3>
                  {display.verificationPending ? (
                    <p className="workspace-task-result">The action finished, but its postcondition still needs verification.</p>
                  ) : task.result ? (
                    <p className="workspace-task-result">{task.result}</p>
                  ) : (
                    <p className="text-[12px] text-[var(--color-ink-dim)]">No saved result.</p>
                  )}
                  {canRecord ? <button type="button" onClick={() => onRecord(task.id)}>Save steps as a skill draft…</button> : null}
                </article>
              );
            })}
          </div>
        </details>
      ) : null}

      {audit.length ? (
        <details className="mt-6">
          <summary className="workspace-section-title cursor-pointer">Audit Activity ({audit.length})</summary>
          <div className="workspace-audit-list mt-3">
            {audit.slice(0, 30).map((entry) => (
              <article key={entry.id}>
                <span className={`audit-outcome outcome-${entry.outcome}`} />
                <div>
                  <p>{entry.summary}</p>
                  {entry.detail ? <small>{entry.detail}</small> : null}
                </div>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
