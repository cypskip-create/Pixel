import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatRequest, PermissionRequest, TaskRecord, ToolCall } from '../src/shared/types';
import { AgentExecutor, MAX_STEPS, parseArgs } from '../src/main/agent/executor';
import { BUILTIN_TOOLS } from '../src/main/agent/tools';
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
  engine?: TurnRunner;
  tools?: ToolRunner;
  /** Auto-answer permission prompts. */
  approve?: boolean;
  /** Leave permission prompts pending so a test can drive the decision. */
  deferApproval?: boolean;
  revokedGrants?: boolean;
}): Harness {
  const audit = new AuditLog();
  const registry = new ToolRegistry();
  const tasks = new TaskManager((task) => taskUpdates.push(task));
  const prompts: PermissionRequest[] = [];
  const taskUpdates: TaskRecord[] = [];

  const broker = new PermissionBroker(registry, audit, (request) => {
    prompts.push(request);
    if (options.deferApproval) return;
    // Answer on the next tick so the loop is genuinely suspended.
    queueMicrotask(() => {
      broker.respond({
        requestId: request.id,
        approved: options.approve ?? false,
        duration: 'once',
      });
    });
  });

  const engine = options.engine ?? scriptedEngine(options.outcomes);

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

describe('agent loop - verified action sequencing', () => {
  it('replays a reviewed ordered tool plan directly without model step selection', async () => {
    const observedArgs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const tools: ToolRunner = {
      async run(name, args) {
        observedArgs.push({ name, args });
        return name === 'browser_navigate'
          ? { ok: true, content: 'Opened https://example.test/work', detail: { url: 'https://example.test/work' }, verification: { summary: 'Destination URL read back', source: 'browser session' } }
          : { ok: true, content: 'Current page observed.' };
      },
      killAll: () => 0,
    };
    const h = harness({ outcomes: [], tools, approve: true });
    for (const tool of BUILTIN_TOOLS) h.registry.register(tool);

    const result = await h.agent.run({
      requestId: 'reviewed-tool-plan',
      request: { text: 'Run reviewed skill "Open authorized page".', mode: 'agent' },
      model: 'deepseek-flash',
      allowedTools: ['browser_inspect', 'browser_navigate'],
      requireInitialObservation: true,
      toolPlan: [
        { id: 'plan_observe', name: 'browser_inspect', argumentsJson: '{}', approvalRequired: true },
        { id: 'plan_open', name: 'browser_navigate', argumentsJson: '{"url":"https://example.test/work"}', expectation: { resultContains: 'Opened https://example.test/work', urlPrefix: 'https://example.test/', verifyCurrentPostcondition: true } },
        { id: 'plan_verify_current', name: 'browser_inspect', argumentsJson: '{}' },
      ],
    });

    expect(result.task.status).toBe('completed');
    expect(result.task.steps.map((step) => step.toolName)).toEqual(['browser_inspect', 'browser_navigate', 'browser_inspect']);
    expect(result.executed.map((step) => step.name)).toEqual(['browser_inspect', 'browser_navigate', 'browser_inspect']);
    expect(observedArgs[1]?.args).toEqual({ url: 'https://example.test/work' });
    expect(h.prompts.map((prompt) => prompt.toolName)).toEqual(['browser_inspect', 'browser_navigate']);
    expect((h.agent as unknown as { deps: { engine: { seen: RunTurnOptions[] } } }).deps.engine.seen).toHaveLength(0);
  });

  it('stops a reviewed tool plan at a mutation that lacks a fresh observation', async () => {
    const tools = fakeTools({ browser_navigate: { ok: true, content: 'Opened.' } });
    const h = harness({ outcomes: [], tools, approve: true });
    for (const tool of BUILTIN_TOOLS) h.registry.register(tool);
    const result = await h.agent.run({
      requestId: 'reviewed-plan-without-observation',
      request: { text: 'Run reviewed skill.', mode: 'agent' },
      model: 'deepseek-flash',
      allowedTools: ['browser_inspect', 'browser_navigate'],
      requireInitialObservation: true,
      toolPlan: [
        { id: 'plan_open_first', name: 'browser_navigate', argumentsJson: '{"url":"https://example.test/work"}' },
        { id: 'plan_should_not_run', name: 'browser_inspect', argumentsJson: '{}' },
      ],
    });

    expect(result.task.status).toBe('blocked');
    expect(result.executed.map((step) => step.name)).toEqual(['browser_navigate']);
    expect(tools.calls).toEqual([]);
    expect(result.task.steps[0]?.status).toBe('failed');
  });

  it('stops after an actual tool result fails a reviewed predicate', async () => {
    const tools = fakeTools({
      browser_inspect: { ok: true, content: 'URL: https://example.test/home' },
      browser_navigate: { ok: true, content: 'Opened https://example.test/other', detail: { url: 'https://example.test/other' }, verification: { summary: 'A page loaded', source: 'browser session' } },
    });
    const h = harness({ outcomes: [], tools, approve: true });
    for (const tool of BUILTIN_TOOLS) h.registry.register(tool);
    const result = await h.agent.run({
      requestId: 'reviewed-plan-predicate-failed',
      request: { text: 'Run reviewed skill.', mode: 'agent' },
      model: 'deepseek-flash',
      allowedTools: ['browser_inspect', 'browser_navigate'],
      requireInitialObservation: true,
      toolPlan: [
        { id: 'plan_observe', name: 'browser_inspect', argumentsJson: '{}' },
        { id: 'plan_navigate', name: 'browser_navigate', argumentsJson: '{"url":"https://example.test/work"}', expectation: { urlPrefix: 'https://example.test/work' } },
        { id: 'plan_must_not_run', name: 'browser_inspect', argumentsJson: '{}' },
      ],
    });

    expect(result.task.status).toBe('blocked');
    expect(tools.calls).toEqual(['browser_inspect', 'browser_navigate']);
    expect(result.finalContent).toContain('actual URL did not match');
  });

  it('uses one-shot skill input values while redacting them from stored task and audit records', async () => {
    const privateValue = 'one-time-search-term';
    const targetUrl = `https://example.test/search?q=${privateValue}`;
    const seenArgs: Array<Record<string, unknown>> = [];
    const tools: ToolRunner = {
      async run(name, args) {
        seenArgs.push(args);
        return name === 'browser_navigate'
          ? { ok: true, content: `Opened ${targetUrl.toUpperCase()}`, detail: { url: targetUrl }, verification: { summary: `Loaded ${targetUrl.toUpperCase()}`, source: 'browser session' } }
          : { ok: true, content: 'Observed the current page.' };
      },
      killAll: () => 0,
    };
    const h = harness({ outcomes: [], tools, approve: true });
    for (const tool of BUILTIN_TOOLS) h.registry.register(tool);
    const result = await h.agent.run({
      requestId: 'reviewed-plan-private-input',
      request: { text: 'Run a reviewed skill using the one-time input.', mode: 'agent' },
      model: 'deepseek-flash',
      allowedTools: ['browser_inspect', 'browser_navigate'],
      requireInitialObservation: true,
      redactValues: [privateValue],
      toolPlan: [
        { id: 'observe_before', name: 'browser_inspect', argumentsJson: '{}' },
        { id: 'navigate_with_input', name: 'browser_navigate', argumentsJson: JSON.stringify({ url: targetUrl }), expectation: { urlPrefix: 'https://example.test/search' } },
        { id: 'observe_after', name: 'browser_inspect', argumentsJson: '{}' },
      ],
    });

    const stored = JSON.stringify({ request: result.task.request, result: result.task.result, steps: result.task.steps, audit: h.audit.list(50) });
    expect(result.task.status).toBe('completed');
    expect(seenArgs[1]?.url).toBe(targetUrl);
    expect(stored).not.toContain(privateValue);
    expect(stored).toContain('[user input]');
  });

  it('requires fresh observation before the first action and between skill mutations', async () => {
    const tools = fakeTools({
      browser_inspect: { ok: true, content: 'The page is currently on the dashboard.' },
      browser_navigate: { ok: true, content: 'Navigation completed.', verification: { summary: 'Destination loaded', source: 'browser URL read-back' } },
    });
    const h = harness({
      outcomes: [
        toolStep('browser_navigate', { url: 'https://example.test' }),
        toolStep('browser_inspect', {}),
        toolStep('browser_navigate', { url: 'https://example.test' }),
        toolStep('browser_navigate', { url: 'https://example.test/next' }),
        toolStep('browser_inspect', {}),
        toolStep('browser_navigate', { url: 'https://example.test/next' }),
        plainAnswer('The destination loaded.'),
      ],
      tools,
      approve: true,
    });

    const result = await h.agent.run({
      requestId: 'skill-fresh-observation',
      request: { text: 'Run a reviewed browser skill.', mode: 'agent' },
      model: 'deepseek-flash',
      requireInitialObservation: true,
    });

    expect(tools.calls).toEqual(['browser_inspect', 'browser_navigate', 'browser_inspect', 'browser_navigate']);
    expect(h.prompts.map((prompt) => prompt.toolName)).toEqual(['browser_navigate', 'browser_navigate']);
    expect(result.task.steps.map((step) => step.status)).toEqual(['failed', 'done', 'verified', 'failed', 'done', 'verified']);
    expect(result.task.status).toBe('completed');
  });

  it('blocks another mutation until a prior browser action has a verified postcondition', async () => {
    const tools = fakeTools({
      browser_click: { ok: true, content: 'Click action was sent.' },
      browser_verify: { ok: true, content: 'The expected state is visible.', verification: { summary: 'The dialog appeared.', source: 'browser DOM read-back' } },
    });
    const h = harness({
      outcomes: [
        toolStep('browser_click', { selector: '#open' }),
        toolStep('browser_click', { selector: '#confirm' }),
        toolStep('browser_verify', { expected: 'Dialog title' }),
        plainAnswer('The dialog is open.'),
      ],
      tools,
      approve: true,
    });

    const result = await run(h.agent, 'verify-before-next-mutation');

    expect(tools.calls).toEqual(['browser_click', 'browser_verify']);
    expect(h.prompts.map((prompt) => prompt.toolName)).toEqual(['browser_click']);
    expect(result.task.steps.map((step) => step.status)).toEqual(['verified', 'failed', 'verified']);
    expect(result.task.pendingVerifications).toEqual([]);
    expect(result.task.status).toBe('completed');
  });
});

describe('clipboard privacy in durable task records', () => {
  it('does not persist clipboard text or the model response derived from it', async () => {
    const privateClipboardValue = 'copied private note 7654321';
    const tools = fakeTools({ clipboard_read: { ok: true, content: `Clipboard text: ${privateClipboardValue}` } });
    const h = harness({
      outcomes: [toolStep('clipboard_read', {}), plainAnswer(`The note says ${privateClipboardValue}.`)],
      tools,
      approve: true,
    });
    const result = await run(h.agent);

    expect(result.finalContent).toContain(privateClipboardValue);
    expect(result.task.result).toBe('Clipboard text was used for this session and is not retained in task history.');
    expect(JSON.stringify(result.task)).not.toContain(privateClipboardValue);
    expect(JSON.stringify(h.audit.list())).not.toContain(privateClipboardValue);
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

  it('routes a bounded specialist through the live model and normal tool gateway', async () => {
    const seen: RunTurnOptions[] = [];
    const engine: TurnRunner = {
      async runTurn(options) {
        seen.push(options);
        if (!options.suppressEvents) {
          return options.messages?.some((message) => message.role === 'tool')
            ? plainAnswer('The systems specialist reported 09:41.')
            : toolStep('delegate_to_specialist', { specialist: 'systems', objective: 'Read the local clock' });
        }
        return options.messages?.some((message) => message.role === 'tool')
          ? plainAnswer('The local time tool returned 09:41.')
          : toolStep('get_current_time', {});
      },
    };
    const tools = fakeTools({ get_current_time: { ok: true, content: '09:41' } });
    const h = harness({ outcomes: [], engine, tools });

    const result = await run(h.agent);

    expect(result.task.status).toBe('completed');
    expect(result.finalContent).toContain('systems specialist reported 09:41');
    expect(tools.calls).toEqual(['get_current_time']);
    expect(seen[1]?.suppressEvents).toBe(true);
    const specialistTools = seen[1]?.tools?.map((tool) => tool.name) ?? [];
    expect(specialistTools).toContain('get_current_time');
    expect(specialistTools).not.toContain('delegate_to_specialist');
    expect(specialistTools).not.toContain('clipboard_read');
    expect(result.task.steps.map((step) => step.toolName)).toEqual(['delegate_to_specialist', 'get_current_time']);
    expect(result.task.steps.map((step) => step.status)).toEqual(['done', 'done']);
    expect(result.executed.map((entry) => entry.name)).toEqual(['get_current_time', 'delegate_to_specialist']);
    expect(h.prompts).toHaveLength(0);
  });

  it('refuses a specialist tool call outside its declared capability set', async () => {
    const seen: RunTurnOptions[] = [];
    const engine: TurnRunner = {
      async runTurn(options) {
        seen.push(options);
        if (!options.suppressEvents) {
          return options.messages?.some((message) => message.role === 'tool')
            ? plainAnswer('The delegated request was refused.')
            : toolStep('delegate_to_specialist', { specialist: 'systems', objective: 'Inspect the clipboard contents' });
        }
        return toolStep('clipboard_read', {});
      },
    };
    const tools = fakeTools();
    const h = harness({ outcomes: [], engine, tools });
    const result = await run(h.agent);

    expect(result.task.status).toBe('completed');
    expect(tools.calls).toEqual([]);
    expect(seen[1]?.tools?.map((tool) => tool.name)).not.toContain('clipboard_read');
    expect(result.task.steps.map((step) => step.toolName)).toEqual(['delegate_to_specialist']);
    expect(result.task.steps[0]?.status).toBe('failed');
  });

  it('asks the user before a specialist runs an approval-gated action', async () => {
    const seen: RunTurnOptions[] = [];
    const engine: TurnRunner = {
      async runTurn(options) {
        seen.push(options);
        if (!options.suppressEvents) {
          return options.messages?.some((message) => message.role === 'tool')
            ? plainAnswer('The browser action was approved and completed.')
            : toolStep('delegate_to_specialist', { specialist: 'browser', objective: 'Open the selected page control' });
        }
        const usedTools = options.messages?.flatMap((message) => message.toolCalls ?? []).map((call) => call.name) ?? [];
        if (!usedTools.includes('browser_click')) return toolStep('browser_click', { selector: '#open' });
        if (!usedTools.includes('browser_verify')) return toolStep('browser_verify', { expected: 'Control opened' });
        return plainAnswer('The click was verified after approval.');
      },
    };
    const tools = fakeTools({
      browser_click: { ok: true, content: 'Clicked the selected control.' },
      browser_verify: { ok: true, content: 'The expected page state is visible.', verification: { summary: 'Control opened', source: 'browser DOM' } },
    });
    const h = harness({ outcomes: [], engine, tools, approve: true });

    const result = await h.agent.run({
      requestId: 'specialist-approval',
      request: { text: 'Use a browser specialist to open the selected control.', mode: 'agent' },
      model: 'deepseek-flash',
    });

    expect(result.task.status).toBe('completed');
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]?.toolName).toBe('browser_click');
    expect(tools.calls).toEqual(['browser_click', 'browser_verify']);
    expect(seen[1]?.tools?.map((tool) => tool.name)).toContain('browser_click');
  });
});

/* ------------------------------------------------------------------ *
 * Approval
 * ------------------------------------------------------------------ */

describe('agent loop - approval', () => {
  it('reads last external window metadata without prompting for permission', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('get_last_external_foreground_window', {}), plainAnswer('I could not inspect it.')],
      tools,
    });

    await run(h.agent);

    expect(h.prompts).toHaveLength(0);
    expect(h.broker.isPending()).toBe(false);
    expect(tools.calls).toEqual(['get_last_external_foreground_window']);
  });

  it('does not create a pending approval for read-only foreground metadata', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('get_foreground_window', {}), plainAnswer('Here is the active window.')],
      tools,
      deferApproval: true,
    });
    const result = await run(h.agent);

    expect(result.task.status).toBe('completed');
    expect(h.prompts).toHaveLength(0);
    expect(h.broker.isPending()).toBe(false);
    expect(tools.calls).toEqual(['get_foreground_window']);
  });

  it('suspends, asks, and executes once approved', async () => {
    const tools = fakeTools({ type_text: { ok: true, content: 'typed 5 characters' } });
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('Typed it.')],
      tools,
      approve: true,
    });

    const result = await run(h.agent);

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0].toolName).toBe('type_text');
    expect(h.prompts[0].changesData).toBe(true);
    expect(tools.calls).toEqual(['type_text']);
    expect(result.task.status).toBe('blocked');
    expect(result.task.pendingVerifications).toHaveLength(1);
    expect(result.finalContent).toMatch(/could not verify the result/i);
  });

  it('does not verify a UIA action against a different window identity', async () => {
    const target = {
      targetWindowId: 'window-one',
      expectedWindowTitle: 'Harmless fixture',
      expectedProcessId: 1234,
      expectedProcessName: 'fixture',
    };
    const tools = fakeTools({
      invoke_ui_element: { ok: true, content: 'Invoked.' },
      verify_ui_state: {
        ok: true,
        content: 'Postcondition found.',
        verification: { summary: 'Postcondition found.', source: 'UI Automation' },
      },
    });
    const h = harness({
      outcomes: [
        toolStep('invoke_ui_element', {
          selector: 'Run harmless action',
          ...target,
          expectedResult: { selector: 'Action completed', state: 'present', role: 'Text' },
        }),
        toolStep('verify_ui_state', {
          selector: 'Action completed',
          ...target,
          targetWindowId: 'window-two',
          role: 'Text',
          state: 'present',
        }),
        plainAnswer('The action is done.'),
      ],
      tools,
      approve: true,
    });

    const result = await run(h.agent);

    expect(result.task.pendingVerifications).toHaveLength(1);
    expect(result.task.steps.find((step) => step.toolName === 'invoke_ui_element')?.status).toBe('done');
    const storedArgs = result.task.steps.find((step) => step.toolName === 'invoke_ui_element')?.args;
    expect(storedArgs).not.toHaveProperty('targetWindowId');
    expect(storedArgs).not.toHaveProperty('expectedProcessId');
    expect(storedArgs).not.toHaveProperty('expectedProcessName');
  });

  it('does not execute when the user denies, and tells the model so', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('Understood.')],
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
      outcomes: [toolStep('type_text', { text: 'hello', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('ok')],
      approve: false,
    });
    await run(h.agent);
    expect(h.audit.list(50).some((e) => e.outcome === 'denied')).toBe(true);
  });

  it('sends the risk level so the UI can show an honest warning', async () => {
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'x', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('ok')],
      approve: false,
    });
    await run(h.agent);
    expect(h.prompts[0].risk).toBe('high');
  });

  it('honors a pause requested while approval is open', async () => {
    const tools = fakeTools({ type_text: { ok: true, content: 'typed 5 characters' } });
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('Typed it.')],
      tools,
      deferApproval: true,
    });
    const running = run(h.agent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.prompts).toHaveLength(1);
    const taskId = h.tasks.list()[0]?.id;
    expect(taskId).toBeDefined();
    h.tasks.pause(taskId!);
    h.broker.respond({ requestId: h.prompts[0].id, approved: true, duration: 'once' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.tasks.get(taskId!)?.status).toBe('paused');
    expect(tools.calls).toEqual([]);
    h.tasks.resume(taskId!);
    const result = await running;
    expect(tools.calls).toEqual(['type_text']);
    expect(result.task.status).toBe('blocked');
  });

  it('cancels promptly when the user stops a task with an approval open', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hello', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('should not run')],
      tools,
      deferApproval: true,
    });
    const running = run(h.agent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const taskId = h.tasks.list()[0]?.id;
    expect(taskId).toBeDefined();
    expect(h.broker.isPending()).toBe(true);
    h.tasks.cancel(taskId!);
    const result = await running;
    expect(result.task.status).toBe('cancelled');
    expect(h.broker.isPending()).toBe(false);
    expect(tools.calls).toEqual([]);
  });
});

describe('agent loop - human handoff', () => {
  it('requires an explicit continue and a fresh observation before any next action', async () => {
    let tasks: TaskManager | null = null;
    const calls: string[] = [];
    const tools: ToolRunner = {
      async run(name, args, signal, context): Promise<ToolResult> {
        if (name === 'request_human_takeover') {
          if (!tasks || !context || !signal) throw new Error('Task context was not passed to the tool runner.');
          const waiting = tasks.waitForHuman(context.taskId, String(args.reason), signal);
          queueMicrotask(() => tasks?.continueAfterHandoff(context.taskId));
          const continued = await waiting;
          return { ok: continued, content: 'User handoff acknowledged.' };
        }
        calls.push(name);
        if (name === 'open_application') {
          return { ok: true, content: 'Notepad opened.', verification: { summary: 'Notepad is present.', source: 'test window probe' } };
        }
        return { ok: true, content: 'Current browser page observed.' };
      },
      killAll: () => 0,
    };
    const h = harness({
      tools,
      approve: true,
      outcomes: [
        toolStep('request_human_takeover', { reason: 'Complete the MFA prompt yourself.' }),
        toolStep('open_application', { name: 'notepad' }, 'call_blocked_before_recheck'),
        toolStep('browser_inspect', {}, 'call_reobserve'),
        toolStep('open_application', { name: 'notepad' }, 'call_allowed_after_recheck'),
        plainAnswer('The handoff was rechecked before Notepad opened.'),
      ],
    });
    tasks = h.tasks;

    const result = await run(h.agent);
    expect(result.task.status).toBe('completed');
    expect(calls).toEqual(['browser_inspect', 'open_application']);
    expect(result.executed.find((step) => step.name === 'open_application' && !step.ok)?.summary).toMatch(/re-observation required/i);
    expect(h.prompts).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

describe('agent loop - failures', () => {
  it('records an unexpected model error and releases the task runner', async () => {
    const h = harness({
      outcomes: [],
      engine: {
        async runTurn(): Promise<TurnOutcome> {
          throw new Error('provider process failed');
        },
      },
    });

    const result = await run(h.agent);

    expect(result.task.status).toBe('failed');
    expect(result.finalContent).toBe('');
    expect(h.agent.isRunning).toBe(false);
    expect(h.tasks.runningCount()).toBe(0);
  });

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

  it('blocks completion and requires a fresh observation after a state-changing failure', async () => {
    const args = {
      text: 'harmless test text',
      selector: 'Editor',
      role: 'Edit',
      targetWindowId: 'window-test',
      expectedWindowTitle: 'Test window',
      expectedProcessId: 1234,
      expectedProcessName: 'notepad',
    };
    const tools = fakeTools({
      type_text: { ok: false, content: 'UI Automation could not confirm the action outcome.', errorCode: 'FAILED' },
    });
    const h = harness({
      outcomes: [toolStep('type_text', args, 'uncertain-text'), toolStep('type_text', args, 'unsafe-retry'), plainAnswer('The text was entered.')],
      tools,
      approve: true,
    });

    const result = await run(h.agent);

    expect(tools.calls).toEqual(['type_text']);
    expect(result.task.status).toBe('blocked');
    expect(result.task.reobserveRequired).toBe(true);
    expect(result.task.pendingVerifications).toHaveLength(1);
    expect(result.task.recoveryNote).toBeUndefined();
    expect(result.finalContent).toMatch(/cannot mark this task complete/i);
  });

  it('blocks a state-changing tool in Guide mode without asking', async () => {
    const tools = fakeTools();
    const h = harness({
      outcomes: [toolStep('type_text', { text: 'hi', selector: 'Editor', targetWindowId: 'window-test', expectedWindowTitle: 'Test window', expectedProcessId: 1234, expectedProcessName: 'notepad' }), plainAnswer('Guide mode cannot type.')],
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
