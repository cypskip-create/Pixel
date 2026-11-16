import type { TaskRecord } from '../../shared/types';
import type { Database } from '../data/database';
import { TaskRecordSchema, redactTaskText } from './schema';

export interface TaskPersistence {
  load(limit?: number): TaskRecord[];
  save(task: TaskRecord): void;
}

/** Durable task snapshots and a compact append-only transition history. */
export class TaskStore implements TaskPersistence {
  constructor(private readonly database: Database) {}

  load(limit = 100): TaskRecord[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.database.query<{ payload: string | null }>(
      `SELECT payload FROM tasks
       WHERE payload IS NOT NULL
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ?`,
      [boundedLimit],
    );
    const tasks: TaskRecord[] = [];
    for (const row of rows) {
      if (typeof row.payload !== 'string') continue;
      try {
        const parsed: unknown = JSON.parse(row.payload);
        const result = TaskRecordSchema.safeParse(parsed);
        if (result.success) tasks.push(result.data as TaskRecord);
      } catch {
        // One corrupt task must not prevent recovery of the others.
      }
    }
    return tasks;
  }

  save(task: TaskRecord): void {
    const safe = sanitizeTask(task);
    const parsed = TaskRecordSchema.safeParse(safe);
    if (!parsed.success) {
      throw new Error(`Refusing to persist an invalid task record: ${parsed.error.issues[0]?.path.join('.') ?? 'unknown field'}`);
    }

    const payload = JSON.stringify(parsed.data);
    const previous = this.database.queryOne<{ status: string; payload: string | null }>(
      'SELECT status, payload FROM tasks WHERE id = ?',
      [task.id],
    );
    const event = classifyChange(previous, parsed.data as TaskRecord);
    const updatedAt = task.updatedAt ?? Date.now();

    this.database.transaction(() => {
      this.database.execute(
        `INSERT INTO tasks (id, project_id, title, status, created_at, ended_at, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           title = excluded.title,
           status = excluded.status,
           ended_at = excluded.ended_at,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        [
          safe.id,
          safe.projectId ?? null,
          safe.title,
          safe.status,
          safe.createdAt,
          safe.endedAt ?? null,
          payload,
          updatedAt,
        ],
      );
      this.database.execute(
        `INSERT INTO task_events (task_id, at, event_type, status, summary)
         VALUES (?, ?, ?, ?, ?)`,
        [safe.id, updatedAt, event.type, safe.status, event.summary],
      );
    });
  }

  events(taskId: string, limit = 100): Array<{
    at: number;
    eventType: string;
    status: string;
    summary: string;
  }> {
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.database.query<{
      at: number;
      event_type: string;
      status: string;
      summary: string;
    }>(
      `SELECT at, event_type, status, summary FROM task_events
       WHERE task_id = ? ORDER BY at DESC, id DESC LIMIT ?`,
      [taskId, boundedLimit],
    ).map((row) => ({
      at: Number(row.at),
      eventType: row.event_type,
      status: row.status,
      summary: row.summary,
    }));
  }
}

function sanitizeTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    title: redactTaskText(task.title),
    ...(task.request === undefined ? {} : { request: redactTaskText(task.request) }),
    ...(task.result === undefined ? {} : { result: redactTaskText(task.result) }),
    steps: task.steps.map((step) => ({
      ...step,
      title: redactTaskText(step.title),
      ...(step.detail === undefined ? {} : { detail: redactTaskText(step.detail) }),
      ...(step.args === undefined ? {} : { args: sanitizeArguments(step.toolName, step.args) }),
    })),
    ...(task.recoveryNote === undefined ? {} : { recoveryNote: redactTaskText(task.recoveryNote) }),
    ...(task.checkpoint === undefined
      ? {}
      : { checkpoint: { ...task.checkpoint, summary: redactTaskText(task.checkpoint.summary) } }),
    ...(task.evidence === undefined
      ? {}
      : {
          evidence: task.evidence.map((item) => ({
            ...item,
            summary: redactTaskText(item.summary).slice(0, 2_000),
            source: redactTaskText(item.source).slice(0, 300),
          })),
        }),
  };
}

function sanitizeArguments(name: string | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const sensitiveKey = /(password|passwd|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|cvv|otp)/i;
  for (const [key, value] of Object.entries(args)) {
    if (sensitiveKey.test(key)) safe[key] = '[redacted]';
    else if ((name === 'type_text' || name === 'browser_type') && key === 'text') safe[key] = '[not stored]';
    else if (name === 'file_write' && key === 'content') safe[key] = '[not stored]';
    else if (typeof value === 'string') safe[key] = redactTaskText(value).slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value;
    else safe[key] = '[value]';
  }
  return safe;
}

function classifyChange(
  previous: { status: string; payload: string | null } | null,
  next: TaskRecord,
): { type: string; summary: string } {
  if (!previous) return { type: 'created', summary: 'Task created.' };
  if (previous.status !== next.status) {
    return { type: 'status', summary: `Task state changed to ${next.status}.` };
  }
  if (previous.payload) {
    try {
      const oldTask = JSON.parse(previous.payload) as TaskRecord;
      if (oldTask.steps.length !== next.steps.length) {
        return { type: 'step', summary: 'A task step was added.' };
      }
      for (let index = 0; index < next.steps.length; index += 1) {
        if (oldTask.steps[index]?.status !== next.steps[index]?.status) {
          return { type: 'step', summary: `Step ${String(index + 1)} changed state.` };
        }
      }
    } catch {
      return { type: 'snapshot', summary: 'Task checkpoint updated.' };
    }
  }
  return { type: 'checkpoint', summary: 'Task checkpoint updated.' };
}
