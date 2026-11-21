import type { AuditEntry, TaskRecord } from '@shared/types';
import { taskDisplayState } from '@/lib/task-presentation';

interface WorkspaceTasksProps {
  tasks: TaskRecord[];
  audit: AuditEntry[];
  onAction: (action: 'pause' | 'resume' | 'cancel', id: string) => void;
  onContinue: (id: string) => void;
  onRecord: (id: string) => void;
}

export function WorkspaceTasks({ tasks, audit, onAction, onContinue, onRecord }: WorkspaceTasksProps): React.JSX.Element {
  const active = tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status));
  const finished = tasks.filter((task) => ['completed', 'failed', 'cancelled'].includes(task.status));
  return <section className="workspace-page">
    <div className="workspace-page-heading"><h1>Tasks & Activity</h1><p>Task outcomes and audit activity.</p></div>
    {active.length ? <><h2 className="workspace-section-title">Active and waiting</h2><div className="workspace-task-grid">{active.map((task) => {
      const display = taskDisplayState(task);
      return <article className="workspace-task-card" key={task.id}>
        <header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status.replaceAll('_', ' ')}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header>
        <h3>{task.title}</h3>{task.request ? <p className="workspace-task-request">{task.request}</p> : null}
        <div className="workspace-task-steps">{task.steps.map((step) => <div key={step.id}><span className={`workspace-step-dot step-${step.status}`} /><span>{step.title}</span>{step.detail ? <small>{step.detail}</small> : null}</div>)}</div>
        {task.result ? <p className="workspace-task-result">{task.result}</p> : null}
        <footer>{task.status === 'running' || task.status === 'planning' ? <button type="button" onClick={() => onAction('pause', task.id)}>Pause</button> : null}{task.status === 'paused' ? <button type="button" onClick={() => onAction('resume', task.id)}>Resume</button> : null}{task.reobserveRequired ? <button type="button" onClick={() => onContinue(task.id)}>Continue after review</button> : null}{!['completed', 'failed', 'cancelled'].includes(task.status) ? <button className="danger" type="button" onClick={() => onAction('cancel', task.id)}>Cancel</button> : null}</footer>
      </article>;
    })}</div></> : <div className="workspace-empty-card">No active tasks.</div>}
    {finished.length ? <><h2 className="workspace-section-title mt-6">Recent outcomes</h2><div className="workspace-task-grid">{finished.slice(0, 12).map((task) => {
      const display = taskDisplayState(task);
      const canRecord = task.status === 'completed' && !task.reobserveRequired
        && !display.verificationPending && task.steps.length > 0;
      return <article className="workspace-task-card" key={task.id}>
        <header><span className={`workspace-task-status status-${display.tone}`}>{display.verificationPending ? display.label : task.status}</span><time>{new Date(task.updatedAt ?? task.createdAt).toLocaleString()}</time></header>
        <h3>{task.title}</h3>
        {display.verificationPending ? <p className="workspace-task-result">The action finished, but its postcondition still needs verification.</p> : task.result ? <p className="workspace-task-result">{task.result}</p> : <p className="text-[12px] text-[var(--color-ink-dim)]">No saved result.</p>}
        {canRecord ? <button type="button" onClick={() => onRecord(task.id)}>Save steps as a skill draft…</button> : null}
      </article>;
    })}</div></> : null}
    <h2 className="workspace-section-title mt-6">Audit activity</h2><div className="workspace-audit-list">{audit.slice(0, 30).map((entry) => <article key={entry.id}><span className={`audit-outcome outcome-${entry.outcome}`} /><div><p>{entry.summary}</p>{entry.detail ? <small>{entry.detail}</small> : null}</div><time>{new Date(entry.at).toLocaleTimeString()}</time></article>)}</div>
  </section>;
}
