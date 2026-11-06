/**
 * Runtime coordination for agentic behaviour.
 *
 * Owns the four things that must be consistent no matter which UI is driving:
 * audit trail, permission broker, task tracking, and the emergency stop.
 *
 * Electron-free so it can be unit-tested directly.
 */

import type {
  AuditEntry,
  EmergencyStopReport,
  PermissionDecision,
  PermissionGrant,
  PermissionRequest,
  TaskRecord,
} from '../../shared/types';
import { ToolRegistry, applyDecision } from './tools';

export const MAX_AUDIT_ENTRIES = 500;

/** Append-only audit trail, held in memory and capped. */
export class AuditLog {
  private entries: AuditEntry[] = [];

  record(
    kind: AuditEntry['kind'],
    summary: string,
    outcome: AuditEntry['outcome'],
    detail?: string,
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      kind,
      summary,
      outcome,
      ...(detail ? { detail } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_AUDIT_ENTRIES) {
      this.entries = this.entries.slice(-MAX_AUDIT_ENTRIES);
    }
    return entry;
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Permission broker.
 *
 * A request is only resolved by an explicit decision. If no UI is listening the
 * request stays pending and is eventually rejected when the turn ends, rather
 * than defaulting to approved.
 */
export class PermissionBroker {
  private pending: { request: PermissionRequest; resolve: (d: PermissionDecision) => void } | null =
    null;
  private readonly grants = new Map<string, PermissionGrant>();
  private readonly registry: ToolRegistry;
  private readonly audit: AuditLog;
  private readonly emitRequest: (request: PermissionRequest) => void;

  constructor(registry: ToolRegistry, audit: AuditLog, emitRequest: (r: PermissionRequest) => void) {
    this.registry = registry;
    this.audit = audit;
    this.emitRequest = emitRequest;
  }

  /** Ask the user. Resolves with their decision; never resolves to approved by default. */
  async ask(request: PermissionRequest): Promise<PermissionDecision> {
    if (this.pending) {
      // One prompt at a time: a second concurrent request is refused rather
      // than queued, so the UI cannot be tricked into approving twice.
      return { requestId: request.id, approved: false, duration: 'once' };
    }

    this.audit.record('permission', `Asked to run "${request.toolName}"`, 'ok', request.action);

    return new Promise<PermissionDecision>((resolve) => {
      this.pending = { request, resolve };
      this.emitRequest(request);
    });
  }

  /** Apply a decision coming back from the UI. */
  respond(decision: PermissionDecision): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;

    if (decision.approved) {
      const grant = applyDecision(decision, { toolName: pending.request.toolName });
      if (grant) {
        this.grants.set(grant.toolName, grant);
        this.registry.grant(grant);
        this.audit.record(
          'permission',
          `Approved "${pending.request.toolName}" (${grant.scope})`,
          'ok',
        );
      }
    } else {
      this.audit.record('permission', `Denied "${pending.request.toolName}"`, 'denied');
    }

    pending.resolve(decision);
  }

  /** Reject anything still pending; used when a turn ends or stop is pressed. */
  rejectPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.audit.record('permission', `Cancelled "${pending.request.toolName}"`, 'cancelled');
    pending.resolve({ requestId: pending.request.id, approved: false, duration: 'once' });
  }

  activeGrants(): PermissionGrant[] {
    return this.registry.activeGrants();
  }

  revokeAll(): number {
    this.rejectPending();
    const count = this.registry.revokeAll();
    this.grants.clear();
    return count;
  }

  isPending(): boolean {
    return this.pending !== null;
  }
}

/** Tracks long-running tasks so the UI can show real progress. */
export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly emit: (task: TaskRecord) => void;

  constructor(emit: (task: TaskRecord) => void) {
    this.emit = emit;
  }

  upsert(task: TaskRecord): void {
    this.tasks.set(task.id, task);
    this.emit(task);
  }

  update(id: string, patch: Partial<TaskRecord>): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const next: TaskRecord = { ...existing, ...patch };
    this.tasks.set(id, next);
    this.emit(next);
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  /** Mark every running or planning task as cancelled. Returns how many. */
  cancelAll(_reason: string): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'planning' || task.status === 'awaiting_approval') {
        const next: TaskRecord = {
          ...task,
          status: 'cancelled',
          endedAt: Date.now(),
        };
        this.tasks.set(task.id, next);
        this.emit(next);
        count += 1;
      }
    }
    return count;
  }

  pause(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'running') this.update(id, { status: 'paused' });
  }

  resume(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'paused') this.update(id, { status: 'running' });
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (task && task.status !== 'completed' && task.status !== 'failed') {
      this.update(id, { status: 'cancelled' });
    }
  }

  runningCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === 'running').length;
  }
}

export interface EmergencyStopDeps {
  registry: ToolRegistry;
  permissions: PermissionBroker;
  tasks: TaskManager;
  audit: AuditLog;
  /** Aborts the in-flight model stream; returns true if something was running. */
  abortStream: () => boolean;
  /** Terminates any child processes started by tools; returns how many. */
  killChildren: () => number;
  /** Names of tools that already completed before the stop. */
  completedActions: () => string[];
  /** Notifies the renderer. */
  notify: (report: EmergencyStopReport) => void;
}

/**
 * The global stop.
 *
 * It stops future work; it does not and cannot undo work that already finished.
 * The report says exactly which actions had already completed so the UI never
 * implies a rollback that did not happen.
 */
export class EmergencyController {
  private stopped = false;
  private readonly deps: EmergencyStopDeps;

  constructor(deps: EmergencyStopDeps) {
    this.deps = deps;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  trigger(): EmergencyStopReport {
    this.stopped = true;
    this.deps.registry.setStopped(true);

    const revokedGrants = this.deps.permissions.revokeAll();
    const cancelledPending = this.deps.tasks.cancelAll('Cancelled by emergency stop.');
    const abortedStream = this.deps.abortStream();
    this.deps.killChildren();

    const report: EmergencyStopReport = {
      at: Date.now(),
      cancelledPending,
      completedActions: this.deps.completedActions(),
      revokedGrants,
      abortedStream,
    };

    this.deps.audit.record(
      'system',
      'Emergency stop pressed',
      'cancelled',
      `${cancelledPending} task(s) cancelled, ${revokedGrants} permission(s) revoked, stream aborted: ${abortedStream}`,
    );

    this.deps.notify(report);
    return report;
  }

  /** Resume normal operation after a stop. */
  clear(): void {
    this.stopped = false;
    this.deps.registry.setStopped(false);
    this.deps.audit.record('system', 'Emergency stop cleared', 'ok');
  }
}
