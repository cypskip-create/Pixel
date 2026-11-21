import { randomUUID } from 'node:crypto';
import type { Database } from '../data/database';
import type { SkillDefinition } from '../skills/schema';
import { routineIncompatibility } from '../skills/plan';
import { SkillStore } from '../skills/store';
import { redactTaskText } from '../tasks/schema';

export interface LocalRoutine {
  id: string;
  projectId: string;
  skillId: string;
  name: string;
  localTime: string;
  timezone: string;
  enabled: boolean;
  retryPolicy: 'manual';
  missedRunPolicy: 'skip';
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  skillId: string;
  scheduledKey: string;
  startedAt: number;
  endedAt: number | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'missed' | 'denied';
  taskId: string | null;
  summary: string | null;
  failure: string | null;
}

export class RoutineStore {
  constructor(private readonly db: Database, private readonly skills: SkillStore) {}

  create(input: { projectId: string; skillId: string; name: string; localTime: string; timezone: string }): LocalRoutine {
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 100) {
      throw new Error('Routine name must contain 1 to 100 characters.');
    }
    if (typeof input.skillId !== 'string' || input.skillId.length > 100) {
      throw new Error('Routine skill id is invalid.');
    }
    const skill = this.skills.getActive(input.skillId);
    if (!skill || skill.projectId !== input.projectId) {
      throw new Error('A routine must reference an active skill in the same project.');
    }
    const incompatibility = routineIncompatibility(skill);
    if (incompatibility) throw new Error(incompatibility);
    validateSchedule(input.localTime, input.timezone);
    const now = Date.now();
    const routine: LocalRoutine = {
      id: `routine_${randomUUID().slice(0, 12)}`,
      ...input,
      enabled: true,
      retryPolicy: 'manual',
      missedRunPolicy: 'skip',
      createdAt: now,
      updatedAt: now,
    };
    this.db.execute(
      `INSERT INTO routines (id, project_id, skill_id, name, local_time, timezone, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [routine.id, routine.projectId, routine.skillId, routine.name, routine.localTime,
        routine.timezone, now, now],
    );
    return this.get(routine.id) ?? (() => { throw new Error('Routine failed read-back.'); })();
  }

  get(id: string): LocalRoutine | null {
    const row = this.db.queryOne<RoutineRow>('SELECT * FROM routines WHERE id = ?', [id]);
    return row ? fromRoutineRow(row) : null;
  }

  list(projectId: string): LocalRoutine[] {
    return this.db.query<RoutineRow>(
      'SELECT * FROM routines WHERE project_id = ? ORDER BY local_time, name', [projectId],
    ).map(fromRoutineRow);
  }

  enabled(): LocalRoutine[] {
    return this.db.query<RoutineRow>('SELECT * FROM routines WHERE enabled = 1 ORDER BY local_time').map(fromRoutineRow);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (typeof enabled !== 'boolean') return false;
    return this.db.execute('UPDATE routines SET enabled = ?, updated_at = ? WHERE id = ?', [
      enabled ? 1 : 0, Date.now(), id,
    ]) === 1;
  }

  delete(id: string): boolean {
    return this.db.execute('DELETE FROM routines WHERE id = ?', [id]) === 1;
  }

  history(routineId: string, limit = 50): RoutineRun[] {
    const bounded = Math.max(1, Math.min(200, Math.floor(limit)));
    return this.db.query<RoutineRunRow>(
      'SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?',
      [routineId, bounded],
    ).map(fromRunRow);
  }

  /** Mark work interrupted by process exit. Old runs are never replayed. */
  recoverInterrupted(now = Date.now()): number {
    return this.db.execute(
      `UPDATE routine_runs SET status = 'cancelled', ended_at = ?,
         failure = 'Pixel closed before the local routine finished; it was not replayed.'
       WHERE status = 'running'`, [now],
    );
  }

  claim(routine: LocalRoutine, scheduledKey: string, now: number): string | null {
    const skill = this.skills.getActive(routine.skillId);
    if (!skill || skill.projectId !== routine.projectId) return null;
    const id = `routinerun_${randomUUID().slice(0, 12)}`;
    const inserted = this.db.execute(
      `INSERT OR IGNORE INTO routine_runs
        (id, routine_id, skill_id, scheduled_key, started_at, status)
       VALUES (?, ?, ?, ?, ?, 'running')`,
      [id, routine.id, routine.skillId, scheduledKey, now],
    );
    return inserted === 1 ? id : null;
  }

  markMissed(routine: LocalRoutine, scheduledKey: string, now: number): boolean {
    const id = `routinerun_${randomUUID().slice(0, 12)}`;
    return this.db.execute(
      `INSERT OR IGNORE INTO routine_runs
        (id, routine_id, skill_id, scheduled_key, started_at, ended_at, status, failure)
       VALUES (?, ?, ?, ?, ?, ?, 'missed', 'Pixel was closed or asleep at the scheduled time; missed work is skipped.')`,
      [id, routine.id, routine.skillId, scheduledKey, now, now],
    ) === 1;
  }

  finish(id: string, outcome: { status: 'completed' | 'failed' | 'cancelled' | 'missed' | 'denied'; taskId?: string; summary?: string; failure?: string }, now = Date.now()): void {
    this.db.execute(
      `UPDATE routine_runs SET ended_at = ?, status = ?, task_id = ?, summary = ?, failure = ?
       WHERE id = ? AND status = 'running'`,
      [now, outcome.status, outcome.taskId ?? null, clip(outcome.summary), clip(outcome.failure), id],
    );
    if (outcome.status === 'failed' || outcome.status === 'denied') {
      const row = this.db.queryOne<{ routine_id: string }>('SELECT routine_id FROM routine_runs WHERE id = ?', [id]);
      if (row) this.setEnabled(String(row.routine_id), false);
    }
  }
}

export interface RoutineExecutionResult {
  status: 'completed' | 'failed' | 'cancelled' | 'denied';
  taskId?: string;
  summary?: string;
  failure?: string;
}

export type RoutineExecutor = (
  routine: LocalRoutine,
  skill: SkillDefinition,
  scheduledKey: string,
  signal: AbortSignal,
) => Promise<RoutineExecutionResult>;

/**
 * A small local scheduler. It runs only while Pixel's main process is alive,
 * claims each local calendar occurrence with a SQLite uniqueness constraint,
 * and records missed occurrences instead of running them late after a restart.
 */
export class LocalRoutineScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private stopped = false;
  private draining = false;
  private readonly active = new Map<string, AbortController>();
  private readonly queue: Array<{ runId: string; routine: LocalRoutine; occurrence: string; manual: boolean }> = [];

  constructor(
    private readonly store: RoutineStore,
    private readonly skills: SkillStore,
    private readonly execute: RoutineExecutor,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly canRun: () => boolean = () => true,
  ) {}

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.stopped = false;
    this.store.recoverInterrupted(this.now());
    void this.tick();
    this.timer = setInterval(() => void this.tick(), Math.max(5_000, intervalMs));
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const routine of this.store.enabled()) {
        const local = localScheduleTime(now, routine.timezone);
        const currentMinute = `${local.hour}:${local.minute}`;
        const occurrence = `${local.date}T${routine.localTime}@${routine.timezone}`;
        if (currentMinute === routine.localTime) {
          if (!this.canRun()) {
            this.store.markMissed(routine, occurrence, now);
            continue;
          }
          const runId = this.store.claim(routine, occurrence, now);
          if (runId) this.queue.push({ runId, routine, occurrence, manual: false });
        } else if (currentMinute > routine.localTime) {
          this.store.markMissed(routine, occurrence, now);
        }
      }
      void this.drainQueue();
    } catch (error) {
      this.onError(error);
    } finally {
      this.ticking = false;
    }
  }

  cancel(routineId: string): boolean {
    const controller = this.active.get(routineId);
    if (controller) {
      controller.abort();
      return true;
    }
    const queued = this.queue.filter((item) => item.routine.id === routineId);
    if (queued.length === 0) return false;
    for (const item of queued) {
      this.store.finish(item.runId, { status: 'cancelled', failure: 'Routine was cancelled before it started.' });
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.routine.id === routineId) this.queue.splice(index, 1);
    }
    return true;
  }

  /** Run a single user-requested retry now; it never re-enables future runs. */
  retry(routineId: string): boolean {
    if (this.stopped || !this.canRun()) return false;
    const routine = this.store.get(routineId);
    if (!routine) return false;
    const occurrence = `manual:${this.now()}:${randomUUID().slice(0, 8)}`;
    const runId = this.store.claim(routine, occurrence, this.now());
    if (!runId) return false;
    this.queue.push({ runId, routine, occurrence, manual: true });
    void this.drainQueue();
    return true;
  }

  cancelAll(): number {
    let count = 0;
    for (const controller of this.active.values()) {
      controller.abort();
      count += 1;
    }
    for (const item of this.queue) {
      this.store.finish(item.runId, { status: 'cancelled', failure: 'Routine was cancelled before it started.' });
      count += 1;
    }
    this.queue.length = 0;
    return count;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    this.cancelAll();
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.stopped && this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        const current = this.store.get(item.routine.id);
        if (!current || (!current.enabled && !item.manual)) {
          this.store.finish(item.runId, { status: 'cancelled', failure: 'Routine was paused before execution.' });
          continue;
        }
        if (!this.canRun()) {
          this.store.finish(item.runId, { status: 'missed', failure: 'Emergency stop was active at the scheduled time.' });
          continue;
        }
        await this.executeClaimed(item.runId, item.routine, item.occurrence);
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.draining = false;
      if (!this.stopped && this.queue.length > 0) void this.drainQueue();
    }
  }

  private async executeClaimed(runId: string, routine: LocalRoutine, occurrence: string): Promise<void> {
    const controller = new AbortController();
    this.active.set(routine.id, controller);
    try {
      const skill = this.skills.getActive(routine.skillId);
      if (!skill || skill.projectId !== routine.projectId) {
        this.store.finish(runId, { status: 'denied', failure: 'The reviewed skill is no longer available in this project.' });
        return;
      }
      const result = await this.execute(routine, skill, occurrence, controller.signal);
      this.store.finish(runId, result);
    } catch (error) {
      this.onError(error);
      this.store.finish(runId, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        failure: error instanceof Error ? error.message : 'Routine execution failed.',
      });
    } finally {
      if (this.active.get(routine.id) === controller) this.active.delete(routine.id);
    }
  }
}

function validateSchedule(localTime: string, timezone: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error('Routine time must use 24-hour HH:mm format.');
  if (typeof timezone !== 'string' || timezone.trim().length === 0 || timezone.length > 100) {
    throw new Error('Routine timezone must be a valid IANA time zone.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('Routine timezone must be a valid IANA time zone.');
  }
}

function localScheduleTime(timestamp: number, timezone: string): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: value('hour'),
    minute: value('minute'),
  };
}

function fromRoutineRow(row: RoutineRow): LocalRoutine {
  return {
    id: String(row.id), projectId: String(row.project_id), skillId: String(row.skill_id),
    name: String(row.name), localTime: String(row.local_time), timezone: String(row.timezone),
    enabled: Number(row.enabled) === 1, retryPolicy: 'manual', missedRunPolicy: 'skip',
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function fromRunRow(row: RoutineRunRow): RoutineRun {
  return {
    id: String(row.id), routineId: String(row.routine_id), skillId: String(row.skill_id),
    scheduledKey: String(row.scheduled_key), startedAt: Number(row.started_at),
    endedAt: row.ended_at === null ? null : Number(row.ended_at),
    status: row.status as RoutineRun['status'],
    taskId: row.task_id === null ? null : String(row.task_id),
    summary: row.summary === null ? null : String(row.summary),
    failure: row.failure === null ? null : String(row.failure),
  };
}

function clip(value: string | undefined): string | null {
  return value ? redactTaskText(value.replace(/\s+/g, ' ')).slice(0, 1_000) : null;
}


interface RoutineRow {
  id: string; project_id: string; skill_id: string; name: string; local_time: string;
  timezone: string; enabled: number; created_at: number; updated_at: number;
}

interface RoutineRunRow {
  id: string; routine_id: string; skill_id: string; scheduled_key: string; started_at: number;
  ended_at: number | null; status: string; task_id: string | null; summary: string | null; failure: string | null;
}
