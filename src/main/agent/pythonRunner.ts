/**
 * PythonAgentRunner — orchestrates a full agent turn through the external
 * Python agent service (`pixel-agent-v2`), while keeping Electron main's
 * `PermissionBroker`, `ToolRegistry`, `TaskManager`, and `AuditLog` as the
 * sole privileged execution authority.
 *
 * Security & Reliability Guarantees:
 * - Credentials (API keys) are read from `getApiKey()` (safeStorage DPAPI)
 *   and sent only over private stdio in the `turn.start` payload. They are
 *   never written to disk, argv, logs, or renderer state.
 * - Python NEVER executes tools directly. Every `tool.request` from Python
 *   passes through `ToolRegistry.validateArgs`, `ToolRegistry.evaluate`, and
 *   `PermissionBroker.ask` before `ToolExecutors.run`.
 * - Pre-turn unavailability automatically falls back to the TypeScript
 *   `AgentExecutor` so Pixel remains operational without Python.
 * - Mid-turn crashes do NOT blindly replay already-executed mutating tools;
 *   they surface a clean, auditable failure and mark the task failed.
 */

import { randomUUID } from 'node:crypto';
import type {
  CypsErrorCode,
  StreamEvent,
  TaskRecord,
  TaskStep,
} from '../../shared/types';
import { buildAgentMessages, clipToolResult, errorEvent } from './conversation';
import { buildPermissionRequest, MAX_STEPS, TURN_TIMEOUT_MS } from './executor';
import type { AgentRunOptions, AgentRunResult, ToolRunner } from './executor';
import type { AuditLog, PermissionBroker, TaskManager } from './runtime';
import { ToolRegistry } from './tools';
import { redactTaskText } from '../tasks/schema';
import type {
  PythonAgentBridge,
  PythonToolRequest,
  PythonToolResponse,
  PythonTurnStartOptions,
} from '../services/pythonAgentBridge';

export type PythonProviderMeta = Omit<PythonTurnStartOptions['provider'], 'apiKey'>;

export interface PythonAgentRunnerDeps {
  bridge: PythonAgentBridge;
  registry: ToolRegistry;
  permissions: PermissionBroker;
  tasks: TaskManager;
  audit: AuditLog;
  executors: ToolRunner;
  emit: (event: StreamEvent) => void;
  isStopped: () => boolean;
  getApiKey: () => string | null;
  getProviderConfig: (model: string) => PythonProviderMeta;
  memoryContextFor?: (request: AgentRunOptions['request']) => string;
  getProjectId?: () => string;
  fallbackToTypescript?: (options: AgentRunOptions) => Promise<AgentRunResult>;
}

const VALID_ERROR_CODES = new Set<CypsErrorCode>([
  'NO_API_KEY',
  'UNAUTHORIZED',
  'INSUFFICIENT_BALANCE',
  'RATE_LIMITED',
  'TIMEOUT',
  'ABORTED',
  'NETWORK',
  'MODEL_CAPABILITY',
  'BAD_REQUEST',
  'SERVER',
  'UNKNOWN',
]);

function normalizeErrorCode(code: string | undefined): CypsErrorCode {
  if (!code) return 'UNKNOWN';
  if (code === 'INVALID_API_KEY') return 'UNAUTHORIZED';
  if (code === 'MODEL_UNAVAILABLE') return 'SERVER';
  if (VALID_ERROR_CODES.has(code as CypsErrorCode)) {
    return code as CypsErrorCode;
  }
  return 'UNKNOWN';
}

function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled task';
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

export class PythonAgentRunner {
  private activeRequestId: string | null = null;
  private controller: AbortController | null = null;
  private running = false;

  constructor(private readonly deps: PythonAgentRunnerDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  cancel(_reason: 'user' | 'stop' | 'timeout' = 'user'): void {
    this.controller?.abort();
    this.deps.permissions.rejectPending();
    if (this.activeRequestId) {
      this.deps.bridge.cancelTurn(this.activeRequestId);
    }
  }

  private emptyResult(failure: CypsErrorCode): AgentRunResult {
    const now = Date.now();
    return {
      task: {
        id: `task_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
        title: 'Cancelled task',
        status: failure === 'ABORTED' ? 'cancelled' : 'failed',
        steps: [],
        createdAt: now,
        endedAt: now,
        request: '',
      },
      finalContent: '',
      executed: [],
      aborted: failure === 'ABORTED',
      failure,
    };
  }

  private failStep(step: TaskStep, task: TaskRecord, detail: string): void {
    step.status = 'failed';
    step.detail = redactTaskText(detail).slice(0, 400);
    step.endedAt = Date.now();
    this.deps.tasks.update(task.id, { steps: [...task.steps] });
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { requestId, request, model } = options;
    const { bridge, registry, permissions, tasks, audit, executors, emit, isStopped } = this.deps;

    if (this.running) {
      emit(errorEvent(requestId, 'BAD_REQUEST', 'Pixel is already working on something. Wait, or press stop.'));
      return this.emptyResult('BAD_REQUEST');
    }

    if (isStopped()) {
      emit(errorEvent(requestId, 'ABORTED', 'Emergency stop is active. Clear it before asking Pixel to do anything.'));
      return this.emptyResult('ABORTED');
    }

    const providerMeta = this.deps.getProviderConfig(model);
    const apiKey = this.deps.getApiKey() ?? '';
    if (!apiKey && providerMeta.provider !== 'ollama') {
      emit(
        errorEvent(
          requestId,
          'NO_API_KEY',
          'Pixel needs a DeepSeek API key before it can answer. Add one in Settings - it is stored encrypted on this computer.',
        ),
      );
      return this.emptyResult('NO_API_KEY');
    }

    // Pre-turn health check: if Python is unavailable, fall back cleanly to TS
    // BEFORE any tool executes.
    try {
      await bridge.ping();
    } catch (pingErr) {
      const reason = pingErr instanceof Error ? pingErr.message : String(pingErr);
      audit.record(
        'system',
        'Python agent engine unavailable; falling back to TypeScript runtime',
        'ok',
        reason.slice(0, 160),
      );
      if (this.deps.fallbackToTypescript) {
        return this.deps.fallbackToTypescript(options);
      }
      emit(errorEvent(requestId, 'UNKNOWN', `Python agent engine unavailable: ${reason}`));
      return this.emptyResult('UNKNOWN');
    }

    const startedAt = Date.now();
    const task: TaskRecord = {
      id: `task_${startedAt.toString(36)}_${randomUUID().slice(0, 8)}`,
      title: deriveTitle(redactTaskText(request.text)),
      status: 'running',
      steps: [],
      createdAt: startedAt,
      request: redactTaskText(request.text),
      ...(this.deps.getProjectId ? { projectId: this.deps.getProjectId() } : {}),
      ...(options.allowedTools ? { allowedTools: [...new Set(options.allowedTools)].slice(0, 100) } : {}),
      approvalRefs: [],
      evidence: [],
      pendingVerifications: [],
    };
    tasks.upsert(task);
    tasks.registerControl(task.id, { cancel: () => this.cancel('user') });

    this.running = true;
    this.activeRequestId = requestId;
    const controller = new AbortController();
    this.controller = controller;
    const deadlineTimer = setTimeout(() => {
      if (this.controller !== controller || controller.signal.aborted) return;
      this.cancel('timeout');
    }, TURN_TIMEOUT_MS);

    const executed: AgentRunResult['executed'] = [];
    let finalContent = '';

    try {
      audit.record(
        'model',
        'Python agent run started',
        'ok',
        `${model} · ${redactTaskText(request.text).slice(0, 100)}`,
      );

      // Build opening messages using Pixel's canonical prompt builder + optional memory context.
      const baseMessages = buildAgentMessages(request);
      const memoryText = this.deps.memoryContextFor?.(request)?.trim() ?? '';
      if (memoryText && baseMessages.length > 0 && baseMessages[0].role === 'system') {
        baseMessages[0] = {
          ...baseMessages[0],
          content: `${baseMessages[0].content}\n\n${memoryText}`,
        };
      }
      const wireMessages: Array<Record<string, unknown>> = baseMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Build tool schemas filtered by mode and optional allowedTools.
      const allDefs = registry.schemasFor(request.mode);
      const filteredDefs = options.allowedTools
        ? allDefs.filter((def) => options.allowedTools!.includes(def.name))
        : allDefs;
      const wireTools = filteredDefs.map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      }));

      emit({ type: 'started', requestId, model });

      const onToolRequest = async (toolReq: PythonToolRequest): Promise<PythonToolResponse> => {
        const callName = toolReq.name;
        const callArgs = toolReq.args && typeof toolReq.args === 'object' ? toolReq.args : {};

        const step: TaskStep = {
          id: `${task.id}_s${task.steps.length + 1}`,
          title: `Tool: ${callName}`,
          status: 'running',
          toolName: callName,
          startedAt: Date.now(),
        };
        task.steps.push(step);
        tasks.update(task.id, { steps: [...task.steps] });

        if (isStopped() || controller.signal.aborted) {
          const text = 'Error: Run was cancelled or emergency-stopped before tool execution.';
          this.failStep(step, task, text);
          executed.push({ name: callName, ok: false, summary: 'cancelled' });
          return { ok: false, content: text, denied: true };
        }

        const def = registry.get(callName);
        if (!def) {
          const text = `Error: Pixel has no tool named "${callName}".`;
          this.failStep(step, task, text);
          audit.record('tool', `Unknown tool requested by Python runtime: ${callName}`, 'denied');
          executed.push({ name: callName, ok: false, summary: 'unknown tool' });
          return { ok: false, content: text, denied: true };
        }

        if (task.allowedTools && !task.allowedTools.includes(callName)) {
          const text = `Error: this task is limited to its approved tools and cannot use "${callName}".`;
          this.failStep(step, task, text);
          audit.record('tool', `Blocked outside task capability set: ${callName}`, 'denied');
          executed.push({ name: callName, ok: false, summary: 'outside task capability set' });
          return { ok: false, content: text, denied: true };
        }

        const validation = registry.validateArgs(callName, callArgs);
        if (!validation.ok) {
          const text = `Error: Pixel refused invalid arguments for "${callName}": ${validation.message}`;
          this.failStep(step, task, text);
          audit.record('tool', `Invalid arguments: ${callName}`, 'denied', validation.message);
          executed.push({ name: callName, ok: false, summary: 'invalid arguments' });
          return { ok: false, content: text, denied: true };
        }

        const decision = registry.evaluate(callName, request.mode, callArgs);
        if (!decision.allowed) {
          if (decision.needsApproval) {
            const permReq = buildPermissionRequest(def, callArgs);
            task.approvalRefs = [...(task.approvalRefs ?? []), permReq.id];
            task.status = 'awaiting_approval';
            task.checkpoint = {
              phase: 'awaiting_approval',
              at: Date.now(),
              summary: `Waiting for approval to run ${callName}.`,
            };
            tasks.update(task.id, {
              status: task.status,
              approvalRefs: task.approvalRefs,
              checkpoint: task.checkpoint,
            });

            const resolved = await permissions.ask(permReq, controller.signal);
            task.status = 'running';
            tasks.update(task.id, { status: task.status });

            if (isStopped() || controller.signal.aborted) {
              permissions.rejectPending();
              const text = 'Error: the run was cancelled before this action was approved.';
              this.failStep(step, task, text);
              executed.push({ name: callName, ok: false, summary: 'cancelled during approval' });
              return { ok: false, content: text, denied: true };
            }

            if (!resolved.approved) {
              const text = `Error: the user denied permission to run "${callName}". Do not retry this action unless the user asks.`;
              this.failStep(step, task, text);
              audit.record('tool', `Denied: ${callName}`, 'denied');
              executed.push({ name: callName, ok: false, summary: 'denied by user' });
              return { ok: false, content: text, denied: true };
            }

            // Re-check policy so a 'once' grant is consumed and verified.
            const recheck = registry.evaluate(callName, request.mode, callArgs);
            if (!recheck.allowed) {
              const text = `Error: "${callName}" still cannot run: ${recheck.reason}`;
              this.failStep(step, task, text);
              executed.push({ name: callName, ok: false, summary: 'still unauthorized' });
              return { ok: false, content: text, denied: true };
            }
          } else {
            const text = `Error: ${decision.reason}`;
            this.failStep(step, task, text);
            audit.record('tool', `Blocked: ${callName}`, 'denied', decision.reason);
            executed.push({ name: callName, ok: false, summary: decision.reason });
            return { ok: false, content: text, denied: true };
          }
        }

        // Execute through Pixel's canonical ToolExecutors.
        try {
          const result = await executors.run(callName, callArgs, controller.signal, { taskId: task.id });
          if (result.ok) {
            step.status = 'done';
            step.detail = redactTaskText(result.content).slice(0, 300);
            step.endedAt = Date.now();
            tasks.update(task.id, { steps: [...task.steps] });
            audit.record('tool', `Executed: ${callName}`, 'ok', step.detail.slice(0, 120));
            executed.push({ name: callName, ok: true, summary: step.detail.slice(0, 120) || 'ok' });
            return {
              ok: true,
              content: clipToolResult(result.content),
            };
          }
          const errText = result.content || 'Tool execution failed';
          this.failStep(step, task, errText);
          audit.record('tool', `Failed: ${callName}`, 'error', errText.slice(0, 120));
          executed.push({ name: callName, ok: false, summary: errText.slice(0, 120) });
          return {
            ok: false,
            content: clipToolResult(errText),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.failStep(step, task, msg);
          audit.record('tool', `Exception in ${callName}`, 'error', msg.slice(0, 120));
          executed.push({ name: callName, ok: false, summary: msg.slice(0, 120) });
          return {
            ok: false,
            content: msg,
          };
        }
      };

      const outcome = await bridge.runTurn({
        requestId,
        messages: wireMessages,
        tools: wireTools,
        provider: {
          ...providerMeta,
          apiKey,
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        },
        budgets: {
          maxIterations: MAX_STEPS,
          maxToolCalls: 24,
          maxWallMs: TURN_TIMEOUT_MS,
          maxContextTokens: 64_000,
        },
        onDelta: (delta) => {
          finalContent += delta;
          emit({ type: 'text', requestId, delta });
        },
        onReasoning: (delta) => {
          emit({ type: 'reasoning', requestId, delta });
        },
        onToolRequest,
      });

      const wasAborted = outcome.finishReason === 'cancelled' || controller.signal.aborted;
      if (wasAborted) {
        task.status = 'cancelled';
        task.endedAt = Date.now();
        tasks.update(task.id, { status: task.status, endedAt: task.endedAt });
        emit({ type: 'aborted', requestId, hadContent: finalContent.length > 0 });
        return { task, finalContent, executed, aborted: true, failure: 'ABORTED' };
      }

      if (!outcome.ok) {
        const code = normalizeErrorCode(outcome.error?.code);
        const message = outcome.error?.message ?? 'Python agent turn failed.';
        task.status = 'failed';
        task.endedAt = Date.now();
        tasks.update(task.id, { status: task.status, endedAt: task.endedAt });
        audit.record('model', 'Python agent turn failed', 'error', `${code}: ${message.slice(0, 160)}`);
        emit(errorEvent(requestId, code, message));
        return { task, finalContent, executed, aborted: false, failure: code };
      }

      if (outcome.content && !finalContent) {
        finalContent = outcome.content;
      }

      if (outcome.usage) {
        emit({
          type: 'usage',
          requestId,
          usage: {
            promptTokens: outcome.usage.promptTokens,
            completionTokens: outcome.usage.completionTokens,
            totalTokens: outcome.usage.totalTokens,
          },
        });
      }

      task.status = 'completed';
      task.endedAt = Date.now();
      tasks.update(task.id, { status: task.status, endedAt: task.endedAt });
      emit({
        type: 'done',
        requestId,
        finishReason: outcome.finishReason || 'stop',
      });
      audit.record(
        'model',
        'Python agent turn completed',
        'ok',
        `${outcome.steps.length} tool step(s), finish=${outcome.finishReason}`,
      );
      return { task, finalContent, executed, aborted: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.endedAt = Date.now();
      tasks.update(task.id, { status: task.status, endedAt: task.endedAt });
      audit.record('model', 'Python agent runner exception', 'error', msg.slice(0, 160));
      emit(errorEvent(requestId, 'UNKNOWN', msg));
      return { task, finalContent, executed, aborted: false, failure: 'UNKNOWN' };
    } finally {
      clearTimeout(deadlineTimer);
      this.running = false;
      this.activeRequestId = null;
      this.controller = null;
    }
  }
}
