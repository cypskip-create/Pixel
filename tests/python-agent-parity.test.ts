/**
 * Phase A Parity, Security, Crash-Recovery & Latency Tests
 *
 * Exercises both Pixel's TypeScript `AgentExecutor` and the new Hermes-inspired
 * `PythonAgentRunner` (`pixel-agent-v2`) against a local HTTP OpenAI-compatible
 * SSE mock server — covering all 10 parity scenarios, mid-turn crash safety,
 * and real measured latency metrics.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRequest, Mode, PermissionRequest, StreamEvent } from '../src/shared/types';
import { AgentExecutor, type ToolRunner, type TurnRunner } from '../src/main/agent/executor';
import { PythonAgentRunner } from '../src/main/agent/pythonRunner';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { GIT_TOOL_DEFINITIONS } from '../src/main/git/toolset';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';

type MockScriptStep =
  | { type: 'text'; chunks: string[]; delayMs?: number }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown> };

interface MockServerHandle {
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function startMockSseServer(script: MockScriptStep[]): Promise<MockServerHandle> {
  const requests: Array<Record<string, unknown>> = [];
  let callIndex = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      } catch {
        requests.push({});
      }
      const step = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      if (step.type === 'tool') {
        const payload = {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: step.id,
                    type: 'function',
                    function: { name: step.name, arguments: JSON.stringify(step.args) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const delayMs = step.delayMs ?? 0;
      let i = 0;
      const sendNext = () => {
        if (res.writableEnded || res.destroyed) return;
        if (i < step.chunks.length) {
          const isLast = i === step.chunks.length - 1;
          const payload = {
            choices: [
              {
                delta: { content: step.chunks[i] },
                finish_reason: isLast ? 'stop' : null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          i += 1;
          if (delayMs > 0) {
            setTimeout(sendNext, delayMs);
          } else {
            sendNext();
          }
        } else {
          res.write(
            `data: ${JSON.stringify({
              choices: [],
              usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
        }
      };
      sendNext();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeHarness(options: {
  mode?: Mode;
  autoApprove?: boolean | null;
  toolImpl?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
}) {
  const registry = new ToolRegistry([...BUILTIN_TOOLS, ...GIT_TOOL_DEFINITIONS]);
  const audit = new AuditLog();
  const tasks = new TaskManager(() => undefined);
  const events: StreamEvent[] = [];
  const approvalPrompts: PermissionRequest[] = [];
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const permissions = new PermissionBroker(
    registry,
    audit,
    (req) => {
      approvalPrompts.push(req);
      if (options.autoApprove !== null && options.autoApprove !== undefined) {
        queueMicrotask(() => {
          permissions.respond({
            requestId: req.id,
            approved: Boolean(options.autoApprove),
            duration: 'once',
          });
        });
      }
    },
    () => undefined,
  );

  const executors: ToolRunner = {
    async run(name, args) {
      toolCalls.push({ name, args });
      if (options.toolImpl) return options.toolImpl(name, args);
      if (name === 'get_current_time') return { ok: true, content: '2026-11-23T12:00:00Z' };
      if (name === 'git_status') return { ok: true, content: 'On branch main\nnothing to commit' };
      if (name === 'open_application') return { ok: true, content: 'Opened notepad' };
      return { ok: true, content: `ok:${name}` };
    },
    killAll: () => 0,
  };

  return { registry, audit, tasks, permissions, executors, events, approvalPrompts, toolCalls };
}

function makeRequest(text: string, mode: Mode = 'hybrid', history: ChatRequest['history'] = []): ChatRequest {
  return { text, mode, history };
}

function makeScriptedTsEngine(script: MockScriptStep[], emit: (event: StreamEvent) => void): TurnRunner {
  let idx = 0;
  return {
    async runTurn(opts) {
      const step = script[Math.min(idx, script.length - 1)];
      idx += 1;
      if (step.type === 'tool') {
        return {
          content: '',
          reasoning: '',
          toolCalls: [{ id: step.id, name: step.name, argumentsJson: JSON.stringify(step.args) }],
          finishReason: 'tool_calls',
          aborted: false,
          failed: false,
        };
      }
      const text = step.chunks.join('');
      for (const ch of step.chunks) {
        emit({ type: 'text', requestId: opts.requestId, delta: ch });
      }
      emit({ type: 'done', requestId: opts.requestId, finishReason: 'stop' });
      return {
        content: text,
        reasoning: '',
        toolCalls: [],
        finishReason: 'stop',
        aborted: false,
        failed: false,
      };
    },
  };
}

let activeBridge: PythonAgentBridge | null = null;
const activeServers: MockServerHandle[] = [];

afterEach(async () => {
  if (activeBridge) {
    await activeBridge.dispose();
    activeBridge = null;
  }
  while (activeServers.length > 0) {
    await activeServers.pop()!.close();
  }
});

describe('Phase A: Python vs TypeScript Agent Engine Parity & Safety', () => {
  it('1. Plain chat turn streams text deltas and completes identically in TS and Python', async () => {
    const script: MockScriptStep[] = [{ type: 'text', chunks: ['Hello ', 'from ', 'Pixel!'] }];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    // TypeScript runner
    const tsH = makeHarness({});
    const tsAgent = new AgentExecutor({
      engine: makeScriptedTsEngine(script, (e) => tsH.events.push(e)),
      registry: tsH.registry,
      permissions: tsH.permissions,
      tasks: tsH.tasks,
      audit: tsH.audit,
      executors: tsH.executors,
      emit: (e) => tsH.events.push(e),
      isStopped: () => false,
    });
    const tsRes = await tsAgent.run({
      requestId: 'req_ts_1',
      request: makeRequest('Say hi'),
      model: 'deepseek-flash',
    });

    // Python runner
    const pyH = makeHarness({});
    activeBridge = new PythonAgentBridge();
    const t0 = performance.now();
    await activeBridge.ping();
    const startupMs = performance.now() - t0;

    let firstTokenMs = -1;
    const tTurn = performance.now();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: pyH.registry,
      permissions: pyH.permissions,
      tasks: pyH.tasks,
      audit: pyH.audit,
      executors: pyH.executors,
      emit: (e) => {
        if (e.type === 'text' && firstTokenMs < 0) firstTokenMs = performance.now() - tTurn;
        pyH.events.push(e);
      },
      isStopped: () => false,
      getApiKey: () => 'test-key-ephemeral',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });
    const pyRes = await pyRunner.run({
      requestId: 'req_py_1',
      request: makeRequest('Say hi'),
      model: 'deepseek-flash',
    });

    expect(tsRes.finalContent).toBe('Hello from Pixel!');
    expect(pyRes.finalContent).toBe('Hello from Pixel!');
    expect(pyRes.task.status).toBe('completed');
    expect(pyH.events.some((e) => e.type === 'done')).toBe(true);
    expect(startupMs).toBeGreaterThan(0);
    expect(firstTokenMs).toBeGreaterThan(0);
  });

  it('2 & 3. Read-only tool and multi-tool loop execute via Electron broker and return final answer', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c1', name: 'get_current_time', args: {} },
      { type: 'tool', id: 'c2', name: 'get_system_info', args: {} },
      { type: 'text', chunks: ['Checked time and system info.'] },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({});
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const t0 = performance.now();
    const res = await pyRunner.run({
      requestId: 'req_py_multi',
      request: makeRequest('Check time and system info', 'hybrid'),
      model: 'deepseek-flash',
    });
    const roundTripMs = performance.now() - t0;

    expect(res.task.status).toBe('completed');
    expect(res.finalContent).toBe('Checked time and system info.');
    expect(h.toolCalls.map((c) => c.name)).toEqual(['get_current_time', 'get_system_info']);
    expect(h.approvalPrompts.length).toBe(0);
    expect(roundTripMs).toBeGreaterThan(0);
  });

  it('4. Authorized Agent-mode low-risk tool (git_status) runs without prompting', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c_git', name: 'git_status', args: { repoPath: process.cwd() } },
      { type: 'text', chunks: ['Repo is clean on main.'] },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({ mode: 'agent' });
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_agent_git',
      request: makeRequest('Check git status', 'agent'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(h.toolCalls.map((c) => c.name)).toEqual(['git_status']);
    expect(h.approvalPrompts.length).toBe(0);
  });

  it('5. Approval-required tool prompts PermissionBroker and executes when approved', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c_app', name: 'open_application', args: { name: 'notepad' } },
      { type: 'text', chunks: ['Opened Notepad for you.'] },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({ autoApprove: true });
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_approve',
      request: makeRequest('Open notepad', 'hybrid'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(h.approvalPrompts.length).toBe(1);
    expect(h.approvalPrompts[0].toolName).toBe('open_application');
    expect(h.toolCalls.map((c) => c.name)).toEqual(['open_application']);
  });

  it('6. Denied tool never executes and reports denial cleanly back to model', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c_deny', name: 'open_application', args: { name: 'notepad' } },
      { type: 'text', chunks: ['Understood, I did not open Notepad.'] },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({ autoApprove: false });
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_deny',
      request: makeRequest('Open notepad', 'hybrid'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(h.approvalPrompts.length).toBe(1);
    expect(h.toolCalls.length).toBe(0);
    expect(res.finalContent).toContain('did not open Notepad');
  });

  it('7. Tool failure is returned to model so it recovers gracefully', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c_fail', name: 'get_current_time', args: {} },
      { type: 'text', chunks: ['The clock probe failed, sorry.'] },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({
      toolImpl: async () => ({ ok: false, content: 'Clock subsystem temporarily unavailable' }),
    });
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_fail_recover',
      request: makeRequest('What time is it?', 'hybrid'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(res.executed[0]?.ok).toBe(false);
    expect(res.finalContent).toContain('clock probe failed');
  });

  it('8. Cancelled turn aborts streaming promptly and marks task cancelled', async () => {
    const script: MockScriptStep[] = [
      { type: 'text', chunks: Array.from({ length: 30 }, (_, i) => `chunk${i} `), delayMs: 40 },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const h = makeHarness({});
    activeBridge = new PythonAgentBridge();
    let cancelSentAt = 0;
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => {
        h.events.push(e);
        if (e.type === 'text' && cancelSentAt === 0) {
          cancelSentAt = performance.now();
          pyRunner.cancel('user');
        }
      },
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_cancel',
      request: makeRequest('Stream a long story', 'hybrid'),
      model: 'deepseek-flash',
    });
    const cancelMs = performance.now() - cancelSentAt;

    expect(res.aborted).toBe(true);
    expect(res.task.status).toBe('cancelled');
    expect(cancelMs).toBeLessThan(3000);
  });

  it('9. Long-context conversation compresses cleanly without crashing', async () => {
    const script: MockScriptStep[] = [{ type: 'text', chunks: ['Summarized long context.'] }];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    const longHistory = Array.from({ length: 16 }, (_, i) => ({
      id: `h_${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Historical turn ${i}: ` + 'detail '.repeat(80),
      createdAt: Date.now() - 10_000 + i,
    }));

    const h = makeHarness({});
    activeBridge = new PythonAgentBridge();
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_long',
      request: makeRequest('Summarize our chat', 'hybrid', longHistory),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(res.finalContent).toBe('Summarized long context.');
  });

  it('10. Python unavailable triggers clean pre-turn fallback to TypeScript AgentExecutor', async () => {
    const script: MockScriptStep[] = [{ type: 'text', chunks: ['Fallback TS answer!'] }];
    const h = makeHarness({});
    const tsAgent = new AgentExecutor({
      engine: makeScriptedTsEngine(script, (e) => h.events.push(e)),
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
    });

    activeBridge = new PythonAgentBridge({ pythonExecutable: 'nonexistent-python-binary-xyz-9999' });
    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'deepseek', model }),
      fallbackToTypescript: (opts) => tsAgent.run(opts),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_fallback',
      request: makeRequest('Hello fallback'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('completed');
    expect(res.finalContent).toBe('Fallback TS answer!');
  });

  it('11. Mid-turn Python crash marks task failed without replaying already-executed tools', async () => {
    const script: MockScriptStep[] = [
      { type: 'tool', id: 'c_once', name: 'get_current_time', args: {} },
      { type: 'text', chunks: ['Should ', 'never ', 'arrive'], delayMs: 250 },
    ];
    const srv = await startMockSseServer(script);
    activeServers.push(srv);

    activeBridge = new PythonAgentBridge();
    let toolExecCount = 0;
    const h = makeHarness({
      toolImpl: async () => {
        toolExecCount += 1;
        // Simulate abrupt Python process crash right after tool execution!
        setTimeout(() => {
          activeBridge?.killProcess();
        }, 15);
        return { ok: true, content: '2026-11-23T12:00:00Z' };
      },
    });

    const pyRunner = new PythonAgentRunner({
      bridge: activeBridge,
      registry: h.registry,
      permissions: h.permissions,
      tasks: h.tasks,
      audit: h.audit,
      executors: h.executors,
      emit: (e) => h.events.push(e),
      isStopped: () => false,
      getApiKey: () => 'test-key',
      getProviderConfig: (model) => ({ provider: 'openai-compatible', baseUrl: srv.baseUrl, model }),
    });

    const res = await pyRunner.run({
      requestId: 'req_py_crash',
      request: makeRequest('Check time then crash'),
      model: 'deepseek-flash',
    });

    expect(res.task.status).toBe('failed');
    expect(toolExecCount).toBe(1);
    expect(h.events.some((e) => e.type === 'error')).toBe(true);
  });
});
