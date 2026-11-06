import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, ModelCapabilities } from '../src/shared/types';
import { openDatabase } from '../src/main/data/database';
import type { Database } from '../src/main/data/database';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { MEMORY_TOOL_DEFINITIONS } from '../src/main/memory/toolset';
import { DOCUMENT_TOOL_DEFINITIONS } from '../src/main/documents/toolset';
import {
  WorkflowStore,
  authorizeStep,
  definitionHash,
  isForbiddenStep,
  normaliseSteps,
  redactStep,
  replayWorkflow,
} from '../src/main/workflows/index';
import type { StepRunner, WorkflowStep } from '../src/main/workflows/index';
import {
  SPECIALISTS,
  SpecialistCoordinator,
  planDelegation,
  specialistForTool,
} from '../src/main/agents/coordinator';
import {
  BudgetTracker,
  LoopDetector,
  estimateCost,
  routeTask,
  summariseHistory,
  truncateToolOutput,
} from '../src/main/agent/budget';
import { OllamaProvider, recommendLocalModel } from '../src/main/providers/ollama';
import { PythonWorker } from '../src/main/services/python-worker';

const dirs: string[] = [];
const databases: Database[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-w3-'));
  dirs.push(dir);
  return dir;
}

function database(): Database {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

function project(db: Database, name = 'p'): string {
  const id = `prj_${name}`;
  db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    Date.now(),
    Date.now(),
  ]);
  return id;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================== *
 * Wave 3C - workflows
 * ================================================================== */

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  ordinal: 0,
  kind: 'browser',
  locator: '#submit',
  action: 'click',
  params: {},
  expectation: { textPresent: 'Saved' },
  ...overrides,
});

describe('workflow persistence', () => {
  it('creates, reads and lists a workflow', () => {
    const db = database();
    const store = new WorkflowStore(db);
    const p = project(db);

    const created = store.create(p, 'Inspect VMs', [step(), step({ locator: '#next' })]);
    expect(created.steps).toHaveLength(2);
    expect(created.steps[1].ordinal).toBe(1);

    const loaded = store.get(created.id);
    expect(loaded?.name).toBe('Inspect VMs');
    expect(loaded?.steps[0].locator).toBe('#submit');

    const listed = store.list(p);
    expect(listed).toHaveLength(1);
    expect(listed[0].steps).toBe(2);
  });

  it('renames, replaces steps and deletes', () => {
    const db = database();
    const store = new WorkflowStore(db);
    const p = project(db);
    const created = store.create(p, 'One', [step()]);

    store.rename(created.id, 'Two');
    expect(store.get(created.id)?.name).toBe('Two');

    store.replaceSteps(created.id, [step({ locator: '#a' }), step({ locator: '#b' }), step({ locator: '#c' })]);
    expect(store.get(created.id)?.steps).toHaveLength(3);

    expect(store.delete(created.id)).toBe(true);
    expect(store.get(created.id)).toBeNull();
  });

  it('survives a database restart', () => {
    const dir = tempDir();
    const path = join(dir, 'pixel.db');
    let db = openDatabase(path);
    const p = project(db);
    const created = new WorkflowStore(db).create(p, 'Persisted', [step()]);
    db.close();

    db = openDatabase(path);
    databases.push(db);
    const loaded = new WorkflowStore(db).get(created.id);
    expect(loaded?.name).toBe('Persisted');
    expect(loaded?.steps).toHaveLength(1);
  });

  it('detects a tampered definition', () => {
    const db = database();
    const store = new WorkflowStore(db);
    const p = project(db);
    const created = store.create(p, 'Intact', [step()]);
    expect(store.isIntact(created)).toBe(true);

    db.execute('UPDATE workflow_steps SET locator = ? WHERE workflow_id = ?', ['#tampered', created.id]);
    const reloaded = store.get(created.id);
    expect(reloaded).not.toBeNull();
    if (reloaded) expect(store.isIntact(reloaded)).toBe(false);
  });
});

describe('workflow definitions', () => {
  it('rejects an empty workflow', () => {
    expect(() => normaliseSteps([])).toThrow(/at least one/i);
  });

  it('rejects a step without a locator', () => {
    expect(() => normaliseSteps([step({ locator: '  ' })])).toThrow(/locator/i);
  });

  it('rejects an unsupported step kind', () => {
    expect(() =>
      normaliseSteps([step({ kind: 'mouse' as unknown as WorkflowStep['kind'] })]),
    ).toThrow(/unsupported kind/i);
  });

  it('produces a stable definition hash', () => {
    const steps = [step(), step({ locator: '#b' })];
    expect(definitionHash(steps)).toBe(definitionHash([...steps]));
    expect(definitionHash(steps)).not.toBe(definitionHash([step()]));
  });

  it('redacts secrets in recorded parameters', () => {
    const redacted = redactStep(step({ action: 'type', params: { password: 'hunter2', note: 'ok' } }));
    expect(redacted.params.password).toBe('[redacted]');
    expect(redacted.params.note).toBe('ok');
  });

  it('refuses to record typing into a password field', () => {
    expect(isForbiddenStep(step({ action: 'type', locator: '#password' }))).toBe(true);
    expect(isForbiddenStep(step({ action: 'type', locator: '#search' }))).toBe(false);
  });
});

describe('workflow replay', () => {
  const registry = new ToolRegistry();

  function runner(handlers: Record<string, { ok: boolean; observed: string }>): StepRunner {
    return {
      async run(workflowStep) {
        return handlers[workflowStep.locator] ?? { ok: true, observed: 'ok' };
      },
    };
  }

  it('runs every step and reports success', async () => {
    const db = database();
    const store = new WorkflowStore(db);
    const p = project(db);
    const workflow = store.create(p, 'Run', [step({ locator: '#a' }), step({ locator: '#b' })]);

    const result = await replayWorkflow(workflow, runner({}), {
      mode: 'agent',
      authorize: () => ({ allowed: true, reason: 'allowed', needsApproval: false }),
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((outcome) => outcome.status === 'done')).toBe(true);
  });

  it('stops at the first failed expectation', async () => {
    const db = database();
    const p = project(db);
    const workflow = new WorkflowStore(db).create(p, 'Fails', [
      step({ locator: '#a' }),
      step({ locator: '#b' }),
    ]);

    const result = await replayWorkflow(workflow, runner({ '#b': { ok: false, observed: 'button missing' } }), {
      mode: 'agent',
      authorize: () => ({ allowed: true, reason: 'allowed', needsApproval: false }),
    });

    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(2);
    expect(result.failure).toContain('button missing');
  });

  it('refuses a step the policy forbids, without asking', async () => {
    const db = database();
    const p = project(db);
    const workflow = new WorkflowStore(db).create(p, 'Guide', [step()]);

    const result = await replayWorkflow(workflow, runner({}), {
      mode: 'guide',
      authorize: () => ({ allowed: false, reason: 'Guide mode cannot click.', needsApproval: false }),
    });

    expect(result.status).toBe('denied');
    expect(result.failure).toContain('Guide mode');
  });

  it('requires fresh approval and stops when it is refused', async () => {
    const db = database();
    const p = project(db);
    const workflow = new WorkflowStore(db).create(p, 'Approve', [step()]);

    const result = await replayWorkflow(workflow, runner({}), {
      mode: 'hybrid',
      authorize: () => ({ allowed: false, reason: 'needs approval', needsApproval: true }),
      requestApproval: async () => false,
    });

    expect(result.status).toBe('denied');
    expect(result.steps[0].status).toBe('skipped');
  });

  it('honours cancellation between steps', async () => {
    const db = database();
    const p = project(db);
    const workflow = new WorkflowStore(db).create(p, 'Cancel', [step(), step()]);
    const controller = new AbortController();
    controller.abort();

    const result = await replayWorkflow(workflow, runner({}), {
      mode: 'agent',
      authorize: () => ({ allowed: true, reason: 'allowed', needsApproval: false }),
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.steps).toHaveLength(0);
  });

  it('maps workflow steps onto the central tool policy', () => {
    const guide = authorizeStep(registry, 'guide', step({ kind: 'browser' }));
    expect(guide.allowed).toBe(false);
    expect(guide.needsApproval).toBe(false);

    const tool = authorizeStep(registry, 'agent', step({ kind: 'tool', locator: 'get_current_time' }));
    expect(tool.allowed).toBe(true);
  });
});

/* ================================================================== *
 * Wave 3D - subagents
 * ================================================================== */

describe('subagent planning', () => {
  const registry = new ToolRegistry();

  it('grants a specialist only its own tools', () => {
    const plan = planDelegation({ specialist: 'browser', objective: 'inspect', mode: 'agent', projectId: 'p' }, registry);
    // Read-only tools are granted outright.
    expect(plan.tools).toContain('browser_inspect');
    // A tool outside the specialist's allowlist is never granted.
    expect(plan.tools).not.toContain('type_text');
    // Approval-gated tools are withheld until the user grants them.
    expect(plan.tools).not.toContain('browser_click');
    expect(plan.withheld.some((entry) => entry.tool === 'browser_click')).toBe(true);
  });

  it('withholds state-changing tools in guide mode and explains why', () => {
    const plan = planDelegation({ specialist: 'browser', objective: 'click', mode: 'guide', projectId: 'p' }, registry);
    expect(plan.tools).not.toContain('browser_click');
    expect(plan.withheld.some((entry) => /approval|guide/i.test(entry.reason))).toBe(true);
  });

  it('reports unimplemented specialists rather than pretending', () => {
    const plan = planDelegation({ specialist: 'code', objective: 'refactor', mode: 'agent', projectId: 'p' }, registry);
    expect(SPECIALISTS.code.allowedTools).toEqual([]);
    expect(plan.tools).toEqual([]);
  });

  it('routes a tool to the tightest specialist', () => {
    // The running app composes the built-in tools with the Wave 3 tool sets, so
    // this test does the same rather than assuming the base registry alone.
    const composed = new ToolRegistry([
      ...BUILTIN_TOOLS,
      ...MEMORY_TOOL_DEFINITIONS,
      ...DOCUMENT_TOOL_DEFINITIONS,
    ]);
    expect(specialistForTool('get_current_time', composed)).toBe('systems');
    expect(specialistForTool('memory_search', composed)).toBe('knowledge');
    expect(specialistForTool('type_text', composed)).toBeNull();
  });
});

describe('subagent execution', () => {
  const registry = new ToolRegistry();

  function coordinator(options: {
    stopped?: () => boolean;
    invoke?: (tool: string) => Promise<{ ok: boolean; content: string }>;
    now?: () => number;
  } = {}): SpecialistCoordinator {
    return new SpecialistCoordinator({
      registry,
      isStopped: options.stopped ?? (() => false),
      invokeTool: options.invoke ?? (async () => ({ ok: true, content: 'ok' })),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  const plan = planDelegation(
    { specialist: 'browser', objective: 'inspect', mode: 'agent', projectId: 'p' },
    registry,
  );

  it('completes within budget', async () => {
    const result = await coordinator().delegate(plan, (index) =>
      index < 2 ? { tool: 'browser_inspect', args: {} } : null,
    );

    expect(result.status).toBe('completed');
    expect(result.steps).toBe(2);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('refuses a tool outside the granted set', async () => {
    const result = await coordinator().delegate(plan, () => ({ tool: 'type_text', args: { text: 'x' } }));
    expect(result.status).toBe('refused');
    expect(result.failure).toContain('not granted');
  });

  it('stops on the emergency stop', async () => {
    const result = await coordinator({ stopped: () => true }).delegate(plan, () => ({
      tool: 'browser_inspect',
      args: {},
    }));
    expect(result.status).toBe('cancelled');
    expect(result.steps).toBe(0);
  });

  it('stops when the wall-clock budget is exhausted', async () => {
    let clock = 0;
    const result = await coordinator({ now: () => (clock += 100_000) }).delegate(plan, () => ({
      tool: 'browser_inspect',
      args: {},
    }));
    expect(result.status).toBe('failed');
    expect(result.failure).toMatch(/time limit/i);
  });

  it('stops when a tool is denied', async () => {
    const result = await coordinator({
      invoke: async () => ({ ok: false, content: 'The user denied the action.' }),
    }).delegate(plan, () => ({ tool: 'browser_inspect', args: {} }));
    expect(result.status).toBe('refused');
  });

  it('refuses to run an unimplemented specialist', async () => {
    const codePlan = planDelegation({ specialist: 'code', objective: 'x', mode: 'agent', projectId: 'p' }, registry);
    const result = await coordinator().delegate(codePlan, () => null);
    expect(result.status).toBe('refused');
  });
});

/* ================================================================== *
 * Wave 3E - Ollama and routing
 * ================================================================== */

describe('ollama provider', () => {
  function fakeFetch(routes: Record<string, unknown>, status = 200): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(routes).find((path) => url.includes(path));
      if (!key) return new Response('not found', { status: 404 });
      const body = routes[key];
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  it('reports unavailable when the server is down', async () => {
    const provider = new OllamaProvider({
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    const status = await provider.status();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/not reachable/i);
  });

  it('lists models and asks for their capabilities', async () => {
    const provider = new OllamaProvider({
      fetchImpl: fakeFetch({
        '/api/tags': { models: [{ name: 'llama3.2:3b', size: 2e9, details: { family: 'llama' } }] },
        '/api/show': { capabilities: ['completion', 'tools'] },
      }),
    });

    const status = await provider.status();
    expect(status.available).toBe(true);
    expect(status.models).toHaveLength(1);
    expect(status.models[0].capabilities.tools).toBe(true);
    expect(status.models[0].capabilities.vision).toBe(false);
  });

  it('fails closed when capability discovery fails', async () => {
    const provider = new OllamaProvider({ fetchImpl: fakeFetch({ '/api/tags': { models: [{ name: 'x' }] } }) });
    const capabilities = await provider.modelCapabilities('x');
    expect(capabilities).toEqual({ vision: false, tools: false });
  });

  it('reports a clear error when no model is installed', async () => {
    const provider = new OllamaProvider({ fetchImpl: fakeFetch({ '/api/tags': { models: [] }, '/api/show': {} }) });
    const result = await provider.testConnection('', 'anything');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/ollama pull/i);
  });

  it('streams a chat completion into app events', async () => {
    const frames = [
      { message: { content: 'Hel' }, done: false },
      { message: { content: 'lo' }, done: false },
      { message: { content: '' }, done: true, prompt_eval_count: 5, eval_count: 2 },
    ]
      .map((frame) => JSON.stringify(frame))
      .join('\n');

    const provider = new OllamaProvider({
      fetchImpl: fakeFetch({
        '/api/show': { capabilities: ['completion'] },
        '/api/chat': new Response(`${frames}\n`, { status: 200 }),
      }),
    });

    const events: string[] = [];
    const result = await provider.generate({
      requestId: 'r1',
      model: 'llama3.2:3b',
      messages: [{ id: 'm', role: 'user', content: 'hi', createdAt: 0 } as ChatMessage],
      thinking: { enabled: false, effort: 'low' },
      temperature: 0.5,
      maxTokens: 100,
      signal: new AbortController().signal,
      timeoutMs: 5000,
      onEvent: (event) => events.push(event.type),
    });

    expect(result.content).toBe('Hello');
    expect(events).toContain('text');
    expect(events).toContain('done');
  });

  it('recommends a model based on available memory', () => {
    expect(recommendLocalModel(32).model).toContain('8b');
    expect(recommendLocalModel(16).model).toContain('3b');
    expect(recommendLocalModel(8).model).toContain('0.5b');
  });
});

describe('routing and cost control', () => {
  const models: ModelCapabilities[] = [
    { id: 'deepseek-flash', label: 'Flash', vision: true, toolCalls: true, thinking: true, contextTokens: 1e6, maxOutputTokens: 393216, role: 'fast' },
    { id: 'deepseek-v4-pro', label: 'Pro', vision: false, toolCalls: true, thinking: true, contextTokens: 1e6, maxOutputTokens: 393216, role: 'reasoning' },
  ];

  it('routes simple work to the cheaper model', () => {
    const decision = routeTask({
      offline: false,
      deepseekModels: models,
      localModels: [],
      needsVision: false,
      needsTools: true,
      complexity: 'simple',
    });
    expect(decision.model).toBe('deepseek-flash');
  });

  it('routes hard work to the reasoning model', () => {
    const decision = routeTask({
      offline: false,
      deepseekModels: models,
      localModels: [],
      needsVision: false,
      needsTools: true,
      complexity: 'hard',
    });
    expect(decision.model).toBe('deepseek-v4-pro');
  });

  it('never routes vision to a model that cannot see', () => {
    const decision = routeTask({
      offline: false,
      deepseekModels: models,
      localModels: [],
      needsVision: true,
      needsTools: true,
      complexity: 'hard',
    });
    expect(decision.model).toBe('deepseek-flash');
  });

  it('falls back to a local model when offline', () => {
    const decision = routeTask({
      offline: true,
      deepseekModels: models,
      localModels: ['llama3.2:3b'],
      needsVision: false,
      needsTools: false,
      complexity: 'standard',
    });
    expect(decision.provider).toBe('ollama');
    expect(decision.model).toBe('llama3.2:3b');
  });

  it('explains when offline with no local model', () => {
    const decision = routeTask({
      offline: true,
      deepseekModels: models,
      localModels: [],
      needsVision: false,
      needsTools: false,
      complexity: 'simple',
    });
    expect(decision.reason).toMatch(/ollama pull/i);
  });

  it('computes estimated cost and local models are free', () => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    expect(estimateCost('deepseek-flash', usage)).toBeGreaterThan(0);
    expect(estimateCost('ollama', usage)).toBe(0);
  });

  it('enforces a daily spend ceiling', () => {
    const tracker = new BudgetTracker({ maxTokensPerRun: 1000, maxTokensPerDay: 1000, maxCostPerDay: 0.0001, maxSteps: 8 });
    tracker.record('deepseek-flash', 'deepseek', { promptTokens: 100_000, completionTokens: 100_000, totalTokens: 200_000 });
    const check = tracker.check();
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/limit/i);
  });

  it('detects a repeated identical tool call', () => {
    const detector = new LoopDetector(2);
    expect(detector.observe('browser_click', { selector: '#a' })).toBeNull();
    expect(detector.observe('browser_click', { selector: '#a' })).toMatch(/repeated/i);
  });

  it('detects a repeating cycle', () => {
    const detector = new LoopDetector(3);
    detector.observe('a', {});
    detector.observe('b', {});
    detector.observe('a', {});
    detector.observe('b', {});
    expect(detector.observe('a', {}) ?? detector.observe('b', {})).not.toBeNull();
  });

  it('truncates long tool output with a marker', () => {
    const output = truncateToolOutput('x'.repeat(10_000), 1_000);
    expect(output.length).toBeLessThan(1_500);
    expect(output).toContain('characters omitted');
  });

  it('condenses old history and keeps recent turns', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${String(index)}`,
    }));
    const condensed = summariseHistory(history, 4);
    expect(condensed).toHaveLength(5);
    expect(condensed[0].content).toMatch(/condensed/i);
    expect(condensed[4].content).toContain('message 9');
  });
});

/* ================================================================== *
 * Worker supervision
 * ================================================================== */

describe('python worker supervision', () => {
  function fakeWorker(script: string): PythonWorker {
    const dir = tempDir();
    // The supervisor looks for <workerRoot>/pixel_worker/worker.py; a Node script
    // there is enough to exercise supervision, since it only parses JSON frames.
    mkdirSync(join(dir, 'pixel_worker'), { recursive: true });
    writeFileSync(join(dir, 'pixel_worker', 'worker.py'), script);
    return new PythonWorker({
      pythonPath: process.execPath,
      workerRoot: dir,
      requestTimeoutMs: 2_000,
      maxRestarts: 1,
    });
  }

  it('reports CAPABILITY_MISSING when the interpreter does not exist', async () => {
    const worker = new PythonWorker({ pythonPath: '', workerRoot: tempDir() });
    // No script in the temp root, so availability fails before spawning.
    const result = await worker.extract('C:/nope.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['CAPABILITY_MISSING', 'WORKER_UNAVAILABLE']).toContain(result.error.code);
  });

  it('times out a request that never answers', async () => {
    const worker = fakeWorker('process.stdin.on("data", () => {}); setInterval(() => {}, 1000);');
    const result = await worker.extract('C:/nope.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['TIMEOUT', 'CAPABILITY_MISSING', 'WORKER_UNAVAILABLE']).toContain(result.error.code);
    await worker.shutdown();
  });
});
