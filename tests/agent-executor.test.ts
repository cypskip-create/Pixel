import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRequest, PermissionRequest, TaskRecord, ToolCall } from '../src/shared/types';
import { AgentExecutor, MAX_STEPS, parseArgs } from '../src/main/agent/executor';
import type { TurnRunner } from '../src/main/agent/executor';
import type { ToolRunner } from '../src/main/agent/executor';
import type { ToolResult } from '../src/main/agent/executors';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { ToolRegistry } from '../src/main/agent/tools';
import type { RunTurnOptions, TurnOutcome } from '../src/main/agent/conversation';

/** Build a scripted conversation engine: one outcome per step. */
function scriptedEngine(outcomes: TurnOutcome[]): TurnRunner & { seen: RunTurnOptions[] } {
  const seen: RunTurnOptions[] = [];
  let index = 0;
  return {
    seen,
    async runTurn(options: RunTurnOptions): Promise<TurnOutcome> {
      seen.push(options);
      const outcome = outcomes[index] ?? plainAnswer('done');
      index += 1;
      return outcome;
    },
  };
}

function plainAnswer(text: string): TurnOutcome {
  return {
    content: text,
    reasoning: '',
    toolCalls: [],
    finishReason: 'stop',
    aborted: false,
    failed: false,
  };
}

function toolCall(name: string, args: Record<string, unknown>, id = `call_${name}`): ToolCall {
  return { id, name, argumentsJson: JSON.stringify(args), arguments: args };
}

function toolStep(name: string, args: Record<string, unknown>, id?: string): TurnOutcome {
  return {
    content: '',
    reasoning: '',
    toolCalls: [toolCall(name, args, id)],
    finishReason: 'tool_calls',
    aborted: false,
    failed: false,
  };
}

/** Fake executors that record calls and return scripted results. */
function fakeTools(results: Record<string, ToolResult> = {}): ToolRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(name: string): Promise<ToolResult> {
      calls.push(name);
      return results[name] ?? { ok: true, content: `${name} succeeded` };
    },
    killAll: () => 0,
  };
}

interface Harness {
  agent: AgentExecutor;
  tasks: TaskManager;
  audit: AuditLog;
  broker: PermissionBroker;
  registry: ToolRegistry;
  /** Permission prompts raised during the run. */
  prompts: PermissionRequest[];
  taskUpdates: TaskRecord[];
}

function harness(options: {
  outcomes: TurnOutcome[];
  tools?: ToolRunner;
  /** Auto-answer permission prompts. */
  approve?: boolean;
  revokedGrants?: boolean;
}): Harness {
  const audit = new AuditLog();
  const registry = new ToolRegistry();
  const tasks = new TaskManager((task) => taskUpdates.push(task));
  const prompts: PermissionRequest[] = [];
  const taskUpdates: TaskRecord[] = [];

  const broker = new PermissionBroker(registry, audit, (request) => {
    prompts.push(request);
    // Answer on the next tick so the loop is genuinely suspended.
    queueMicrotask(() => {
      broker.respond({
        requestId: request.id,
        approved: options.approve ?? false,
        duration: 'once',
      });
    });
  });

  const engine = scriptedEngine(options.outcomes);

  const agent = new AgentExecutor({
    engine,
    registry,
    permissions: broker,
    tasks,
    audit,
    executors: options.tools ?? fakeTools(),
    emit: () => undefined,
    isStopped: () => false,
  });

  return { agent, tasks, audit, broker, registry, prompts, taskUpdates };
}

const request: ChatRequest = { text: 'What time is it?', mode: 'hybrid' };

function run(agent: AgentExecutor, requestId = 'r1') {
  return agent.run({ requestId, request, model: 'deepseek-flash' });
}

/* ------------------------------------------------------------------ *
 * Happy paths
 * ------------------------------------------------------------------ */

describe('agent loop - direct answer', () => {
  it('completes without any tool call', async () => {
    const h = harness({ outcomes: [plainAnswer('It is four o clock.')] });
    const result = await run(h.agent);

    expect(result.task.status).toBe('completed');
    expect(result.finalContent).toBe('It is four o clock.');
    expect(result.executed).toHaveLength(0);
  });

  it('passes the conversation through to the engine', async () => {
    const h = harness({ outcomes: [plainAnswer('ok')] });
    await run(h.agent);
    const seen = (h.agent as unknown as { deps: { engine: { seen: RunTurnOptions[] } } }).deps.engine
      .seen;
    expect(seen[0]?.messages?.[seen[0].messages.length - 1].content).toBe('What time is it?');
  });
});

describe('agent loop - tool execution', () => {
  it('executes a permitted read-only tool and feeds the result back', async () => {
    const tools = fakeTools({ get_current_time: { ok: true, content: '09:41' } });
    const h = harness({
      outcomes: [toolStep('get_current_time', {}), plainAnswer('It is 09:41.')],
      tools,
    });

    const result = await run(h.agent);

    expect(tools.calls).toEqual(['get_current_time']);
    expect(result.task.status).toBe('completed');
    expect(result.finalContent).toBe('It is 09:41.');
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0].ok).toBe(true);
  });

  it('records the tool result as a tool message paired with the call id', async () => {
    const h = harness({
      outcomes: [toolStep('get_current_time', {}, 'call_abc'), plainAnswer('done')],
      tools: fakeTools({ get_current_time: { ok: true, content: '09:41' } }),
    });
    await run(h.agent);

    const engine = (h.agent as unknown as { deps: { engine: { seen: RunTurnOptions[] } } }).deps.engine;
    const second = engine.seen[1];
    const toolMessage = second?.messages?.find((m: ChatMessage) => m.role === 'tool');
    expect(toolMessage?.toolCallId).toBe('call_abc');
    expect(toolMessage?.content).toBe('09:41');
  });

  it('marks the task step done and stamps the end time', async () => {
    const h = harness({ outcomes: [toolStep('get_current_time', {}), plainAnswer('done')] });
    const result = await run(h.agent);

    expect(result.task.steps).toHaveLength(1);
    expect(result.task.steps[0].status).toBe('done');
    expect(result.task.steps[0].endedAt).toBeGreaterThan(0);
  });

  it('audits both the run and the tool call', async () => {
    const h = harness({ outcomes: [toolStep('get_current_time', {}), plainAnswer('done')] });
    await run(h.agent);

    const summaries = h.audit.list(50).map((entry) => entry.summary);
    expect(summaries.some((s) => /agent run started/i.test(s))).toBe(true);
    expect(summaries.some((s) => /ran: get_current_time/i.test(s))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Approval
 * ------------------------------------------------------------------ */

describe('agent loop - approval', () => {
  it('suspends, asks, and executes once approved', async () => {
    const tools = fakeTools({ type_text: { ok: true, content: 'typed 5 characters' } });
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello' }), plainAnswer('Typed it.')],
      tools,
      approve: true,
    });

    const result = await run(h.agent);

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0].toolName).toBe('type_text');
    expect(h.prompts[0].changesData).toBe(true);
    expect(tools.calls).toEqual(['type_text']);
    expect(result.task.status).toBe('completed');
  });

  it('does not execute when the user denies, and tells the model so', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello' }), plainAnswer('Understood.')],
      tools,
      approve: false,
    });

    const result = await run(h.agent);

    expect(h.prompts).toHaveLength(1);
    expect(tools.calls).toEqual([]);
    expect(result.task.status).toBe('completed');

    const engine = (h.agent as unknown as { deps: { engine: { seen: RunTurnOptions[] } } }).deps.engine;
    const denial = engine.seen[1]?.messages?.find((m: ChatMessage) => m.role === 'tool');
    expect(denial?.content).toMatch(/denied/i);
  });

  it('records a denied tool call in the audit trail', async () => {
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello' }), plainAnswer('ok')],
      approve: false,
    });
    await run(h.agent);
    expect(h.audit.list(50).some((e) => e.outcome === 'denied')).toBe(true);
  });

  it('sends the risk level so the UI can show an honest warning', async () => {
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'x' }), plainAnswer('ok')],
      approve: false,
    });
    await run(h.agent);
    expect(h.prompts[0].risk).toBe('high');
  });
});

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

describe('agent loop - failures', () => {
  it('reports an unknown tool to the model without crashing', async () => {
    const h = harness({
      outcomes: [toolStep('does_not_exist', {}), plainAnswer('I cannot do that.')],
    });
    const result = await run(h.agent);

    expect(result.task.status).toBe('completed');
    const engine = (h.agent as unknown as { deps: { engine: { seen: RunTurnOptions[] } } }).deps.engine;
    const toolMessage = engine.seen[1]?.messages?.find((m: ChatMessage) => m.role === 'tool');
    expect(toolMessage?.content).toMatch(/no tool named/i);
  });

  it('lets the model recover after a tool failure', async () => {
    const tools = fakeTools({
      open_application: { ok: false, content: 'Application not found.', errorCode: 'NOT_FOUND' },
    });
    const h = harness({
      outcomes: [toolStep('open_application', { name: 'notepad' }), plainAnswer('It is not installed.')],
      tools,
      approve: true,
    });

    const result = await run(h.agent);
    expect(result.task.status).toBe('completed');
    expect(result.task.steps[0].status).toBe('failed');
  });

  it('blocks a state-changing tool in Guide mode without asking', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hi' }), plainAnswer('Guide mode cannot type.')],
      tools,
    });
    const result = await h.agent.run({
      requestId: 'r-guide',
      request: { text: 'type hi', mode: 'guide' },
      model: 'deepseek-flash',
    });

    expect(h.prompts).toHaveLength(0);
    expect(tools.calls).toEqual([]);
    expect(result.task.steps[0].status).toBe('failed');
  });

  it('surfaces an engine failure as a failed task', async () => {
    const h = harness({
      outcomes: [
        {
          content: '',
          reasoning: '',
          toolCalls: [],
          finishReason: 'error',
          aborted: false,
          failed: true,
        },
      ],
    });
    const result = await run(h.agent);
    expect(result.task.status).toBe('failed');
  });

  it('stops after MAX_STEPS instead of looping forever', async () => {
    const outcomes = Array.from({ length: MAX_STEPS + 2 }, () =>
      toolStep('get_current_time', {}),
    );
    const h = harness({ outcomes });
    const result = await run(h.agent);

    expect(result.task.status).toBe('failed');
    expect(result.failure).toBe('BAD_REQUEST');
    expect(result.task.steps.length).toBeLessThanOrEqual(MAX_STEPS + 1);
  });
});

/* ------------------------------------------------------------------ *
 * Cancellation and interruption
 * ------------------------------------------------------------------ */

describe('agent loop - cancellation', () => {
  it('cancels between steps and marks the task cancelled', async () => {
    const tools = fakeTools();
    let agentRef: AgentExecutor | null = null;

    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);

    const engine: TurnRunner = {
      async runTurn(): Promise<TurnOutcome> {
        // Cancel while the model is "thinking" about the next step.
        agentRef?.cancel('user');
        return toolStep('get_current_time', {});
      },
    };

    agentRef = new AgentExecutor({
      engine,
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: tools,
      emit: () => undefined,
      isStopped: () => false,
    });

    const result = await agentRef.run({
      requestId: 'r-cancel',
      request,
      model: 'deepseek-flash',
    });

    expect(result.task.status).toBe('cancelled');
    expect(result.aborted).toBe(true);
    expect(tools.calls).toEqual([]);
  });

  it('does not execute tools after an emergency stop', async () => {
    let stopped = false;
    const tools = fakeTools();
    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);

    const engine: TurnRunner = {
      async runTurn(): Promise<TurnOutcome> {
        stopped = true; // the user hits the stop button now
        return toolStep('get_current_time', {});
      },
    };

    const agent = new AgentExecutor({
      engine,
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: tools,
      emit: () => undefined,
      isStopped: () => stopped,
    });

    const result = await agent.run({ requestId: 'r-stop', request, model: 'deepseek-flash' });
    expect(result.task.status).toBe('cancelled');
    expect(tools.calls).toEqual([]);
  });

  it('rejects a second run while one is in flight', async () => {
    let release: (() => void) | undefined;
    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);
    const emitted: string[] = [];

    const engine: TurnRunner = {
      async runTurn(): Promise<TurnOutcome> {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return plainAnswer('done');
      },
    };

    const agent = new AgentExecutor({
      engine,
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: fakeTools(),
      emit: (event) => emitted.push(event.type),
      isStopped: () => false,
    });

    const first = agent.run({ requestId: 'a', request, model: 'deepseek-flash' });
    const second = await agent.run({ requestId: 'b', request, model: 'deepseek-flash' });

    expect(second.failure).toBe('BAD_REQUEST');
    expect(emitted).toContain('error');
    release?.();
    await first;
  });

  it('refuses to start while emergency stop is active', async () => {
    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);
    const agent = new AgentExecutor({
      engine: scriptedEngine([plainAnswer('should not run')]),
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: fakeTools(),
      emit: () => undefined,
      isStopped: () => true,
    });

    const result = await agent.run({ requestId: 'x', request, model: 'deepseek-flash' });
    expect(result.failure).toBe('ABORTED');
    expect(result.task.status).toBe('failed');
  });
});

/* ------------------------------------------------------------------ *
 * Persistence hooks
 * ------------------------------------------------------------------ */

describe('agent loop - persistence', () => {
  it('persists the finished task exactly once', async () => {
    const persisted: TaskRecord[] = [];
    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);

    const agent = new AgentExecutor({
      engine: scriptedEngine([toolStep('get_current_time', {}), plainAnswer('done')]),
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: fakeTools(),
      emit: () => undefined,
      isStopped: () => false,
      persist: (task) => persisted.push(task),
    });

    await agent.run({ requestId: 'p', request, model: 'deepseek-flash' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('completed');
  });

  it('does not fail the run when persistence throws', async () => {
    const audit = new AuditLog();
    const registry = new ToolRegistry();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, () => undefined);

    const agent = new AgentExecutor({
      engine: scriptedEngine([plainAnswer('done')]),
      registry,
      permissions: broker,
      tasks,
      audit,
      executors: fakeTools(),
      emit: () => undefined,
      isStopped: () => false,
      persist: () => {
        throw new Error('disk full');
      },
    });

    const result = await agent.run({ requestId: 'p2', request, model: 'deepseek-flash' });
    expect(result.task.status).toBe('completed');
  });
});

describe('parseArgs', () => {
  it('parses a JSON argument string', () => {
    expect(parseArgs({ id: 'a', name: 'x', argumentsJson: '{"text":"hi"}' })).toEqual({ text: 'hi' });
  });

  it('prefers already-parsed arguments', () => {
    expect(
      parseArgs({ id: 'a', name: 'x', argumentsJson: '{}', arguments: { text: 'done' } }),
    ).toEqual({ text: 'done' });
  });

  it('returns an empty object for malformed JSON instead of throwing', () => {
    expect(parseArgs({ id: 'a', name: 'x', argumentsJson: '{oops' })).toEqual({});
  });

  it('rejects a non-object JSON value', () => {
    expect(parseArgs({ id: 'a', name: 'x', argumentsJson: '["a"]' })).toEqual({});
  });
});
