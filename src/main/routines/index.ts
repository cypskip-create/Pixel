import { randomUUID } from 'node:crypto';
import type { MissedRunPolicy, RoutineScheduleKind, TaskExecutionScope } from '../../shared/types';
import type { Database } from '../data/database';
import type { SkillDefinition } from '../skills/schema';
import { normalizeSkillInputValues, routineIncompatibility } from '../skills/plan';
import { SkillStore } from '../skills/store';
import { redactTaskText } from '../tasks/schema';
import {
  listCronOccurrencesBetween,
  nextCronOccurrence,
  parseCronExpression,
  validateTimezone,
} from './cron';
import { SchedulerLeaseManager } from './lease';

export { parseCronExpression, nextCronOccurrence, listCronOccurrencesBetween, validateTimezone } from './cron';
export { SchedulerLeaseManager } from './lease';

export interface LocalRoutine {
  id: string;
  projectId: string;
  skillId: string;
  name: string;
  localTime: string;
  timezone: string;
  scheduleKind: RoutineScheduleKind;
  cronExpression?: string;
  intervalMs?: number;
  runAt?: number;
  executionScope: TaskExecutionScope;
  /** Main-process only. Values are never returned by routines.list. */
  inputValues: Record<string, string>;
  enabled: boolean;
  retryPolicy: 'manual';
  maxRetries: number;
  missedRunPolicy: MissedRunPolicy;
  catchupWindowMs?: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
}

export type LocalRoutineSummary = Omit<LocalRoutine, 'inputValues'> & { inputNames: string[] };

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

  create(input: {
    projectId: string;
    skillId: string;
    name: string;
    localTime?: string;
    timezone: string;
    scheduleKind?: RoutineScheduleKind;
    cronExpression?: string;
    intervalMs?: number;
    runAt?: number;
    missedRunPolicy?: MissedRunPolicy;
    catchupWindowMs?: number;
    maxRetries?: number;
    executionScope?: TaskExecutionScope;
    inputValues?: Record<string, string>;
  }): LocalRoutine {
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
    const inputValues = normalizeSkillInputValues(skill.inputs, input.inputValues ?? {});

    const scheduleKind: RoutineScheduleKind = input.scheduleKind
      ?? (input.cronExpression ? 'cron' : input.intervalMs ? 'interval' : input.runAt ? 'once' : 'daily');
    const localTime = input.localTime ?? '09:00';
    validateTimezone(input.timezone);

    let cronExpression: string | undefined = input.cronExpression?.trim() || undefined;
    let intervalMs: number | undefined = input.intervalMs;
    let runAt: number | undefined = input.runAt;

    if (scheduleKind === 'daily') {
      validateSchedule(localTime, input.timezone);
    } else if (scheduleKind === 'cron' || scheduleKind === 'weekly') {
      if (!cronExpression) throw new Error('A cron expression is required for cron/weekly schedules.');
      cronExpression = parseCronExpression(cronExpression).expression;
    } else if (scheduleKind === 'interval') {
      if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs < 60_000) {
        throw new Error('Interval schedules must be at least 60,000 ms (1 minute).');
      }
      intervalMs = Math.floor(intervalMs);
    } else if (scheduleKind === 'once') {
      if (typeof runAt !== 'number' || !Number.isFinite(runAt) || runAt <= 0) {
        throw new Error('One-time schedules require a valid runAt timestamp.');
      }
      runAt = Math.floor(runAt);
    }

    const missedRunPolicy: MissedRunPolicy = input.missedRunPolicy ?? 'skip';
    const catchupWindowMs = typeof input.catchupWindowMs === 'number' && input.catchupWindowMs > 0
      ? Math.min(24 * 60 * 60_000, Math.floor(input.catchupWindowMs))
      : undefined;
    const maxRetries = typeof input.maxRetries === 'number' && input.maxRetries >= 0
      ? Math.min(3, Math.floor(input.maxRetries))
      : 0;
    const executionScope: TaskExecutionScope = input.executionScope ?? 'headless';

    const now = Date.now();
    const routine: LocalRoutine = {
      id: `routine_${randomUUID().slice(0, 12)}`,
      projectId: input.projectId,
      skillId: input.skillId,
      name: input.name,
      localTime,
      timezone: input.timezone,
      scheduleKind,
      ...(cronExpression ? { cronExpression } : {}),
      ...(intervalMs ? { intervalMs } : {}),
      ...(runAt ? { runAt } : {}),
      executionScope,
      inputValues,
      enabled: true,
      retryPolicy: 'manual',
      maxRetries,
      missedRunPolicy,
      ...(catchupWindowMs ? { catchupWindowMs } : {}),
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      createdAt: now,
      updatedAt: now,
    };
    routine.nextRunAt = computeNextRunAt(routine, now);

    this.db.execute(
      `INSERT INTO routines (
         id, project_id, skill_id, name, local_time, timezone, enabled, created_at, updated_at, input_values,
         schedule_kind, cron_expression, interval_ms, run_at, missed_run_policy, catchup_window_ms,
         max_retries, execution_scope, next_run_at, last_run_at, last_status
       )
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        routine.id, routine.projectId, routine.skillId, routine.name, routine.localTime,
        routine.timezone, now, now, JSON.stringify(inputValues),
        routine.scheduleKind, routine.cronExpression ?? null, routine.intervalMs ?? null,
        routine.runAt ?? null, routine.missedRunPolicy, routine.catchupWindowMs ?? null,
        routine.maxRetries, routine.executionScope, routine.nextRunAt,
      ],
    );
    return this.get(routine.id) ?? (() => { throw new Error('Routine failed read-back.'); })();
  }

  updateRunTimestamps(id: string, fields: { nextRunAt?: number | null; lastRunAt?: number | null; lastStatus?: string | null }): void {
    const current = this.get(id);
    if (!current) return;
    this.db.execute(
      `UPDATE routines
       SET next_run_at = ?, last_run_at = ?, last_status = ?, updated_at = ?
       WHERE id = ?`,
      [
        fields.nextRunAt !== undefined ? fields.nextRunAt : current.nextRunAt,
        fields.lastRunAt !== undefined ? fields.lastRunAt : current.lastRunAt,
        fields.lastStatus !== undefined ? fields.lastStatus : current.lastStatus,
        Date.now(),
        id,
      ],
    );
  }

  get(id: string): LocalRoutine | null {
    const row = this.db.queryOne<RoutineRow>('SELECT * FROM routines WHERE id = ?', [id]);
    return row ? fromRoutineRow(row) : null;
  }

  list(projectId: string): LocalRoutineSummary[] {
    return this.db.query<RoutineRow>(
      'SELECT * FROM routines WHERE project_id = ? ORDER BY local_time, name', [projectId],
    ).map((row) => this.toSummary(fromRoutineRow(row)));
  }

  toSummary(routine: LocalRoutine): LocalRoutineSummary {
    const { inputValues: _inputValues, ...summary } = routine;
    const skill = this.skills.getActive(routine.skillId);
    return { ...summary, inputNames: skill?.inputs.map((input) => input.name) ?? [] };
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

  markMissed(routine: LocalRoutine, scheduledKey: string, now: number, reason?: string): boolean {
    const id = `routinerun_${randomUUID().slice(0, 12)}`;
    const message = reason ?? 'Pixel was closed or asleep at the scheduled time; missed work is skipped.';
    return this.db.execute(
      `INSERT OR IGNORE INTO routine_runs
        (id, routine_id, skill_id, scheduled_key, started_at, ended_at, status, failure)
       VALUES (?, ?, ?, ?, ?, ?, 'missed', ?)`,
      [id, routine.id, routine.skillId, scheduledKey, now, now, clip(message)],
    ) === 1;
  }

  finish(id: string, outcome: { status: 'completed' | 'failed' | 'cancelled' | 'missed' | 'denied'; taskId?: string; summary?: string; failure?: string }, now = Date.now()): void {
    this.db.execute(
      `UPDATE routine_runs SET ended_at = ?, status = ?, task_id = ?, summary = ?, failure = ?
       WHERE id = ? AND status = 'running'`,
      [now, outcome.status, outcome.taskId ?? null, clip(outcome.summary), clip(outcome.failure), id],
    );
    const row = this.db.queryOne<{ routine_id: string }>('SELECT routine_id FROM routine_runs WHERE id = ?', [id]);
    if (row) {
      const routineId = String(row.routine_id);
      const routine = this.get(routineId);
      const nextRunAt = routine && routine.scheduleKind !== 'once' ? computeNextRunAt(routine, now) : null;
      this.updateRunTimestamps(routineId, { lastRunAt: now, lastStatus: outcome.status, nextRunAt });
      if (routine?.scheduleKind === 'once' && outcome.status === 'completed') {
        this.setEnabled(routineId, false);
      }
      if (outcome.status === 'failed' || outcome.status === 'denied') {
        this.setEnabled(routineId, false);
      }
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
  private readonly lease?: SchedulerLeaseManager;
  private readonly onMissedNotification?: (routine: LocalRoutine, scheduledKey: string, policy: MissedRunPolicy) => void;

  constructor(
    private readonly store: RoutineStore,
    private readonly skills: SkillStore,
    private readonly execute: RoutineExecutor,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly canRun: () => boolean = () => true,
    options?: {
      lease?: SchedulerLeaseManager;
      onMissedNotification?: (routine: LocalRoutine, scheduledKey: string, policy: MissedRunPolicy) => void;
    },
  ) {
    this.lease = options?.lease;
    this.onMissedNotification = options?.onMissedNotification;
  }

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
      if (this.lease && !this.lease.acquireOrRenew(45_000, now)) {
        // Another live Pixel instance currently owns the scheduler lease.
        return;
      }
      for (const routine of this.store.enabled()) {
        if (routine.scheduleKind === 'daily') {
          this.evaluateDailyRoutine(routine, now);
        } else if (routine.scheduleKind === 'cron' || routine.scheduleKind === 'weekly') {
          this.evaluateCronRoutine(routine, now);
        } else if (routine.scheduleKind === 'interval') {
          this.evaluateIntervalRoutine(routine, now);
        } else if (routine.scheduleKind === 'once') {
          this.evaluateOneTimeRoutine(routine, now);
        }
      }
      void this.drainQueue();
    } catch (error) {
      this.onError(error);
    } finally {
      this.ticking = false;
    }
  }

  private evaluateDailyRoutine(routine: LocalRoutine, now: number): void {
    const local = localScheduleTime(now, routine.timezone);
    const currentMinute = `${local.hour}:${local.minute}`;
    const occurrence = `${local.date}T${routine.localTime}@${routine.timezone}`;
    if (currentMinute === routine.localTime) {
      if (!this.canRun()) {
        this.store.markMissed(routine, occurrence, now);
        return;
      }
      const runId = this.store.claim(routine, occurrence, now);
      if (runId) this.queue.push({ runId, routine, occurrence, manual: false });
    } else if (currentMinute > routine.localTime) {
      this.handleMissedOccurrence(routine, occurrence, now, 0);
    }
  }

  private evaluateCronRoutine(routine: LocalRoutine, now: number): void {
    if (!routine.cronExpression) return;
    const baseline = Math.max(routine.lastRunAt ?? routine.createdAt, routine.nextRunAt ? routine.nextRunAt - 60_000 : routine.createdAt);
    const due = listCronOccurrencesBetween(routine.cronExpression, routine.timezone, baseline, now, 10);
    if (due.length === 0) {
      const next = nextCronOccurrence(routine.cronExpression, routine.timezone, now);
      if (next !== routine.nextRunAt) this.store.updateRunTimestamps(routine.id, { nextRunAt: next });
      return;
    }

    const latest = due[due.length - 1]!;
    const currentMinuteFloor = Math.floor(now / 60_000) * 60_000;
    const isDueNow = Math.floor(latest.at / 60_000) * 60_000 === currentMinuteFloor;

    if (isDueNow) {
      for (const earlier of due.slice(0, -1)) {
        this.handleMissedOccurrence(routine, earlier.scheduledKey, now, now - earlier.at);
      }
      if (!this.canRun()) {
        this.store.markMissed(routine, latest.scheduledKey, now, 'Emergency stop or pause prevented scheduled execution.');
      } else {
        const runId = this.store.claim(routine, latest.scheduledKey, now);
        if (runId) this.queue.push({ runId, routine, occurrence: latest.scheduledKey, manual: false });
      }
    } else {
      this.applyMissedPolicyBatch(routine, due, now);
    }

    const next = nextCronOccurrence(routine.cronExpression, routine.timezone, now);
    this.store.updateRunTimestamps(routine.id, { nextRunAt: next });
  }

  private evaluateIntervalRoutine(routine: LocalRoutine, now: number): void {
    if (!routine.intervalMs) return;
    const target = routine.nextRunAt ?? (routine.lastRunAt ?? routine.createdAt) + routine.intervalMs;
    if (now < target) return;
    const bucket = Math.floor(target / routine.intervalMs);
    const occurrence = `interval:${routine.intervalMs}:${bucket}`;
    const lateness = now - target;
    if (lateness <= 60_000) {
      if (!this.canRun()) {
        this.store.markMissed(routine, occurrence, now);
      } else {
        const runId = this.store.claim(routine, occurrence, now);
        if (runId) this.queue.push({ runId, routine, occurrence, manual: false });
      }
    } else {
      this.handleMissedOccurrence(routine, occurrence, now, lateness);
    }
    const nextRunAt = now + routine.intervalMs;
    this.store.updateRunTimestamps(routine.id, { nextRunAt });
  }

  private evaluateOneTimeRoutine(routine: LocalRoutine, now: number): void {
    if (!routine.runAt || now < routine.runAt) return;
    const occurrence = `once:${routine.runAt}`;
    const lateness = now - routine.runAt;
    if (lateness <= 60_000) {
      if (!this.canRun()) {
        this.store.markMissed(routine, occurrence, now);
      } else {
        const runId = this.store.claim(routine, occurrence, now);
        if (runId) this.queue.push({ runId, routine, occurrence, manual: false });
      }
    } else {
      this.handleMissedOccurrence(routine, occurrence, now, lateness);
      if (routine.missedRunPolicy === 'skip' || routine.missedRunPolicy === 'notify_only') {
        this.store.setEnabled(routine.id, false);
      }
    }
  }

  private applyMissedPolicyBatch(
    routine: LocalRoutine,
    missed: Array<{ at: number; scheduledKey: string }>,
    now: number,
  ): void {
    if (missed.length === 0) return;
    const policy = routine.missedRunPolicy;
    if (policy === 'skip' || policy === 'notify_only') {
      for (const item of missed) {
        if (this.store.markMissed(routine, item.scheduledKey, now, policy === 'notify_only'
          ? 'Missed scheduled run; policy is notify_only (not replayed).'
          : 'Pixel was closed or asleep at the scheduled time; missed work is skipped.')) {
          this.onMissedNotification?.(routine, item.scheduledKey, policy);
        }
      }
      return;
    }

    if (policy === 'run_once') {
      // Never replay all missed occurrences; mark older ones missed and run only the latest once.
      for (const earlier of missed.slice(0, -1)) {
        this.store.markMissed(routine, earlier.scheduledKey, now, 'Collapsed into single catch-up run (run_once policy).');
      }
      const latest = missed[missed.length - 1]!;
      if (this.canRun()) {
        const runId = this.store.claim(routine, latest.scheduledKey, now);
        if (runId) this.queue.push({ runId, routine, occurrence: latest.scheduledKey, manual: false });
      } else {
        this.store.markMissed(routine, latest.scheduledKey, now, 'Missed run could not catch up while execution is paused.');
      }
      return;
    }

    // policy === 'catch_up_window': run at most 1 missed occurrence inside the bounded window.
    const windowMs = routine.catchupWindowMs ?? 60 * 60_000;
    const latest = missed[missed.length - 1]!;
    for (const earlier of missed.slice(0, -1)) {
      this.store.markMissed(routine, earlier.scheduledKey, now, 'Outside bounded catch-up window or superseded by latest missed occurrence.');
    }
    if (now - latest.at <= windowMs && this.canRun()) {
      const runId = this.store.claim(routine, latest.scheduledKey, now);
      if (runId) this.queue.push({ runId, routine, occurrence: latest.scheduledKey, manual: false });
    } else {
      if (this.store.markMissed(routine, latest.scheduledKey, now, `Missed run exceeded catch-up window (${Math.round(windowMs / 60_000)}m) and was skipped.`)) {
        this.onMissedNotification?.(routine, latest.scheduledKey, policy);
      }
    }
  }

  private handleMissedOccurrence(routine: LocalRoutine, occurrence: string, now: number, latenessMs: number): void {
    this.applyMissedPolicyBatch(routine, [{ at: now - latenessMs, scheduledKey: occurrence }], now);
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
    this.lease?.release();
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

export function computeNextRunAt(routine: Pick<LocalRoutine, 'scheduleKind' | 'localTime' | 'timezone' | 'cronExpression' | 'intervalMs' | 'runAt'>, afterMs = Date.now()): number | null {
  if (routine.scheduleKind === 'once') {
    return routine.runAt && routine.runAt > afterMs ? routine.runAt : null;
  }
  if (routine.scheduleKind === 'interval') {
    return routine.intervalMs ? afterMs + routine.intervalMs : null;
  }
  if (routine.scheduleKind === 'cron' || routine.scheduleKind === 'weekly') {
    return routine.cronExpression ? nextCronOccurrence(routine.cronExpression, routine.timezone, afterMs) : null;
  }
  const [hourStr, minStr] = routine.localTime.split(':');
  if (!hourStr || !minStr) return null;
  return nextCronOccurrence(`${Number.parseInt(minStr, 10)} ${Number.parseInt(hourStr, 10)} * * *`, routine.timezone, afterMs);
}

function fromRoutineRow(row: RoutineRow): LocalRoutine {
  let inputValues: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(row.input_values);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    inputValues = Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || typeof value !== 'string' || value.length > 2_000) {
        throw new Error('invalid input entry');
      }
      return [key, value];
    }));
    if (Object.keys(inputValues).length > 30) throw new Error('too many inputs');
  } catch {
    throw new Error('Saved routine inputs are invalid. Delete and recreate this routine before it can run.');
  }
  const scheduleKind = (row.schedule_kind ?? 'daily') as RoutineScheduleKind;
  const missedRunPolicy = (row.missed_run_policy ?? 'skip') as MissedRunPolicy;
  const executionScope = (row.execution_scope ?? 'headless') as TaskExecutionScope;
  return {
    id: String(row.id), projectId: String(row.project_id), skillId: String(row.skill_id),
    name: String(row.name), localTime: String(row.local_time), timezone: String(row.timezone),
    scheduleKind,
    ...(row.cron_expression ? { cronExpression: String(row.cron_expression) } : {}),
    ...(row.interval_ms !== null && row.interval_ms !== undefined ? { intervalMs: Number(row.interval_ms) } : {}),
    ...(row.run_at !== null && row.run_at !== undefined ? { runAt: Number(row.run_at) } : {}),
    executionScope,
    inputValues,
    enabled: Number(row.enabled) === 1,
    retryPolicy: 'manual',
    maxRetries: Number(row.max_retries ?? 0),
    missedRunPolicy,
    ...(row.catchup_window_ms !== null && row.catchup_window_ms !== undefined ? { catchupWindowMs: Number(row.catchup_window_ms) } : {}),
    nextRunAt: row.next_run_at === null || row.next_run_at === undefined ? null : Number(row.next_run_at),
    lastRunAt: row.last_run_at === null || row.last_run_at === undefined ? null : Number(row.last_run_at),
    lastStatus: row.last_status === null || row.last_status === undefined ? null : String(row.last_status),
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
  timezone: string; enabled: number; created_at: number; updated_at: number; input_values: string;
  schedule_kind?: string; cron_expression?: string | null; interval_ms?: number | null;
  run_at?: number | null; missed_run_policy?: string; catchup_window_ms?: number | null;
  max_retries?: number; execution_scope?: string; next_run_at?: number | null;
  last_run_at?: number | null; last_status?: string | null;
}

interface RoutineRunRow {
  id: string; routine_id: string; skill_id: string; scheduled_key: string; started_at: number;
  ended_at: number | null; status: string; task_id: string | null; summary: string | null; failure: string | null;
}
