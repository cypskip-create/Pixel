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
import type { TurnOutcome } from './conversation';
import { errorEvent } from './conversation';
import type { RunTurnOptions } from './conversation';
import type { ToolResult } from './executors';
import type { AuditLog, PermissionBroker, TaskManager } from './runtime';
import { ToolRegistry } from './tools';

/** Hard ceiling on model turns per request. */
export const MAX_STEPS = 8;

/** Wall clock ceiling for a whole request, including tool time. */
export const TURN_TIMEOUT_MS = 5 * 60_000;

/** Per-tool execution ceiling. */
export const TOOL_TIMEOUT_MS = 30_000;

/** The one thing the agent needs from the conversation engine. */
export interface TurnRunner {
  runTurn(options: RunTurnOptions): Promise<TurnOutcome>;
}

/** The one thing the agent needs from the tool executors. */
export interface ToolRunner {
  run(name: string, args: Record<string, unknown>): Promise<ToolResult>;
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
}

export interface AgentRunOptions {
  requestId: string;
  request: ChatRequest;
  model: string;
  thinking?: ThinkingConfig;
  temperature?: number;
  maxTokens?: number;
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

    const startedAt = Date.now();
    const deadline = startedAt + TURN_TIMEOUT_MS;
    const executed: AgentRunResult['executed'] = [];

    const task: TaskRecord = {
      id: `task_${startedAt.toString(36)}`,
      title: deriveTitle(request.text),
      status: 'running',
      steps: [],
      createdAt: startedAt,
    };
    tasks.upsert(task);
    audit.record('model', 'Agent run started', 'ok', request.text.slice(0, 120));

    // The conversation the shell already has, trimmed once up front so the
    // per-step messages stay intact (tool calls and results must stay paired).
    const messages: ChatMessage[] = [];
    for (const prior of request.history ?? []) {
      if (prior.role === 'system') continue;
      messages.push(prior);
    }
    messages.push({
      id: `u_${startedAt.toString(36)}`,
      role: 'user',
      content: request.text,
      createdAt: startedAt,
      ...(request.images?.length ? { images: request.images } : {}),
    });

    let finalContent = '';
    let stepIndex = 0;

    try {
      for (stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
        if (this.shouldStop()) {
          return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
        }
        if (Date.now() > deadline) {
          this.cancelReason = 'timeout';
          this.cancel('timeout');
          return this.finish(requestId, task, executed, finalContent, 'failed', true, 'TIMEOUT');
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

        if (outcome.failed) {
          return this.finish(requestId, task, executed, finalContent, 'failed', false, 'UNKNOWN');
        }
        if (outcome.aborted || this.shouldStop()) {
          return this.finish(requestId, task, executed, finalContent, 'cancelled', true);
        }

        // No tool calls: the model answered. Done.
        if (outcome.toolCalls.length === 0) {
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

          const outcomeStep = await this.executeCall(call, request.mode, task, messages);
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
    } finally {
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
    const args = parseArgs(call);

    const step: TaskStep = {
      id: `${task.id}_s${task.steps.length + 1}`,
      title: describeCall(call.name, args),
      status: 'running',
      toolName: call.name,
      startedAt: Date.now(),
    };
    task.steps.push(step);
    tasks.update(task.id, { steps: [...task.steps] });

    const toolMessage = (content: string): ChatMessage => ({
      id: `${call.id}_result`,
      role: 'tool',
      content,
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

    // 2. Policy: mode, emergency stop, and whether approval is required.
    const decision = registry.evaluate(call.name, mode);
    if (!decision.allowed) {
      if (decision.needsApproval) {
        const request = buildPermissionRequest(tool, args);
        const resolved = await permissions.ask(request);

        // A pending approval that is interrupted by stop/timeout must not hang.
        if (this.shouldStop()) {
          permissions.rejectPending();
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
        const recheck = registry.evaluate(call.name, mode);
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

    // 3. Execute for real, with a timeout.
    const result = await withTimeout(
      executors.run(call.name, args),
      TOOL_TIMEOUT_MS,
      `"${call.name}" took too long and was stopped.`,
    );

    const succeeded = result.ok;
    step.status = succeeded ? 'done' : 'failed';
    step.endedAt = Date.now();
    step.detail = summariseResult(result);
    task.steps[task.steps.length - 1] = step;
    tasks.update(task.id, { steps: [...task.steps] });

    audit.record(
      'tool',
      `${succeeded ? 'Ran' : 'Failed'}: ${call.name}`,
      succeeded ? 'ok' : 'error',
      result.content.slice(0, 200),
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
    const finished: TaskRecord = {
      ...task,
      status,
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
      `Agent run ${status}`,
      status === 'completed' ? 'ok' : status === 'cancelled' ? 'cancelled' : 'error',
      `${executed.length} tool call(s)`,
    );
    if (errorText) {
      this.deps.emit({
        type: 'error',
        requestId,
        code: failure ?? 'UNKNOWN',
        message: errorText,
      });
    } else if (status === 'cancelled') {
      // Without this the UI would keep showing a spinner after a stop.
      this.deps.emit({ type: 'aborted', requestId, hadContent: finalContent.length > 0 });
    }
    return { task: finished, finalContent, executed, aborted, ...(failure ? { failure } : {}) };
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
    case 'open_application':
      return `Open ${typeof args.name === 'string' ? args.name : 'an application'}`;
    case 'type_text': {
      const text = typeof args.text === 'string' ? args.text : '';
      return `Type ${text.length > 32 ? `${text.slice(0, 32)}...` : text}`;
    }
    default:
      return name;
  }
}

/** Build the permission request shown to the user. */
export function buildPermissionRequest(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): PermissionRequest {
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
  };
}

function targetFor(name: string, args: Record<string, unknown>): string {
  if (name === 'analyze_screen') return 'this screen';
  if (name === 'open_application' && typeof args.name === 'string') return args.name;
  if (name === 'type_text') return 'the focused window';
  return 'this computer';
}

function summariseResult(result: ToolResult): string {
  if (result.ok) {
    return result.content.length > 160 ? `${result.content.slice(0, 157)}...` : result.content;
  }
  return `${result.errorCode ?? 'FAILED'}: ${
    result.content.length > 140 ? `${result.content.slice(0, 137)}...` : result.content
  }`;
}

/** Consume a single-use grant so it cannot authorize a second call. */
function consumeOnceGrant(permissions: PermissionBroker, toolName: string): void {
  const grant = permissions.activeGrants().find((g) => g.toolName === toolName);
  if (grant && grant.scope === 'once') {
    permissions.revoke(toolName);
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
