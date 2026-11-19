import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentExecutor } from '../src/main/agent/executor';
import type { TurnOutcome } from '../src/main/agent/conversation';
import { ToolExecutors } from '../src/main/agent/executors';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { PixelBoardService } from '../src/main/board/service';
import { BOARD_TOOL_DEFINITIONS } from '../src/main/board/tools';
import type { ChatRequest, ToolCall } from '../src/shared/types';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Pixel Board agent tools', () => {
  it('discovers strict Board schemas and executes a diagram through the real agent dispatcher', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-board-agent-'));
    roots.push(root);
    const board = new PixelBoardService(join(root, 'active-board.json'));
    const registry = new ToolRegistry([...BUILTIN_TOOLS, ...BOARD_TOOL_DEFINITIONS]);
    const diagramArgs = {
      title: 'Network Architecture',
      nodes: ['PC', 'Switch', 'Router', 'Internet'],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }],
    };
    expect(registry.validateArgs('board_create_diagram', diagramArgs)).toEqual({ ok: true });
    expect(registry.validateArgs('board_create_diagram', { ...diagramArgs, extra: true }).ok).toBe(false);
    expect(registry.schemasFor('agent').some((tool) => tool.name === 'board_create_diagram')).toBe(true);
    expect(registry.schemasFor('guide').some((tool) => tool.name === 'board_create_diagram')).toBe(false);

    const toolCall: ToolCall = { id: 'call_board_diagram', name: 'board_create_diagram', argumentsJson: JSON.stringify(diagramArgs) };
    const outcomes: TurnOutcome[] = [
      { content: '', reasoning: '', toolCalls: [toolCall], finishReason: 'tool_calls', aborted: false, failed: false },
      { content: 'The network diagram is on Pixel Board.', reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false },
    ];
    const seenTools: string[][] = [];
    const engine = {
      async runTurn(options: { request: ChatRequest }): Promise<TurnOutcome> {
        seenTools.push(registry.schemasFor(options.request.mode).map((tool) => tool.name));
        return outcomes.shift() ?? { content: 'done', reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false };
      },
    };
    const audit = new AuditLog();
    const tasks = new TaskManager(() => undefined);
    const permissions = new PermissionBroker(registry, audit, () => undefined);
    const focusBoard = vi.fn();
    const executors = new ToolExecutors({ board, focusBoard });
    const agent = new AgentExecutor({
      engine,
      registry,
      permissions,
      tasks,
      audit,
      executors,
      emit: () => undefined,
      isStopped: () => false,
    });

    const result = await agent.run({ requestId: 'board-request', request: { text: 'Draw a network diagram.', mode: 'agent' }, model: 'deepseek-flash' });
    const snapshot = board.getSnapshot();
    expect(result.task.status).toBe('completed');
    expect(result.executed.map((item) => item.name)).toEqual(['board_create_diagram']);
    expect(result.executed[0]?.ok).toBe(true);
    expect(result.finalContent).toContain('network diagram');
    expect(seenTools[0]).toContain('board_create_diagram');
    expect(snapshot.document.title).toBe('Network Architecture');
    expect(snapshot.document.objects).toHaveLength(12);
    expect(snapshot.document.objects.filter((object) => object.kind === 'arrow')).toHaveLength(3);
    expect(focusBoard).toHaveBeenCalledOnce();
  });

  it('keeps undoable Board operations available in Agent and Hybrid, but never in Guide', () => {
    const registry = new ToolRegistry([...BUILTIN_TOOLS, ...BOARD_TOOL_DEFINITIONS]);
    expect(registry.availableFor('agent').some((tool) => tool.name === 'board_clear')).toBe(true);
    expect(registry.availableFor('hybrid').some((tool) => tool.name === 'board_clear')).toBe(true);
    expect(registry.availableFor('guide').some((tool) => tool.name === 'board_clear')).toBe(false);
    expect(registry.evaluate('board_clear', 'agent', {}).allowed).toBe(true);
    expect(registry.evaluate('board_clear', 'guide', {}).allowed).toBe(false);
  });

  it('wraps agent notes and finds a separate area before committing each block', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-board-text-'));
    roots.push(root);
    const board = new PixelBoardService(join(root, 'active-board.json'));
    const executors = new ToolExecutors({ board });
    const first = await executors.run('board_add_text', { text: 'A note with enough words to wrap cleanly across the editable Pixel Board text block.' });
    const second = await executors.run('board_add_text', { text: 'A second note is kept in a different open row to avoid overlapping the first.' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const textObjects = board.getSnapshot().document.objects.filter((object) => object.kind === 'text');
    expect(textObjects).toHaveLength(2);
    expect(textObjects[0]?.text).toContain('\n');
    expect(textObjects[1]?.points[0]?.y).toBeGreaterThan(textObjects[0]?.points[0]?.y ?? 0);
  });
});
