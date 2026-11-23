/**
 * Specialized subagents.
 *
 * A specialist is a named, bounded role: which tools it may use, how many steps
 * and tokens it may spend, and what shape of result it must return. The
 * coordinator - not the specialist - owns permission decisions and budgets.
 *
 * These are in-process objects, not operating-system processes. Isolation would
 * buy nothing here and would cost startup latency for every small task.
 */

import { randomUUID } from 'node:crypto';
import type { Mode, TaskRecord, TaskStep, ToolDefinition } from '../../shared/types';
import type { ToolRegistry } from '../agent/tools';
import type { TaskManager } from '../agent/runtime';
import { inferTaskExecutionScope } from '../tasks/recovery';

/** Hard ceiling for simultaneous parallel child specialists. */
export const MAX_CONCURRENT_SPECIALISTS = 3;
export const MAX_FINDING_CHARS = 4_000;
export const MAX_CONSOLIDATED_SUMMARY_CHARS = 8_000;

/** Tools that children are never allowed to call (no nested delegation by default). */
const DELEGATION_BLOCKED_TOOLS = new Set<string>([
  'delegate_to_specialist',
  'delegate_parallel',
  'delegate_task',
]);

export const SPECIALIST_IDS = [
  'research',
  'browser',
  'systems',
  'infrastructure',
  'knowledge',
  'code',
] as const;
export type SpecialistId = (typeof SPECIALIST_IDS)[number];

export interface SpecialistDefinition {
  id: SpecialistId;
  label: string;
  /** One line shown in the compact UI. */
  purpose: string;
  /** Tools this specialist may ever call. Everything else is refused. */
  allowedTools: string[];
  /** Hard ceilings, enforced by the coordinator. */
  limits: {
    maxSteps: number;
    maxTokens: number;
    timeoutMs: number;
  };
}

/** Tool names each specialist may use. Empty means "no tool access yet". */
export const SPECIALISTS: Record<SpecialistId, SpecialistDefinition> = {
  research: {
    id: 'research',
    label: 'Research',
    purpose: 'Finds and compares information on the web and reports with sources.',
    allowedTools: ['browser_open_search', 'browser_navigate', 'browser_inspect', 'browser_click', 'browser_scroll', 'browser_verify', 'browser_screenshot', 'get_current_time'],
    limits: { maxSteps: 12, maxTokens: 24_000, timeoutMs: 180_000 },
  },
  browser: {
    id: 'browser',
    label: 'Browser',
    purpose: 'Drives a page: navigate, click, type, verify.',
    allowedTools: ['browser_navigate', 'browser_inspect', 'browser_click', 'browser_type', 'browser_scroll', 'browser_verify', 'browser_screenshot'],
    limits: { maxSteps: 15, maxTokens: 20_000, timeoutMs: 180_000 },
  },
  systems: {
    id: 'systems',
    label: 'Systems',
    purpose: 'Inspects this Windows machine and reads diagnostics.',
    allowedTools: ['get_system_info', 'get_current_time', 'analyze_screen'],
    limits: { maxSteps: 8, maxTokens: 12_000, timeoutMs: 120_000 },
  },
  infrastructure: {
    id: 'infrastructure',
    label: 'Infrastructure',
    purpose: 'Virtual machines, remote services and network checks.',
    // Deliberately empty: the VirtualBox and SSH adapters do not exist yet, and a
    // specialist must not be granted tools it cannot actually run.
    allowedTools: [],
    limits: { maxSteps: 10, maxTokens: 16_000, timeoutMs: 180_000 },
  },
  knowledge: {
    id: 'knowledge',
    label: 'Knowledge',
    purpose: 'Searches memory and indexed documents, answers with sources.',
    allowedTools: [
      'memory_search',
      'memory_list',
      'memory_update',
      'documents_search',
      'documents_list',
      'documents_index',
    ],
    limits: { maxSteps: 10, maxTokens: 18_000, timeoutMs: 120_000 },
  },
  code: {
    id: 'code',
    label: 'Pixel Code',
    purpose: 'Reserved for the future coding workspace. Not implemented.',
    // The interface exists so Pixel Code can be integrated later without changing
    // the coordinator; no implementation is attached in this wave.
    allowedTools: [],
    limits: { maxSteps: 0, maxTokens: 0, timeoutMs: 0 },
  },
};

export interface DelegationRequest {
  specialist: SpecialistId;
  objective: string;
  mode: Mode;
  projectId: string;
  parentTaskId?: string;
  /** Tools the parent itself is permitted to use; children can never widen this. */
  parentAllowedTools?: string[];
  /**
   * Optional explicit tool allowlist override.
   * IMPORTANT (Fail-Closed): An explicitly empty array `[]` means ZERO tools,
   * never unrestricted access.
   */
  explicitToolAllowlist?: string[];
  /** Optional step limit override (clamped 2–30; Hermes `delegation.max_iterations`). */
  maxIterationsOverride?: number;
  /** Optional timeout override in seconds (clamped 15–600; Hermes `delegation.child_timeout_seconds`). */
  childTimeoutSecOverride?: number;
}

export interface DelegationPlan {
  specialist: SpecialistId;
  objective: string;
  projectId?: string;
  parentTaskId?: string;
  /** Tools currently allowed without a new prompt. */
  tools: string[];
  /** Tools the mode permits only after the normal per-action approval flow. */
  approvalTools: string[];
  limits: SpecialistDefinition['limits'];
  /** Tools requested but not granted, with the reason, for an honest report. */
  withheld: Array<{ tool: string; reason: string }>;
}

export interface DelegationResult {
  specialist: SpecialistId;
  status: 'completed' | 'failed' | 'cancelled' | 'refused';
  objective: string;
  taskId?: string;
  parentTaskId?: string;
  steps: number;
  tokensUsed: number;
  findings: string[];
  sources?: string[];
  failedOperations?: string[];
  remainingWork?: string[];
  durationMs?: number;
  failure?: string;
}

export interface DelegateExecutionOptions {
  parentTaskId?: string;
  projectId?: string;
  signal?: AbortSignal;
  tasks?: TaskManager;
  onHeartbeat?: (info: { taskId: string; specialist: SpecialistId; step: number; at: number }) => void;
}

export interface ParallelDelegationItem {
  plan: DelegationPlan;
  work: (
    step: number,
    signal: AbortSignal,
  ) => { tool: string; args: Record<string, unknown> } | null | Promise<{ tool: string; args: Record<string, unknown> } | null>;
}

export interface ConsolidatedDelegationReport {
  parentTaskId?: string;
  status: 'completed' | 'partial_failure' | 'cancelled' | 'failed';
  results: DelegationResult[];
  consolidatedFindings: string[];
  conflicts: string[];
  incompleteCount: number;
  maxConcurrencyUsed: number;
  durationMs: number;
}

/** A specialist's single execution: bounded tool calls and a structured result. */
export interface SpecialistRunner {
  run(step: { tool: string; args: Record<string, unknown> }): Promise<{ ok: boolean; content: string }>;
}

/**
 * Decide what a subagent is allowed to do before it starts.
 *
 * Two gates: the specialist's own allowlist, and the current mode's policy. A
 * delegation cannot widen either, and a Guide-mode delegation is refused entirely
 * for anything that changes state.
 */
export function planDelegation(
  request: DelegationRequest,
  registry: ToolRegistry,
): DelegationPlan {
  const definition = SPECIALISTS[request.specialist];
  const tools: string[] = [];
  const approvalTools: string[] = [];
  const withheld: Array<{ tool: string; reason: string }> = [];

  // Fail-closed: explicit empty allowlist means ZERO tools, never unrestricted.
  const explicitSet = request.explicitToolAllowlist !== undefined
    ? new Set(request.explicitToolAllowlist)
    : null;
  const parentSet = request.parentAllowedTools !== undefined
    ? new Set(request.parentAllowedTools)
    : null;

  for (const toolName of definition.allowedTools) {
    if (DELEGATION_BLOCKED_TOOLS.has(toolName)) {
      withheld.push({ tool: toolName, reason: 'nested delegation is disabled by default' });
      continue;
    }
    if (explicitSet !== null && !explicitSet.has(toolName)) {
      withheld.push({ tool: toolName, reason: 'excluded by explicit tool allowlist' });
      continue;
    }
    if (parentSet !== null && !parentSet.has(toolName)) {
      withheld.push({ tool: toolName, reason: 'parent does not hold permission for this tool' });
      continue;
    }
    const tool: ToolDefinition | undefined = registry.get(toolName);
    if (!tool) {
      withheld.push({ tool: toolName, reason: 'not available in this build' });
      continue;
    }
    const decision = registry.evaluate(toolName, request.mode);
    if (decision.allowed) {
      tools.push(toolName);
      continue;
    }
    if (decision.needsApproval) approvalTools.push(toolName);
    withheld.push({
      tool: toolName,
      reason: decision.needsApproval
        ? 'needs the user\u2019s approval before use'
        : decision.reason,
    });
  }

  const effectiveLimits = definition.limits.maxSteps === 0
    ? definition.limits
    : {
        maxSteps: request.maxIterationsOverride !== undefined
          ? Math.max(2, Math.min(30, Math.round(request.maxIterationsOverride)))
          : definition.limits.maxSteps,
        maxTokens: definition.limits.maxTokens,
        timeoutMs: request.childTimeoutSecOverride !== undefined
          ? Math.max(15, Math.min(600, Math.round(request.childTimeoutSecOverride))) * 1_000
          : definition.limits.timeoutMs,
      };

  return {
    specialist: request.specialist,
    objective: request.objective,
    projectId: request.projectId,
    parentTaskId: request.parentTaskId,
    tools,
    approvalTools,
    limits: effectiveLimits,
    withheld,
  };
}

export interface CoordinatorDeps {
  registry: ToolRegistry;
  /** True once the emergency stop has been pressed. */
  isStopped: () => boolean;
  /** Per-tool invocation through the normal gateway (permissions included). */
  invokeTool: (
    tool: string,
    args: Record<string, unknown>,
    context?: { signal?: AbortSignal; taskId?: string; projectId?: string },
  ) => Promise<{ ok: boolean; content: string }>;
  now?: () => number;
}

/**
 * Runs a delegation (single or parallel).
 *
 * Enforces step, token and wall-clock budgets, honours the emergency stop and
 * parent-child AbortSignal cancellation between every step, records real
 * heartbeats on TaskManager, and refuses tools outside the plan even if the
 * model asks for them.
 */
export class SpecialistCoordinator {
  private readonly deps: CoordinatorDeps;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
  }

  async delegate(
    plan: DelegationPlan,
    work: (
      step: number,
      signal: AbortSignal,
    ) => { tool: string; args: Record<string, unknown> } | null | Promise<{ tool: string; args: Record<string, unknown> } | null>,
    options: DelegateExecutionOptions = {},
  ): Promise<DelegationResult> {
    const nowFn = this.deps.now ?? Date.now;
    const startedAt = nowFn();
    const findings: string[] = [];
    const failedOperations: string[] = [];
    const taskSteps: TaskStep[] = [];
    let steps = 0;
    let tokensUsed = 0;

    const parentTaskId = options.parentTaskId ?? plan.parentTaskId;
    const projectId = options.projectId ?? plan.projectId;
    const childTaskId = `subtask_${plan.specialist}_${randomUUID().slice(0, 8)}`;
    const childController = new AbortController();
    const onParentAbort = (): void => childController.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    if (options.signal?.aborted) childController.abort();

    const finishTask = (
      status: DelegationResult['status'],
      failure?: string,
    ): DelegationResult => {
      options.signal?.removeEventListener('abort', onParentAbort);
      const endedAt = nowFn();
      const durationMs = Math.max(0, endedAt - startedAt);
      if (options.tasks) {
        options.tasks.unregisterControl(childTaskId);
        options.tasks.update(childTaskId, {
          status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed',
          steps: taskSteps,
          result: findings.join('\n').slice(0, MAX_FINDING_CHARS) || failure,
          endedAt,
          ...(failure ? { failure: { code: status.toUpperCase(), message: failure, retryable: false, at: endedAt } } : {}),
        });
      }
      return validateDelegationResult({
        specialist: plan.specialist,
        status,
        objective: plan.objective,
        taskId: childTaskId,
        ...(parentTaskId ? { parentTaskId } : {}),
        steps,
        tokensUsed,
        findings: findings.map((item) => item.slice(0, MAX_FINDING_CHARS)),
        ...(failedOperations.length ? { failedOperations } : {}),
        durationMs,
        ...(failure ? { failure } : {}),
      });
    };

    if (plan.limits.maxSteps === 0) {
      return finishTask('refused', 'This specialist is not implemented in this build.');
    }

    if (options.tasks) {
      const initialRecord: TaskRecord = {
        id: childTaskId,
        title: `${SPECIALISTS[plan.specialist].label}: ${plan.objective}`.slice(0, 200),
        request: plan.objective,
        status: 'running',
        steps: [],
        createdAt: startedAt,
        ...(projectId ? { projectId } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
        specialistId: plan.specialist,
        allowedTools: [...plan.tools, ...plan.approvalTools],
        executionScope: inferTaskExecutionScope({ allowedTools: [...plan.tools, ...plan.approvalTools], steps: [] }),
        lease: {
          instanceId: options.tasks.getInstanceId(),
          pid: process.pid,
          acquiredAt: startedAt,
          expiresAt: startedAt + Math.max(30_000, plan.limits.timeoutMs),
          lastHeartbeatAt: startedAt,
        },
      };
      options.tasks.upsert(initialRecord);
      options.tasks.registerControl(childTaskId, { cancel: () => childController.abort() });
    }

    for (let step = 0; step < plan.limits.maxSteps; step += 1) {
      if (this.deps.isStopped()) {
        return finishTask('cancelled', 'Emergency stop was pressed.');
      }
      if (childController.signal.aborted) {
        return finishTask('cancelled', 'Cancelled by parent task or user.');
      }

      const currentNow = nowFn();
      const elapsed = currentNow - startedAt;
      if (elapsed > plan.limits.timeoutMs) {
        return finishTask('failed', `Time limit of ${String(plan.limits.timeoutMs)} ms reached.`);
      }

      if (tokensUsed >= plan.limits.maxTokens) {
        return finishTask('failed', 'Token budget exhausted.');
      }

      options.tasks?.recordHeartbeat(childTaskId, 30_000, currentNow);
      options.onHeartbeat?.({ taskId: childTaskId, specialist: plan.specialist, step, at: currentNow });

      let next: { tool: string; args: Record<string, unknown> } | null;
      try {
        next = await work(step, childController.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (childController.signal.aborted) return finishTask('cancelled', 'Cancelled while planning next step.');
        return finishTask('failed', message);
      }

      if (next === null) {
        return finishTask('completed');
      }

      if (this.deps.isStopped() || childController.signal.aborted) {
        return finishTask('cancelled', 'Cancelled before tool invocation.');
      }

      // The allowlist is enforced here, so a compromised or confused model cannot
      // reach a tool the plan did not grant.
      if (DELEGATION_BLOCKED_TOOLS.has(next.tool)) {
        return finishTask('refused', `"${next.tool}" is blocked: nested delegation is disabled.`);
      }
      if (!plan.tools.includes(next.tool) && !plan.approvalTools.includes(next.tool)) {
        return finishTask('refused', `"${next.tool}" was not granted to the ${plan.specialist} specialist.`);
      }

      const stepId = `${childTaskId}_step_${step + 1}`;
      const stepRecord: TaskStep = {
        id: stepId,
        title: `Run ${next.tool}`,
        status: 'running',
        toolName: next.tool,
        args: next.args,
        startedAt: nowFn(),
      };
      taskSteps.push(stepRecord);
      options.tasks?.update(childTaskId, { steps: [...taskSteps] });

      let result: { ok: boolean; content: string };
      try {
        result = await this.deps.invokeTool(next.tool, next.args, {
          signal: childController.signal,
          taskId: childTaskId,
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stepRecord.status = 'failed';
        stepRecord.endedAt = nowFn();
        stepRecord.detail = message;
        failedOperations.push(`${next.tool}: ${message}`);
        options.tasks?.update(childTaskId, { steps: [...taskSteps] });
        if (childController.signal.aborted || this.deps.isStopped()) {
          return finishTask('cancelled', 'Cancelled during tool execution.');
        }
        return finishTask('failed', message);
      }

      steps += 1;
      tokensUsed += Math.ceil((result.content.length + JSON.stringify(next.args).length) / 4);
      stepRecord.endedAt = nowFn();

      if (result.ok) {
        stepRecord.status = 'verified';
        stepRecord.detail = result.content.slice(0, 500);
        findings.push(result.content.slice(0, MAX_FINDING_CHARS));
      } else {
        stepRecord.status = 'failed';
        stepRecord.detail = result.content.slice(0, 500);
        failedOperations.push(`${next.tool}: ${result.content.slice(0, 300)}`);
        if (result.content.includes('denied')) {
          options.tasks?.update(childTaskId, { steps: [...taskSteps] });
          return finishTask('refused', `A tool call was denied: ${result.content}`);
        }
      }
      options.tasks?.update(childTaskId, { steps: [...taskSteps] });
    }

    return finishTask('completed');
  }

  /**
   * Executes multiple independent specialist subtasks in parallel with a hard
   * concurrency ceiling (`MAX_CONCURRENT_SPECIALISTS = 3`), parent-child
   * cancellation propagation, and conflict-preserving consolidation.
   */
  async delegateParallel(
    items: ParallelDelegationItem[],
    options: DelegateExecutionOptions & { maxConcurrency?: number } = {},
  ): Promise<ConsolidatedDelegationReport> {
    const nowFn = this.deps.now ?? Date.now;
    const startedAt = nowFn();
    const limit = Math.max(1, Math.min(MAX_CONCURRENT_SPECIALISTS, Math.floor(options.maxConcurrency ?? MAX_CONCURRENT_SPECIALISTS)));
    const results: DelegationResult[] = new Array(items.length);
    let cursor = 0;
    let activeNow = 0;
    let peakConcurrency = 0;

    const batchController = new AbortController();
    const onParentAbort = (): void => batchController.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    if (options.signal?.aborted) batchController.abort();

    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (!item) continue;
        activeNow += 1;
        if (activeNow > peakConcurrency) peakConcurrency = activeNow;
        try {
          results[index] = await this.delegate(item.plan, item.work, {
            ...options,
            signal: batchController.signal,
          });
        } finally {
          activeNow -= 1;
        }
      }
    };

    try {
      const workerCount = Math.min(limit, items.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      options.signal?.removeEventListener('abort', onParentAbort);
    }

    return consolidateDelegationResults(results, {
      parentTaskId: options.parentTaskId,
      maxConcurrencyUsed: peakConcurrency,
      durationMs: Math.max(0, nowFn() - startedAt),
    });
  }
}

export function validateDelegationResult(result: DelegationResult): DelegationResult {
  const validStatuses = new Set(['completed', 'failed', 'cancelled', 'refused']);
  if (!validStatuses.has(result.status)) {
    throw new Error(`Invalid delegation result status: ${String(result.status)}`);
  }
  return {
    ...result,
    objective: result.objective.slice(0, 500),
    steps: Math.max(0, Math.floor(result.steps)),
    tokensUsed: Math.max(0, Math.floor(result.tokensUsed)),
    findings: result.findings.map((finding) => finding.slice(0, MAX_FINDING_CHARS)).slice(0, 50),
    ...(result.failure ? { failure: result.failure.slice(0, 2_000) } : {}),
  };
}

export function consolidateDelegationResults(
  results: DelegationResult[],
  meta: { parentTaskId?: string; maxConcurrencyUsed: number; durationMs: number },
): ConsolidatedDelegationReport {
  const consolidatedFindings: string[] = [];
  const conflicts: string[] = [];
  let totalChars = 0;

  const completed = results.filter((r) => r.status === 'completed');
  const cancelled = results.filter((r) => r.status === 'cancelled');
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'refused');

  for (const item of completed) {
    for (const finding of item.findings) {
      const tagged = `[${item.specialist}] ${finding}`;
      if (totalChars + tagged.length <= MAX_CONSOLIDATED_SUMMARY_CHARS) {
        consolidatedFindings.push(tagged);
        totalChars += tagged.length;
      }
    }
  }

  // Surface disagreements honestly when multiple specialists produce differing findings on overlapping work.
  if (completed.length >= 2) {
    const summaries = completed.map((item) => ({
      specialist: item.specialist,
      text: item.findings.join(' ').trim().toLowerCase(),
    }));
    const hasNegationDisagreement = summaries.some((a, i) =>
      summaries.slice(i + 1).some((b) =>
        (a.text.includes('not ') !== b.text.includes('not '))
        || (a.text.includes('failed') && b.text.includes('passed'))
        || (a.text.includes('passed') && b.text.includes('failed')),
      ),
    );
    if (hasNegationDisagreement) {
      conflicts.push(
        `Specialists (${completed.map((c) => c.specialist).join(', ')}) returned potentially conflicting findings; review individual specialist outputs before drawing a single conclusion.`,
      );
    }
  }

  const incompleteCount = results.length - completed.length;
  const status: ConsolidatedDelegationReport['status'] =
    incompleteCount === 0
      ? 'completed'
      : cancelled.length === results.length
        ? 'cancelled'
        : completed.length > 0
          ? 'partial_failure'
          : failed.length > 0
            ? 'failed'
            : 'cancelled';

  return {
    ...(meta.parentTaskId ? { parentTaskId: meta.parentTaskId } : {}),
    status,
    results,
    consolidatedFindings,
    conflicts,
    incompleteCount,
    maxConcurrencyUsed: meta.maxConcurrencyUsed,
    durationMs: meta.durationMs,
  };
}

/** Find the specialist that owns a tool, for routing the model's request. */
export function specialistForTool(tool: string, registry: ToolRegistry): SpecialistId | null {
  const candidates = SPECIALIST_IDS.filter((id) =>
    SPECIALISTS[id].allowedTools.includes(tool),
  );
  if (candidates.length === 0) return null;
  // Prefer the specialist whose allowlist is the tightest fit.
  candidates.sort(
    (a, b) => SPECIALISTS[a].allowedTools.length - SPECIALISTS[b].allowedTools.length,
  );
  return registry.get(tool) ? candidates[0] : null;
}
