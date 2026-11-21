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
import type { AuditSink } from './auditStore';
import { describeScope } from './scope';
import { ToolRegistry, applyDecision, riskAllowsGrantDuration } from './tools';
import { PERMISSION_POLICY_VERSION } from './scope';
import type { PermissionGrantStore } from './permissionStore';
import type { TaskPersistence } from '../tasks/store';
import { redactTaskText } from '../tasks/schema';

export const MAX_AUDIT_ENTRIES = 500;

/** Append-only audit trail, held in memory and capped. */
export class AuditLog {
  private entries: AuditEntry[] = [];

  /** An optional durable copy. Entries are sanitised by the sink, not here. */
  constructor(private readonly sink?: AuditSink) {}

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
    this.sink?.write(entry);
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
  private pending: { request: PermissionRequest; resolve: (d: PermissionDecision) => void; cleanup: () => void } | null = null;
  private readonly registry: ToolRegistry;
  private readonly grantStore?: PermissionGrantStore;
  private readonly audit: AuditLog;
  private readonly emitRequest: (request: PermissionRequest) => void;
  private readonly emitResolved: (requestId: string) => void;

  constructor(registry: ToolRegistry, audit: AuditLog, emitRequest: (r: PermissionRequest) => void, emitResolved: (id: string) => void = () => undefined, grantStore?: PermissionGrantStore) {
    this.registry = registry;
    this.audit = audit;
    this.emitRequest = emitRequest;
    this.emitResolved = emitResolved;
    this.grantStore = grantStore;
    for (const grant of grantStore?.listActive() ?? []) {
      if (!registry.grant(grant)) grantStore?.revoke(grant.id);
    }
  }

  /** Ask the user. Resolves with their decision; never resolves to approved by default. */
  async ask(request: PermissionRequest, signal?: AbortSignal): Promise<PermissionDecision> {
    if (signal?.aborted) return { requestId: request.id, approved: false, duration: 'once' };
    if (this.pending) {
      // One prompt at a time: a second concurrent request is refused rather
      // than queued, so the UI cannot be tricked into approving twice.
      return { requestId: request.id, approved: false, duration: 'once' };
    }

    this.audit.record('permission', `Asked to run "${request.toolName}"`, 'ok', request.action);

    return new Promise<PermissionDecision>((resolve) => {
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
      const onAbort = (): void => {
        if (this.pending?.request.id !== request.id) return;
        this.pending = null;
        cleanup();
        this.notifyResolved(request.id);
        this.audit.record('permission', `Cancelled "${request.toolName}"`, 'cancelled');
        resolve({ requestId: request.id, approved: false, duration: 'once' });
      };
      this.pending = { request, resolve, cleanup };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        this.emitRequest(request);
      } catch {
        this.pending = null;
        cleanup();
        this.notifyResolved(request.id);
        try {
          this.audit.record('permission', 'Could not deliver the approval request', 'error');
        } catch {
          // A failed audit sink must not leave a permission prompt pending.
        }
        resolve({ requestId: request.id, approved: false, duration: 'once' });
      }
    });
  }

  /** Apply a decision coming back from the UI. */
  respond(decision: PermissionDecision): void {
    const pending = this.pending;
    if (!pending) return;
    if (decision.requestId !== pending.request.id) {
      this.audit.record('permission', 'Ignored a stale approval response', 'denied');
      return;
    }
    if (typeof decision.approved !== 'boolean' || !['once', 'session', 'always'].includes(decision.duration)) {
      this.audit.record('permission', 'Ignored an invalid approval response', 'denied');
      this.pending = null;
      pending.cleanup();
      this.notifyResolved(pending.request.id);
      pending.resolve({ requestId: pending.request.id, approved: false, duration: 'once' });
      return;
    }
    this.pending = null;
    pending.cleanup();
    this.notifyResolved(decision.requestId);

    // The renderer is not an authority boundary. Always Allow is checked again
    // against a main-process capability allow-list and the exact current scope.
    let effectiveDecision: PermissionDecision = { ...decision };
    if (decision.approved && decision.duration === 'always') {
      const eligibility = this.registry.canGrantAlways(pending.request.toolName, pending.request.args);
      if (!eligibility.allowed || (pending.request.risk && !riskAllowsGrantDuration(pending.request.risk, 'always'))) {
        effectiveDecision = { requestId: decision.requestId, approved: false, duration: 'once' };
        this.audit.record('permission', 'Rejected an ineligible Always Allow decision', 'denied', eligibility.reason);
      }
    }
    if (decision.approved && decision.duration === 'session') {
      const eligibility = this.registry.canGrantSession(pending.request.toolName, pending.request.args);
      if (!eligibility.allowed || (pending.request.risk && !riskAllowsGrantDuration(pending.request.risk, 'session'))) {
        effectiveDecision = { requestId: decision.requestId, approved: false, duration: 'once' };
        this.audit.record('permission', 'Rejected an ineligible session permission', 'denied', eligibility.reason);
      }
    }

    if (effectiveDecision.approved) {
      const grant = applyDecision(effectiveDecision, {
        toolName: pending.request.toolName,
        args: pending.request.args,
        risk: pending.request.risk,
      });
      if (grant) {
        if (!this.registry.grant(grant)) {
          effectiveDecision = { requestId: decision.requestId, approved: false, duration: 'once' };
          this.audit.record('permission', 'Rejected a permission that failed current policy validation', 'denied');
          pending.resolve(effectiveDecision);
          return;
        }
        if (grant.scope === 'always') {
          try {
            if (!this.grantStore || grant.policyVersion !== PERMISSION_POLICY_VERSION) throw new Error('persistent permission store unavailable');
            this.grantStore.save(grant);
          } catch {
            this.registry.revoke(grant.id);
            effectiveDecision = { requestId: decision.requestId, approved: false, duration: 'once' };
            this.audit.record('permission', 'Could not persist Always Allow; action was not approved', 'error');
            pending.resolve(effectiveDecision);
            return;
          }
        }
        this.audit.record(
          'permission',
          `Approved "${pending.request.toolName}" (${grant.scope})`,
          'ok',
          `limited to ${describeScope(grant.target ?? {})}`,
        );
      }
    } else {
      this.audit.record('permission', `Denied "${pending.request.toolName}"`, 'denied');
    }

    pending.resolve(effectiveDecision);
  }

  /** Reject anything still pending; used when a turn ends or stop is pressed. */
  rejectPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.cleanup();
    this.notifyResolved(pending.request.id);
    this.audit.record('permission', `Cancelled "${pending.request.toolName}"`, 'cancelled');
    pending.resolve({ requestId: pending.request.id, approved: false, duration: 'once' });
  }

  activeGrants(): PermissionGrant[] {
    return this.registry.activeGrants();
  }

  /** Revoke one tool's grant. Used to consume single-use approvals. */
  revoke(toolName: string): boolean {
    const grant = this.activeGrants().find((candidate) => candidate.toolName === toolName && candidate.scope === 'once');
    const existed = grant ? this.registry.revoke(grant.id) : false;
    if (existed) {
      this.audit.record('permission', `Consumed approval for "${toolName}"`, 'ok');
    }
    return existed;
  }

  revokeGrant(grantId: string): boolean {
    const grant = this.activeGrants().find((candidate) => candidate.id === grantId);
    if (!grant || !this.registry.revoke(grantId)) return false;
    if (grant.scope === 'always') this.grantStore?.revoke(grantId);
    this.audit.record('permission', `Revoked "${grant.toolName}" permission`, 'ok', `limited to ${describeScope(grant.target ?? {})}`);
    return true;
  }

  revokeAll(): number {
    this.rejectPending();
    const count = this.registry.revokeAll();
    this.grantStore?.revokeAll();
    return count;
  }

  clearExpiredGrants(): number {
    return this.grantStore?.clearExpired() ?? 0;
  }

  isPending(): boolean {
    return this.pending !== null;
  }

  pendingRequests(): PermissionRequest[] {
    return this.pending ? [this.pending.request] : [];
  }

  private notifyResolved(requestId: string): void {
    try { this.emitResolved(requestId); } catch { /* permission completion must not depend on renderer delivery */ }
  }
}

/** Tracks long-running tasks so the UI can show real progress. */
export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly emit: (task: TaskRecord) => void;
  private readonly persistence?: TaskPersistence;
  private readonly onError: (error: unknown) => void;
  private readonly controls = new Map<string, { cancel: () => void }>();
  private readonly pauseWaiters = new Map<string, (resumed: boolean) => void>();
  private readonly handoffWaiters = new Map<string, (continued: boolean) => void>();

  constructor(
    emit: (task: TaskRecord) => void,
    persistence?: TaskPersistence,
    onPersistenceError: (error: unknown) => void = () => undefined,
  ) {
    this.emit = emit;
    this.persistence = persistence;
    this.onError = onPersistenceError;

    for (const restored of persistence?.load() ?? []) {
      const interrupted = isActiveStatus(restored.status) || restored.status === 'paused'
        ? {
            ...restored,
            status: 'paused' as const,
            pauseRequested: false,
            recoveryNote:
              'Pixel restarted while this task was active. Its previous call stack and pending approval were discarded. Review the last completed step and recheck the target before starting a new request.',
            checkpoint: {
              phase: 'before_tool' as const,
              at: Date.now(),
              summary: 'Restart recovery: no action was resumed automatically.',
            },
          }
        : restored;
      if (interrupted !== restored) this.commit(interrupted);
      else this.tasks.set(restored.id, restored);
    }
  }

  upsert(task: TaskRecord): void {
    this.commit(task);
  }

  update(id: string, patch: Partial<TaskRecord>): void {
    const existing = this.tasks.get(id);
    if (!existing) return;
    const next: TaskRecord = { ...existing, ...patch };
    this.commit(next);
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].sort(
      (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
    );
  }

  registerControl(id: string, control: { cancel: () => void }): void {
    this.controls.set(id, control);
  }

  unregisterControl(id: string): void {
    this.controls.delete(id);
    this.pauseWaiters.get(id)?.(false);
    this.pauseWaiters.delete(id);
    this.handoffWaiters.get(id)?.(false);
    this.handoffWaiters.delete(id);
  }

  /** Stop the agent at a safe point until the user explicitly completes a handoff. */
  async waitForHuman(id: string, reason: string, signal: AbortSignal): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || !this.controls.has(id) || signal.aborted) return false;
    if (this.handoffWaiters.has(id)) return false;
    const safeReason = redactHandoffReason(reason);
    this.update(id, {
      status: 'awaiting_user',
      handoffReason: safeReason,
      checkpoint: { phase: 'before_tool', at: Date.now(), summary: 'Paused for user handoff.' },
    });
    return new Promise<boolean>((resolve) => {
      const finish = (continued: boolean): void => {
        signal.removeEventListener('abort', onAbort);
        this.handoffWaiters.delete(id);
        resolve(continued && !signal.aborted);
      };
      const onAbort = (): void => finish(false);
      this.handoffWaiters.set(id, finish);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) finish(false);
    });
  }

  /** Continue the current call stack only after the user acknowledges the handoff. */
  continueAfterHandoff(id: string): boolean {
    const task = this.tasks.get(id);
    const resolve = this.handoffWaiters.get(id);
    if (!task || task.status !== 'awaiting_user' || !resolve) return false;
    this.update(id, {
      status: 'running',
      handoffReason: undefined,
      reobserveRequired: true,
      evidence: [
        ...(task.evidence ?? []),
        {
          id: `recovery_${Date.now().toString(36)}`,
          kind: 'recovery' as const,
          summary: 'User indicated the handoff is complete. Re-observation is still required before further action.',
          source: 'User handoff acknowledgement',
          at: Date.now(),
        },
      ].slice(-100),
    });
    resolve(true);
    return true;
  }

  /** Wait until a safe executor boundary is resumed, or cancellation occurs. */
  async waitUntilRunnable(id: string, phase: 'before_model' | 'before_tool', signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    const task = this.get(id);
    if (!task || task.recoveryNote) return false;
    this.update(id, {
      checkpoint: { phase, at: Date.now(), summary: 'Safe point reached.' },
    });
    const current = this.get(id);
    if (!current?.pauseRequested) return !signal.aborted;

    this.update(id, { status: 'paused', pauseRequested: false });
    return new Promise<boolean>((resolve) => {
      const finish = (resumed: boolean): void => {
        signal.removeEventListener('abort', onAbort);
        this.pauseWaiters.delete(id);
        resolve(resumed && !signal.aborted);
      };
      const onAbort = (): void => finish(false);
      this.pauseWaiters.set(id, (resumed) => finish(resumed));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) finish(false);
    });
  }

  /** Mark every running or planning task as cancelled. Returns how many. */
  cancelAll(_reason: string): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (isCancellableStatus(task.status)) {
        this.controls.get(task.id)?.cancel();
        this.pauseWaiters.get(task.id)?.(false);
        this.update(task.id, { status: 'cancelled', endedAt: Date.now(), pauseRequested: false });
        count += 1;
      }
    }
    return count;
  }

  pause(id: string): void {
    const task = this.tasks.get(id);
    if (!task || !this.controls.has(id) || !['running', 'planning', 'awaiting_approval'].includes(task.status)) return;
    this.update(id, { status: 'pause_requested', pauseRequested: true });
  }

  resume(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'paused' || task.recoveryNote || !this.controls.has(id)) return;
    this.update(id, { status: 'running', pauseRequested: false });
    this.pauseWaiters.get(id)?.(true);
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task || !isCancellableStatus(task.status)) return;
    const cancel = this.controls.get(id)?.cancel;
    if (!cancel) {
      this.update(id, { status: 'cancelled', endedAt: Date.now(), pauseRequested: false });
      return;
    }
    this.update(id, { status: 'cancelling', pauseRequested: false });
    this.pauseWaiters.get(id)?.(false);
    cancel();
  }

  runningCount(): number {
    return [...this.tasks.values()].filter((t) => isActiveStatus(t.status)).length;
  }

  private commit(task: TaskRecord): void {
    const next: TaskRecord = { ...task, updatedAt: Date.now() };
    this.tasks.set(next.id, next);
    try {
      this.persistence?.save(next);
    } catch (error) {
      this.onError(error);
    }
    try {
      this.emit(next);
    } catch (error) {
      // A renderer can close while a task is running. Durable state remains the
      // source of truth and will be hydrated from tasks.list() on the next view.
      this.onError(error);
    }
  }
}

function isActiveStatus(status: TaskRecord['status']): boolean {
  return ['planning', 'running', 'pause_requested', 'awaiting_approval', 'awaiting_user', 'cancelling'].includes(status);
}

function isCancellableStatus(status: TaskRecord['status']): boolean {
  return isActiveStatus(status) || status === 'paused' || status === 'blocked';
}

function redactHandoffReason(reason: string): string {
  return redactTaskText(reason.replace(/\s+/g, ' ').trim()).slice(0, 1_000);
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
