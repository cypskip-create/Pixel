/**
 * The agent execution loop.
 *
 * Turns a single user request into a bounded sequence of model turns and real
 * tool executions:
 *
 *   model -> tool calls -> policy check -> approval? -> execute -> tool result
 *         -> model -> ... -> final answer
 *
 * Non-negotiables encoded here:
 *  - Every tool call is authorized by the local policy, never by the model.
 *  - A call that needs approval suspends the loop until the user decides.
 *  - A denial is reported to the model as a failure, not silently skipped.
 *  - The loop is bounded by step count, wall clock, and the emergency stop.
 *  - Every step is recorded in the audit trail and persisted with the task.
 *
 * Tool failures are results, not crashes: the model is told what went wrong so it
 * can choose a different approach instead of the loop dying.
 */

import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  ChatRequest,
  CypsErrorCode,
  EmergencyStopReport,
  Mode,
  PermissionRequest,
  StreamEvent,
  TaskRecord,
  TaskStep,
  ThinkingConfig,
  ToolCall,
  ToolDefinition,
} from '../../shared/types';
import { getModeDescriptor } from '../../shared/types';
import { redactTaskText } from '../tasks/schema';
import type { TurnOutcome } from './conversation';
import { buildAgentMessages, clipToolResult, errorEvent } from './conversation';
import type { RunTurnOptions } from './conversation';
import type { ToolResult } from './executors';
import type { AuditLog, PermissionBroker, TaskManager } from './runtime';
import { ToolRegistry } from './tools';
import { deriveGrantScope, describeScope } from './scope';

/** Hard ceiling on model turns per request. */
export const MAX_STEPS = 8;

/** Wall clock ceiling for a whole request, including tool time. */
export const TURN_TIMEOUT_MS = 5 * 60_000;

/** Per-tool execution ceiling. */
export const TOOL_TIMEOUT_MS = 30_000;
const REOBSERVATION_TOOLS = new Set(['analyze_screen', 'get_foreground_window', 'get_last_external_foreground_window', 'list_external_windows', 'find_ui_elements', 'screen_highlight_control', 'verify_ui_state', 'browser_inspect', 'browser_verify', 'file_read', 'documents_search', 'documents_list']);

/** The one thing the agent needs from the conversation engine. */
export interface TurnRunner {
  runTurn(options: RunTurnOptions): Promise<TurnOutcome>;
  abort?(): void;
}

/** The one thing the agent needs from the tool executors. */
export interface ToolRunner {
  run(name: string, args: Record<string, unknown>, signal?: AbortSignal, context?: { taskId: string }): Promise<ToolResult>;
  killAll(): number;
}

export interface AgentDeps {
  engine: TurnRunner;
  registry: ToolRegistry;
  permissions: PermissionBroker;
  tasks: TaskManager;
  audit: AuditLog;
  executors: ToolRunner;
  /** Emits stream events to the UI. */
  emit: (event: StreamEvent) => void;
  /** True once emergency stop has been pressed. */
  isStopped: () => boolean;
  /** Persists the finished task; injected so this module stays storage-agnostic. */
  persist?: (task: TaskRecord) => void;
  getProjectId?: () => string;
}

export const MAX_TASK_MODEL_TOKENS = 32_000;

export interface AgentRunOptions {
  requestId: string;
  request: ChatRequest;
  model: string;
  thinking?: ThinkingConfig;
  temperature?: number;
  maxTokens?: number;
  /** Restricts a scheduled or delegated run to an approved capability set. */
  allowedTools?: string[];
}

export interface AgentRunResult {
  task: TaskRecord;
  finalContent: string;
  /** Tool results in execution order, for the audit trail. */
  executed: Array<{ name: string; ok: boolean; summary: string }>;
  aborted: boolean;
  failure?: CypsErrorCode;
}

export class AgentExecutor {
  private readonly deps: AgentDeps;
  /** Volatile window identity is kept only while this task run is active. */
  private readonly uiActionTargets = new Map<string, { windowId: string; processId: number; processName: string }>();
  private controller: AbortController | null = null;
  private active = false;
  private cancelReason: 'user' | 'stop' | 'timeout' | null = null;

  constructor(deps: AgentDeps) {
    this.deps = deps;
  }

  get isRunning(): boolean {
    return this.active;
  }

  /** Cancel the in-flight run. Safe when idle. */
  cancel(reason: 'user' | 'stop' | 'timeout' = 'user'): void {
    this.cancelReason = reason;
    this.controller?.abort();
    this.deps.engine.abort?.();
    this.deps.permissions.rejectPending();
  }

  /**
   * Run one user request to completion.
   * Never throws: all failures are reported through the returned result and
   * through stream events.
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { requestId, request } = options;
    const { tasks, audit, emit, isStopped } = this.deps;

    if (this.active) {
      emit(errorEvent(requestId, 'BAD_REQUEST', 'Pixel is already working on something. Wait, or press stop.'));
      return this.emptyResult('BAD_REQUEST');
    }

    if (isStopped()) {
      emit(
        errorEvent(
          requestId,
          'ABORTED',
          'Emergency stop is active. Clear it before asking Pixel to do anything.',
        ),
      );
      return this.emptyResult('ABORTED');
    }

    this.active = true;
    this.cancelReason = null;
    const controller = new AbortController();
    this.controller = controller;
    const deadlineTimer = setTimeout(() => {
      if (this.controller !== controller || controller.signal.aborted) return;
      this.cancelReason = 'timeout';
      controller.abort();
    }, TURN_TIMEOUT_MS);

    const startedAt = Date.now();
    const deadline = startedAt + TURN_TIMEOUT_MS;
    const executed: AgentRunResult['executed'] = [];

    const task: TaskRecord = {
      id: `task_${startedAt.toString(36)}_${randomUUID().slice(0, 8)}`,
      title: deriveTitle(redactTaskText(request.text)),
      status: 'running',
      steps: [],
      createdAt: startedAt,
      request: redactTaskText(request.text),
      ...(this.deps.getProjectId ? { projectId: this.deps.getProjectId() } : {}),
      ...(options.allowedTools ? { allowedTools: [...new Set(options.allowedTools)].slice(0, 100) } : {}),
      budget: {
        deadlineAt: deadline,
        maxTurns: MAX_STEPS,
        turnsUsed: 0,
        retryCount: 0,
        maxRetries: 0,
        maxModelTokens: MAX_TASK_MODEL_TOKENS,
        modelTokensUsed: 0,
      },
      approvalRefs: [],
      evidence: [],
      pendingVerifications: [],
    };
    tasks.upsert(task);
    tasks.registerControl(task.id, { cancel: () => this.cancel('user') });
    audit.record('model', 'Agent run started', 'ok', redactTaskText(request.text).slice(0, 120));

    // System prompt + trimmed history + the new user turn. Per-step tool
    // messages are appended below; they stay paired with their tool calls and
    // each result is clipped so one large page cannot blow the context window.
    let messages: ChatMessage[] = [];

    let finalContent = '';
    let stepIndex = 0;

    try {
      messages = buildAgentMessages(request);
      for (stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
        const runnable = await tasks.waitUntilRunnable(task.id, 'before_model', controller.signal);
        if (!runnable) {
          return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
        }
        if (this.shouldStop()) {
          return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
        }
        if (Date.now() > deadline) {
          this.cancelReason = 'timeout';
          this.cancel('timeout');
          return this.finish(requestId, task, executed, finalContent, 'failed', true, 'TIMEOUT');
        }

        const budget = task.budget;
        const estimatedInput = estimateMessageTokens(messages);
        if (budget && budget.modelTokensUsed + estimatedInput > budget.maxModelTokens) {
          return this.finish(
            requestId,
            task,
            executed,
            finalContent,
            'failed',
            false,
            'BAD_REQUEST',
            `Pixel stopped before another model turn because its estimated ${String(MAX_TASK_MODEL_TOKENS)}-token task budget was reached.`,
          );
        }
        if (budget) {
          task.budget = {
            ...budget,
            turnsUsed: stepIndex + 1,
            modelTokensUsed: budget.modelTokensUsed + estimatedInput,
          };
          tasks.update(task.id, { budget: task.budget });
        }

        const outcome: TurnOutcome = await this.deps.engine.runTurn({
          requestId,
          request,
          model: options.model,
          ...(options.thinking ? { thinking: options.thinking } : {}),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          messages,
        });

        finalContent = outcome.content.length > 0 ? outcome.content : finalContent;
        if (task.budget && (outcome.content.length > 0 || outcome.reasoning.length > 0)) {
          task.budget = {
            ...task.budget,
            modelTokensUsed: Math.min(
              task.budget.maxModelTokens,
              task.budget.modelTokensUsed + estimateTextTokens(outcome.content + outcome.reasoning),
            ),
          };
          tasks.update(task.id, { budget: task.budget });
        }

        if (outcome.failed) {
          return this.finish(requestId, task, executed, finalContent, 'failed', false, 'UNKNOWN');
        }
        if (outcome.aborted || this.shouldStop()) {
          return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
        }

        // No tool calls: the model answered. Done.
        if (outcome.toolCalls.length === 0) {
          if (tasks.get(task.id)?.reobserveRequired) {
            const warning = 'Pixel is waiting for a fresh observation after your handoff. The environment was not rechecked, so this task is blocked.';
            return this.finish(requestId, task, executed, [finalContent, warning].filter(Boolean).join('\n\n'), 'blocked', false);
          }
          const pending = task.pendingVerifications ?? [];
          if (pending.length > 0) {
            const latest = pending[pending.length - 1];
            const unverifiedTitle = task.steps.find((item) => item.id === latest?.stepId)?.title ?? latest?.toolName ?? 'unknown action';
            const warning = `Pixel performed the requested action, but could not verify the result. Please check it before treating this task as complete. Unverified step: ${unverifiedTitle}.`;
            return this.finish(requestId, task, executed, [finalContent, warning].filter(Boolean).join('\n\n'), 'blocked', false);
          }
          return this.finish(requestId, task, executed, finalContent, 'completed', false);
        }

        // Record the assistant turn verbatim, including its tool calls, so the
        // tool results that follow have a valid parent.
        messages.push({
          id: `${requestId}_a${stepIndex}`,
          role: 'assistant',
          content: outcome.content,
          ...(outcome.reasoning ? { reasoning: outcome.reasoning } : {}),
          toolCalls: outcome.toolCalls,
          createdAt: Date.now(),
        });

        for (const call of outcome.toolCalls) {
          if (this.shouldStop() || Date.now() > deadline) break;

          const toolRunnable = await tasks.waitUntilRunnable(task.id, 'before_tool', controller.signal);
          if (!toolRunnable) {
            return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
          }

          const outcomeStep = await this.executeCall(call, request.mode, task, messages);
          const currentTask = tasks.get(task.id);
          task.reobserveRequired = currentTask?.reobserveRequired;
          if (task.reobserveRequired && REOBSERVATION_TOOLS.has(call.name) && outcomeStep.record.ok) {
            task.reobserveRequired = false;
            tasks.update(task.id, { reobserveRequired: false });
          }
          executed.push(outcomeStep.record);
          messages.push(outcomeStep.message);

          if (outcomeStep.cancelled) {
            return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
          }
        }
      }

      // Step ceiling reached without a final answer.
      audit.record('model', 'Step limit reached', 'error', `after ${MAX_STEPS} steps`);
      return this.finish(
        requestId,
        task,
        executed,
        finalContent,
        'failed',
        false,
        'BAD_REQUEST',
        `Pixel stopped after ${MAX_STEPS} steps without finishing. Ask it to continue, or narrow the request.`,
      );
    } catch (error) {
      const wasCancelled = this.shouldStop();
      if (!wasCancelled) {
        const detail = redactTaskText(error instanceof Error ? error.message : String(error)).slice(0, 500);
        audit.record('system', 'Agent run failed unexpectedly', 'error', detail);
      }
      return this.finish(
        requestId,
        task,
        executed,
        finalContent,
        wasCancelled ? 'cancelled' : 'failed',
        wasCancelled,
        wasCancelled ? undefined : 'UNKNOWN',
        wasCancelled ? undefined : 'Pixel stopped after an unexpected internal error. See the local audit log for a redacted summary.',
      );
    } finally {
      clearTimeout(deadlineTimer);
      this.uiActionTargets.clear();
      tasks.unregisterControl(task.id);
      this.active = false;
      if (this.controller === controller) this.controller = null;
      const reason = this.cancelReason;
      this.cancelReason = null;
      void reason;
    }
  }

  /* ------------------------------ internals --------------------------- */

  private shouldStop(): boolean {
    return this.controller?.signal.aborted === true || this.deps.isStopped();
  }

  /**
   * Authorize and execute one tool call, returning both the message to append
   * and the record for the audit trail.
   */
  private async executeCall(
    call: ToolCall,
    mode: Mode,
    task: TaskRecord,
    _messages: ChatMessage[],
  ): Promise<{
    message: ChatMessage;
    record: AgentRunResult['executed'][number];
    cancelled: boolean;
  }> {
    const { registry, permissions, audit, executors, tasks } = this.deps;

    const tool: ToolDefinition | undefined = registry.get(call.name);
    task.reobserveRequired = tasks.get(task.id)?.reobserveRequired;
    const args = parseArgs(call);

    const step: TaskStep = {
      id: `${task.id}_s${task.steps.length + 1}`,
      title: describeCall(call.name, args),
      status: 'running',
      toolName: call.name,
      args: safeTaskArgs(call.name, args),
      startedAt: Date.now(),
    };
    task.steps.push(step);
    tasks.update(task.id, { steps: [...task.steps] });

    const toolMessage = (content: string): ChatMessage => ({
      id: `${call.id}_result`,
      role: 'tool',
      content: clipToolResult(content),
      toolCallId: call.id,
      createdAt: Date.now(),
    });

    // 1. Unknown tool.
    if (!tool) {
      const text = `Error: Pixel has no tool named "${call.name}".`;
      this.failStep(step, task, text);
      audit.record('tool', `Unknown tool: ${call.name}`, 'denied');
      return {
        message: toolMessage(text),
        record: { name: call.name, ok: false, summary: 'unknown tool' },
        cancelled: false,
      };
    }

    if (task.allowedTools && !task.allowedTools.includes(call.name)) {
      const text = `Error: this task is limited to its approved tools and cannot use "${call.name}".`;
      this.failStep(step, task, text);
      audit.record('tool', `Blocked outside task capability set: ${call.name}`, 'denied');
      return {
        message: toolMessage(text),
        record: { name: call.name, ok: false, summary: 'outside task capability set' },
        cancelled: false,
      };
    }

    const validation = registry.validateArgs(call.name, args);
    if (!validation.ok) {
      const text = `Error: Pixel refused invalid arguments for "${call.name}": ${validation.message}`;
      this.failStep(step, task, text);
      audit.record('tool', `Invalid arguments: ${call.name}`, 'denied');
      return {
        message: toolMessage(text),
        record: { name: call.name, ok: false, summary: 'invalid arguments' },
        cancelled: false,
      };
    }

    if (task.reobserveRequired && !REOBSERVATION_TOOLS.has(call.name)) {
      const text = 'Pixel must re-observe the current environment after the human handoff before taking any further action. Use an observation tool first.';
      this.failStep(step, task, text);
      audit.record('tool', `Blocked pending re-observation: ${call.name}`, 'denied');
      return {
        message: toolMessage(text),
        record: { name: call.name, ok: false, summary: 're-observation required' },
        cancelled: false,
      };
    }

    // 2. Policy: mode, emergency stop, and whether approval is required.
    const decision = registry.evaluate(call.name, mode, args);
    if (!decision.allowed) {
      if (decision.needsApproval) {
        const request = buildPermissionRequest(tool, args);
        task.approvalRefs = [...(task.approvalRefs ?? []), request.id];
        task.status = 'awaiting_approval';
        task.checkpoint = {
          phase: 'awaiting_approval',
          at: Date.now(),
          summary: `Waiting for approval to run ${call.name}.`,
        };
        tasks.update(task.id, {
          status: task.status,
          approvalRefs: task.approvalRefs,
          checkpoint: task.checkpoint,
        });
        const resolved = await permissions.ask(request, this.controller?.signal);
        task.status = 'running';
        tasks.update(task.id, { status: task.status });

        // A pending approval that is interrupted by stop/timeout must not hang.
        if (this.shouldStop()) {
          permissions.rejectPending();
          consumeOnceGrant(permissions, call.name);
          const text = 'Error: the run was cancelled before this action was approved.';
          this.failStep(step, task, text);
          return {
            message: toolMessage(text),
            record: { name: call.name, ok: false, summary: 'cancelled during approval' },
            cancelled: true,
          };
        }

        if (!resolved.approved) {
          const text = `Error: the user denied permission to run "${call.name}". Do not retry this action unless the user asks.`;
          this.failStep(step, task, text);
          audit.record('tool', `Denied: ${call.name}`, 'denied');
          return {
            message: toolMessage(text),
            record: { name: call.name, ok: false, summary: 'denied by user' },
            cancelled: false,
          };
        }

        // Approval grants are stored by the broker; re-check so that a 'once'
        // grant cannot be reused by a second identical call.
        const recheck = registry.evaluate(call.name, mode, args);
        if (!recheck.allowed) {
          const text = `Error: "${call.name}" still cannot run: ${recheck.reason}`;
          this.failStep(step, task, text);
          return {
            message: toolMessage(text),
            record: { name: call.name, ok: false, summary: 'still unauthorized' },
            cancelled: false,
          };
        }
      } else {
        const text = `Error: ${decision.reason}`;
        this.failStep(step, task, text);
        audit.record('tool', `Blocked: ${call.name}`, 'denied', decision.reason);
        return {
          message: toolMessage(text),
          record: { name: call.name, ok: false, summary: decision.reason },
          cancelled: false,
        };
      }
    }

    // Approval may itself be the point at which the user asks Pixel to pause.
    // Re-enter the checkpoint gate after the prompt so an approved action does
    // not slip through while the task is paused.
    const runnable = await tasks.waitUntilRunnable(
      task.id,
      'before_tool',
      this.controller?.signal ?? new AbortController().signal,
    );
    if (!runnable) {
      consumeOnceGrant(permissions, call.name);
      const text = 'Error: the run was cancelled before this action started.';
      this.failStep(step, task, text);
      return {
        message: toolMessage(text),
        record: { name: call.name, ok: false, summary: 'cancelled before execution' },
        cancelled: true,
      };
    }

    // 3. Execute for real, with a timeout.
    const actionTimeoutMs = call.name === 'request_human_takeover'
      ? Math.max(1, (task.budget?.deadlineAt ?? (Date.now() + TURN_TIMEOUT_MS)) - Date.now())
      : TOOL_TIMEOUT_MS;
    const result = await runWithDeadline(
      (signal) => executors.run(call.name, args, signal, { taskId: task.id }),
      actionTimeoutMs,
      `"${call.name}" took too long and was stopped.`,
      this.controller?.signal,
    );

    const succeeded = result.ok;
    step.status = succeeded ? (result.verification ? 'verified' : 'done') : 'failed';
    step.endedAt = Date.now();
    step.detail = summariseResult(result);
    task.steps[task.steps.length - 1] = step;

    if (succeeded && tool.changesState) {
      if (result.verification) {
        addTaskEvidence(task, 'verification', result.verification.summary, result.verification.source);
        task.pendingVerifications = (task.pendingVerifications ?? []).filter((item) => item.stepId !== step.id);
      } else {
        const expectedResult = call.name === 'invoke_ui_element' && args.expectedResult && typeof args.expectedResult === 'object'
          ? args.expectedResult as Record<string, unknown>
          : undefined;
        task.pendingVerifications = [
          ...(task.pendingVerifications ?? []),
          {
            stepId: step.id,
            toolName: call.name,
            ...(call.name === 'invoke_ui_element' ? {
              expectedWindowTitle: typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '',
              ...(typeof expectedResult?.selector === 'string' ? { verificationSelector: expectedResult.selector } : {}),
              ...(typeof expectedResult?.role === 'string' ? { verificationRole: expectedResult.role } : {}),
              ...(expectedResult?.state === 'present' || expectedResult?.state === 'absent' ? { verificationState: expectedResult.state } : {}),
            } : {}),
          },
        ];
        if (call.name === 'invoke_ui_element' && typeof args.targetWindowId === 'string' &&
          typeof args.expectedProcessId === 'number' && typeof args.expectedProcessName === 'string') {
          this.uiActionTargets.set(step.id, {
            windowId: args.targetWindowId,
            processId: args.expectedProcessId,
            processName: args.expectedProcessName,
          });
        }
      }
    }

    if (call.name === 'browser_verify' && succeeded && result.verification) {
      const pending = [...(task.pendingVerifications ?? [])];
      let lastBrowserActionIndex = -1;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const item = pending[index];
        if (item?.toolName === 'browser_click' || item?.toolName === 'browser_type') {
          lastBrowserActionIndex = index;
          break;
        }
      }
      if (lastBrowserActionIndex >= 0) {
        const [verifiedAction] = pending.splice(lastBrowserActionIndex, 1);
        if (verifiedAction) {
          const verifiedStep = task.steps.find((item) => item.id === verifiedAction.stepId);
          if (verifiedStep) verifiedStep.status = 'verified';
          addTaskEvidence(task, 'verification', result.verification.summary, result.verification.source);
          task.pendingVerifications = pending;
        }
      }
    }

    if (call.name === 'verify_ui_state' && succeeded && result.verification) {
      const pending = [...(task.pendingVerifications ?? [])];
      const selector = typeof args.selector === 'string' ? args.selector : '';
      const expectedWindowTitle = typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '';
      const state = args.state === 'absent' ? 'absent' : 'present';
      const role = typeof args.role === 'string' ? args.role : undefined;
      let matchingIndex = -1;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const item = pending[index];
        const target = item ? this.uiActionTargets.get(item.stepId) : undefined;
        if (item?.toolName === 'invoke_ui_element' &&
          target !== undefined &&
          item.expectedWindowTitle === expectedWindowTitle &&
          target?.windowId === args.targetWindowId &&
          target.processId === args.expectedProcessId &&
          target.processName === args.expectedProcessName &&
          item.verificationSelector?.toLowerCase() === selector.toLowerCase() &&
          item.verificationState === state &&
          item.verificationRole?.toLowerCase() === role?.toLowerCase()) {
          matchingIndex = index;
          break;
        }
      }
      if (matchingIndex >= 0) {
        const [verifiedAction] = pending.splice(matchingIndex, 1);
        if (verifiedAction) {
          const verifiedStep = task.steps.find((item) => item.id === verifiedAction.stepId);
          if (verifiedStep) verifiedStep.status = 'verified';
          this.uiActionTargets.delete(verifiedAction.stepId);
          addTaskEvidence(task, 'verification', result.verification.summary, result.verification.source);
          task.pendingVerifications = pending;
        }
      }
    }

    if (result.errorCode === 'TIMEOUT' || result.errorCode === 'CANCELLED' || result.errorCode === 'CRASHED') {
      task.recoveryNote = 'The operation was interrupted and may have partly completed. Re-observe its target before retrying.';
    }

    tasks.update(task.id, { steps: [...task.steps] });

    audit.record(
      'tool',
      `${succeeded ? 'Ran' : 'Failed'}: ${call.name}`,
      succeeded ? 'ok' : 'error',
      summariseResult(result),
    );

    // A 'once' grant is consumed by use.
    consumeOnceGrant(permissions, call.name);

    return {
      message: toolMessage(succeeded ? result.content : `Error: ${result.content}`),
      record: {
        name: call.name,
        ok: succeeded,
        summary: summariseResult(result),
      },
      cancelled: false,
    };
  }

  private failStep(step: TaskStep, task: TaskRecord, _reason: string): void {
    step.status = 'failed';
    step.endedAt = Date.now();
    task.steps[task.steps.length - 1] = step;
    this.deps.tasks.update(task.id, { steps: [...task.steps] });
  }

  private finish(
    requestId: string,
    task: TaskRecord,
    executed: AgentRunResult['executed'],
    finalContent: string,
    status: TaskRecord['status'],
    aborted: boolean,
    failure?: CypsErrorCode,
    errorText?: string,
  ): AgentRunResult {
    const timedOut = status === 'cancelled' && this.cancelReason === 'timeout';
    const finalStatus = timedOut ? 'failed' : status;
    const finalFailure = failure ?? (timedOut ? 'TIMEOUT' : undefined);
    const finalErrorText = errorText ?? (timedOut ? 'Pixel stopped because this task exceeded its time limit.' : undefined);
    const finished: TaskRecord = {
      ...task,
      status: finalStatus,
      result: redactTaskText(finalContent),
      endedAt: Date.now(),
      steps: [...task.steps],
    };
    this.deps.tasks.upsert(finished);
    if (this.deps.persist) {
      try {
        this.deps.persist(finished);
      } catch {
        // Persistence is a convenience; a failed write must not fail the run.
      }
    }
    this.deps.audit.record(
      'model',
      `Agent run ${finalStatus}`,
      finalStatus === 'completed' ? 'ok' : finalStatus === 'cancelled' ? 'cancelled' : 'error',
      `${executed.length} tool call(s)`,
    );
    if (finalErrorText) {
      this.deps.emit({
        type: 'error',
        requestId,
        code: finalFailure ?? 'UNKNOWN',
        message: finalErrorText,
      });
    } else if (finalStatus === 'cancelled') {
      // Without this the UI would keep showing a spinner after a stop.
      this.deps.emit({ type: 'aborted', requestId, hadContent: finalContent.length > 0 });
    }
    return { task: finished, finalContent, executed, aborted, ...(finalFailure ? { failure: finalFailure } : {}) };
  }

  private emptyResult(failure: CypsErrorCode): AgentRunResult {
    const now = Date.now();
    return {
      task: {
        id: `task_${now.toString(36)}`,
        title: 'Not started',
        status: 'failed',
        steps: [],
        createdAt: now,
        endedAt: now,
      },
      finalContent: '',
      executed: [],
      aborted: failure === 'ABORTED',
      failure,
    };
  }
}

/* -------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------- */

/** Parse tool arguments defensively: malformed JSON is a tool error, not a crash. */
export function parseArgs(call: ToolCall): Record<string, unknown> {
  if (call.arguments) return call.arguments;
  try {
    const parsed: unknown = JSON.parse(call.argumentsJson || '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Human sentence for the task rail: what Pixel is about to do. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'get_current_time':
      return 'Checked the time';
    case 'get_system_info':
      return 'Read system information';
    case 'analyze_screen':
      return 'Looked at the screen';
    case 'screen_highlight_control':
      return 'Highlight an exact accessible control';
    case 'screen_clear_annotations':
      return 'Clear visual guidance';
    case 'get_foreground_window':
      return 'Read the foreground window title and bounds';
    case 'get_last_external_foreground_window':
      return 'Read the last non-Pixel foreground window';
    case 'list_external_windows':
      return 'List visible non-Pixel windows for target selection';
    case 'find_ui_elements':
      return `Find UI elements matching ${typeof args.text === 'string' ? args.text : 'the requested text'}`;
    case 'verify_ui_state':
      return `Verify ${typeof args.selector === 'string' ? args.selector : 'the requested UI element'} is ${args.state === 'absent' ? 'absent' : 'present'} in the foreground window`;
    case 'invoke_ui_element':
      {
        const expected = args.expectedResult && typeof args.expectedResult === 'object' ? args.expectedResult as Record<string, unknown> : {};
        const expectedRole = typeof expected.role === 'string' ? ` (${expected.role})` : '';
        return `Invoke ${typeof args.selector === 'string' ? args.selector : 'the selected control'}; then verify ${String(expected.selector ?? 'the specified UI state')}${expectedRole} is ${expected.state === 'absent' ? 'absent' : 'present'}`;
      }
    case 'open_application':
      return `Open ${typeof args.name === 'string' ? args.name : 'an application'}`;
    case 'browser_open_search':
      return `Open browser search for “${typeof args.query === 'string' ? args.query.trim().slice(0, 120) : 'the requested query'}”`;
    case 'type_text': {
      return `Type ${typeof args.text === 'string' ? args.text.length : 0} approved characters into the specified foreground window`;
    }
    case 'file_list':
      return `List files in ${typeof args.directory === 'string' ? args.directory : 'a folder'}`;
    case 'file_read':
      return `Read file ${typeof args.path === 'string' ? args.path : '(unknown path)'}`;
    case 'file_write':
      return `${args.overwrite === true ? 'Replace' : 'Create'} file ${typeof args.path === 'string' ? args.path : '(unknown path)'}`;
    default:
      return name;
  }
}

/** Build the permission request shown to the user. */
export function buildPermissionRequest(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): PermissionRequest {
  const scope = deriveGrantScope(tool.name, args);
  const allowPersistent = tool.risk !== 'high' && Object.keys(scope).length > 0;
  return {
    id: `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    toolName: tool.name,
    action: describeCall(tool.name, args),
    target: targetFor(tool.name, args),
    changesData: tool.changesState,
    risk: tool.risk,
    duration: 'once',
    args,
    createdAt: Date.now(),
    allowPersistent,
    scopeLabel: allowPersistent ? describeScope(scope) : 'this exact action, one time',
  };
}

function targetFor(name: string, args: Record<string, unknown>): string {
  if (name === 'analyze_screen') return 'this screen';
  if (name === 'browser_navigate' && typeof args.url === 'string') return args.url;
  if (name === 'browser_open_search' && typeof args.query === 'string') return `Search: ${args.query.trim().slice(0, 120)}`;
  if (name === 'documents_index' && typeof args.directory === 'string') return args.directory;
  if (name === 'open_application' && typeof args.name === 'string') return args.name;
  if (name === 'get_last_external_foreground_window') return 'the last observed non-Pixel foreground window';
  if (name === 'list_external_windows') return 'visible non-Pixel windows on this desktop';
  if (name === 'type_text') return describeWindowTarget(args);
  if (name === 'get_foreground_window') return 'the foreground window';
  if (name === 'find_ui_elements') return typeof args.targetWindowId === 'string' ? describeWindowTarget(args) : 'the foreground window';
  if (name === 'invoke_ui_element' || name === 'verify_ui_state') return describeWindowTarget(args);
  if (name === 'file_list' && typeof args.directory === 'string') return args.directory;
  if ((name === 'file_read' || name === 'file_write') && typeof args.path === 'string') return args.path;
  return 'this computer';
}

function describeWindowTarget(args: Record<string, unknown>): string {
  const processName = typeof args.expectedProcessName === 'string' ? args.expectedProcessName : 'application';
  const pid = Number.isInteger(args.expectedProcessId) ? ` (PID ${String(args.expectedProcessId)})` : '';
  const title = typeof args.expectedWindowTitle === 'string' ? args.expectedWindowTitle : '(untitled)';
  const windowId = typeof args.targetWindowId === 'string' ? `; ref ${args.targetWindowId}` : '';
  return `${processName}${pid}, window titled "${title}"${windowId}`;
}

function summariseResult(result: ToolResult): string {
  if (result.ok && result.verification) return `Verified: ${redactTaskText(result.verification.summary).slice(0, 160)}`;
  if (result.ok) return 'Action completed; postcondition verification is still pending.';
  return `Operation failed (${result.errorCode ?? 'FAILED'}).`;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    const callText = message.toolCalls?.map((call) => `${call.name} ${call.argumentsJson}`).join('\n') ?? '';
    const imageAllowance = (message.images?.length ?? 0) * 1_000;
    return total + estimateTextTokens(message.content + (message.reasoning ?? '') + callText) + imageAllowance;
  }, 0);
}

function safeTaskArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const sensitiveKey = /(password|passwd|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|cvv|otp)/i;
  const volatileWindowIdentity = new Set(['targetWindowId', 'expectedProcessId', 'expectedProcessName']);
  for (const [key, value] of Object.entries(args)) {
    if (volatileWindowIdentity.has(key)) continue;
    if (sensitiveKey.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    if ((name === 'type_text' || name === 'browser_type') && key === 'text') {
      safe[key] = '[not stored]';
      continue;
    }
    if (name === 'file_write' && key === 'content') {
      safe[key] = `[not stored; ${typeof value === 'string' ? String(value.length) : 'unknown'} characters]`;
      continue;
    }
    if (typeof value === 'string') safe[key] = redactTaskText(value).slice(0, 500);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value;
    else if (Array.isArray(value)) safe[key] = value.slice(0, 20).map((item) => typeof item === 'string' ? redactTaskText(item).slice(0, 200) : '[value]');
    else safe[key] = '[value]';
  }
  return safe;
}

function addTaskEvidence(
  task: TaskRecord,
  kind: 'observation' | 'verification' | 'recovery',
  summary: string,
  source: string,
): void {
  task.evidence = [
    ...(task.evidence ?? []),
    {
      id: `evidence_${randomUUID().slice(0, 12)}`,
      kind,
      summary: redactTaskText(summary).slice(0, 2_000),
      source: redactTaskText(source).slice(0, 300),
      at: Date.now(),
    },
  ].slice(-100);
}

/** Consume a single-use grant so it cannot authorize a second call. */
function consumeOnceGrant(permissions: PermissionBroker, toolName: string): void {
  const grant = permissions.activeGrants().find((g) => g.toolName === toolName);
  if (grant && grant.scope === 'once') {
    permissions.revoke(toolName);
  }
}

/** How long a cancelled tool gets to wind down before we stop waiting for it. */
export const CANCEL_GRACE_MS = 2_000;

/**
 * Run a tool with a real deadline.
 *
 * Unlike a plain timeout race, expiry (or an emergency stop on `parent`) aborts
 * an AbortSignal that the executors honour by killing child processes and
 * closing the browser, so the work genuinely stops instead of continuing in the
 * background. If a tool still ignores the signal, we stop waiting after a short
 * grace period so the agent loop can never hang.
 */
export async function runWithDeadline(
  start: (signal: AbortSignal) => Promise<ToolResult>,
  timeoutMs: number,
  timeoutMessage: string,
  parent?: AbortSignal,
  graceMs: number = CANCEL_GRACE_MS,
): Promise<ToolResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = (): void => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });

  const work = start(controller.signal).catch(
    (error: unknown): ToolResult => ({
      ok: false,
      content: error instanceof Error ? error.message : String(error),
      errorCode: 'FAILED',
    }),
  );

  const aborted = new Promise<'aborted'>((resolve) => {
    if (controller.signal.aborted) resolve('aborted');
    else controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });

  try {
    const first = await Promise.race([work, aborted]);
    if (first !== 'aborted') return first;

    // Aborted: give the tool a moment to unwind and report, then stop waiting.
    const settled = await Promise.race([
      work,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), graceMs)),
    ]);
    if (timedOut) {
      return { ok: false, content: timeoutMessage, errorCode: 'TIMEOUT' };
    }
    return (
      settled ?? { ok: false, content: 'The action was cancelled.', errorCode: 'CANCELLED' }
    );
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

/** Race a promise against a timeout, resolving to a tool error on expiry. */
export async function withTimeout(
  work: Promise<ToolResult>,
  timeoutMs: number,
  messageText: string,
): Promise<ToolResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<ToolResult>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, content: messageText, errorCode: 'TIMEOUT' }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deriveTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return 'Pixel task';
  return collapsed.length <= 60 ? collapsed : `${collapsed.slice(0, 59)}...`;
}

/** Describe a stop for the audit trail. */
export function describeStop(report: EmergencyStopReport): string {
  return `stopped at ${new Date(report.at).toISOString()}`;
}

/** True when the mode is allowed to run any state-changing tool. */
export function modeCanAct(mode: Mode): boolean {
  return getModeDescriptor(mode).allowsStateChange;
}
