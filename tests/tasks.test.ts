import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentExecutor } from '../src/main/agent/executor';
import { openDatabase } from '../src/main/data/database';
import { AuditLog, PermissionBroker, TaskManager } from '../src/main/agent/runtime';
import { ToolExecutors } from '../src/main/agent/executors';
import { BUILTIN_TOOLS, ToolRegistry } from '../src/main/agent/tools';
import { FILE_TOOL_DEFINITIONS, FileTools } from '../src/main/files/toolset';
import { TaskStore } from '../src/main/tasks/store';
import type { ChatRequest, TaskRecord, ToolCall } from '../src/shared/types';
import type { TurnOutcome } from '../src/main/agent/conversation';
import type { TurnRunner } from '../src/main/agent/executor';

function task(status: TaskRecord['status'] = 'running'): TaskRecord {
  return {
    id: 'task_test_1',
    title: 'Create a note',
    status,
    steps: [
      {
        id: 'step_1',
        title: 'Write a note',
        status: 'done',
        toolName: 'file_write',
        args: { path: 'C:/safe/note.txt', content: '[not stored; 12 characters]' },
      },
    ],
    createdAt: 1_700_000_000_000,
    request: 'Create a note with api_key=sk-12345678901234567890',
    result: 'Completed with Bearer abcdefghijklmnop',
    budget: {
      deadlineAt: 1_700_000_300_000,
      maxTurns: 8,
      turnsUsed: 1,
      retryCount: 0,
      maxRetries: 0,
      maxModelTokens: 32_000,
      modelTokensUsed: 100,
    },
  };
}

describe('durable task store', () => {
  it('persists validated snapshots and redacts secrets and action contents', () => {
    const db = openDatabase(':memory:');
    try {
      const store = new TaskStore(db);
      store.save(task());

      const [loaded] = store.load();
      expect(loaded?.status).toBe('running');
      expect(loaded?.request).not.toContain('sk-12345678901234567890');
      expect(loaded?.request).toContain('[redacted]');
      expect(loaded?.result).toBe('Completed with Bearer [redacted]');
      expect(loaded?.steps[0]?.args?.content).toBe('[not stored]');
      expect(store.events('task_test_1')[0]).toMatchObject({ eventType: 'created', status: 'running' });
    } finally {
      db.close();
    }
  });

  it('restores interrupted work as paused without resuming it', () => {
    const db = openDatabase(':memory:');
    try {
      const store = new TaskStore(db);
      store.save(task('awaiting_approval'));

      const recovered = new TaskManager(() => undefined, store).get('task_test_1');
      expect(recovered?.status).toBe('paused');
      expect(recovered?.recoveryNote).toMatch(/restarted/i);
      expect(recovered?.checkpoint?.summary).toMatch(/no action was resumed/i);
      expect(store.events('task_test_1')[0]?.status).toBe('paused');
    } finally {
      db.close();
    }
  });

  it('skips an invalid persisted row instead of blocking other task recovery', () => {
    const db = openDatabase(':memory:');
    try {
      const store = new TaskStore(db);
      store.save(task('completed'));
      db.execute(
        `INSERT INTO tasks (id, title, status, created_at, ended_at, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['broken', 'Broken task', 'running', 2, null, '{bad json', 2],
      );
      expect(store.load().map((item) => item.id)).toEqual(['task_test_1']);
    } finally {
      db.close();
    }
  });
});

describe('task safe-point controls', () => {
  it('keeps task state available when the renderer notification fails', () => {
    const errors: unknown[] = [];
    const manager = new TaskManager(
      () => { throw new Error('renderer was closed'); },
      undefined,
      (error) => errors.push(error),
    );

    expect(() => manager.upsert(task())).not.toThrow();
    expect(manager.get('task_test_1')?.status).toBe('running');
    expect(errors).toHaveLength(1);
  });

  it('pauses at a checkpoint and resumes without replaying the finished step', async () => {
    const manager = new TaskManager(() => undefined);
    manager.upsert(task());
    const controller = new AbortController();
    manager.registerControl('task_test_1', { cancel: () => controller.abort() });
    manager.pause('task_test_1');

    const waiting = manager.waitUntilRunnable('task_test_1', 'before_tool', controller.signal);
    expect(manager.get('task_test_1')?.status).toBe('paused');
    expect(manager.get('task_test_1')?.steps[0]?.status).toBe('done');
    manager.resume('task_test_1');

    await expect(waiting).resolves.toBe(true);
    expect(manager.get('task_test_1')?.status).toBe('running');
    expect(manager.get('task_test_1')?.steps[0]?.status).toBe('done');
    manager.unregisterControl('task_test_1');
  });

  it('releases a paused checkpoint when cancelled', async () => {
    const manager = new TaskManager(() => undefined);
    manager.upsert(task());
    const controller = new AbortController();
    manager.registerControl('task_test_1', { cancel: () => controller.abort() });
    manager.pause('task_test_1');
    const waiting = manager.waitUntilRunnable('task_test_1', 'before_model', controller.signal);

    manager.cancel('task_test_1');

    await expect(waiting).resolves.toBe(false);
    expect(manager.get('task_test_1')?.status).toBe('cancelling');
    manager.unregisterControl('task_test_1');
  });

  it('waits for explicit handoff acknowledgement and requires re-observation', async () => {
    const manager = new TaskManager(() => undefined);
    manager.upsert(task());
    const controller = new AbortController();
    manager.registerControl('task_test_1', { cancel: () => controller.abort() });
    const waiting = manager.waitForHuman('task_test_1', 'Complete the MFA prompt yourself.', controller.signal);
    expect(manager.get('task_test_1')).toMatchObject({ status: 'awaiting_user', handoffReason: 'Complete the MFA prompt yourself.' });
    expect(manager.continueAfterHandoff('task_test_1')).toBe(true);
    await expect(waiting).resolves.toBe(true);
    expect(manager.get('task_test_1')).toMatchObject({ status: 'running', reobserveRequired: true });
    expect(manager.get('task_test_1')?.evidence?.at(-1)?.summary).toMatch(/re-observation is still required/i);
  });

  it('cancels a pending handoff and rejects a late continue action', async () => {
    const manager = new TaskManager(() => undefined);
    manager.upsert(task());
    const controller = new AbortController();
    manager.registerControl('task_test_1', { cancel: () => controller.abort() });
    const waiting = manager.waitForHuman('task_test_1', 'Complete a sensitive step.', controller.signal);
    manager.cancel('task_test_1');
    await expect(waiting).resolves.toBe(false);
    expect(manager.continueAfterHandoff('task_test_1')).toBe(false);
  });
});

describe('durable file task integration', () => {
  it('creates a file, reads it back, and persists verified task evidence', async () => {
    const root = mkdtempSync(join(homedir(), '.pixel-task-test-'));
    const database = openDatabase(':memory:');
    try {
      const registry = new ToolRegistry([...BUILTIN_TOOLS, ...FILE_TOOL_DEFINITIONS]);
      const audit = new AuditLog();
      const tasks = new TaskManager(() => undefined, new TaskStore(database));
      const files = new FileTools();
      const broker = new PermissionBroker(registry, audit, (approval) => {
        queueMicrotask(() => {
          broker.respond({ requestId: approval.id, approved: true, duration: 'once' });
        });
      });
      const args = { path: join(root, 'sample-note.txt'), content: 'Pixel task verified.' };
      const call: ToolCall = {
        id: 'file_write_call',
        name: 'file_write',
        argumentsJson: JSON.stringify(args),
        arguments: args,
      };
      let turn = 0;
      const engine: TurnRunner = {
        async runTurn(): Promise<TurnOutcome> {
          turn += 1;
          return turn === 1
            ? { content: '', reasoning: '', toolCalls: [call], finishReason: 'tool_calls', aborted: false, failed: false }
            : { content: 'Created the note and confirmed its contents.', reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false };
        },
      };
      const agent = new AgentExecutor({
        engine,
        registry,
        permissions: broker,
        tasks,
        audit,
        executors: new ToolExecutors({ files }),
        emit: () => undefined,
        isStopped: () => false,
      });
      const request: ChatRequest = { text: 'Create the sample note.', mode: 'hybrid' };

      const result = await agent.run({ requestId: 'durable-file-task', request, model: 'deepseek-flash' });
      const [persisted] = new TaskStore(database).load();

      expect(result.task.status).toBe('completed');
      expect(result.task.steps[0]?.status).toBe('verified');
      expect(result.task.evidence?.some((item) => item.kind === 'verification')).toBe(true);
      expect(readFileSync(args.path, 'utf8')).toBe(args.content);
      expect(persisted?.status).toBe('completed');
      expect(persisted?.steps[0]?.args?.content).toBe('[not stored]');
      expect(persisted?.result).toContain('confirmed its contents');
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not create the requested file when the user denies approval', async () => {
    const root = mkdtempSync(join(homedir(), '.pixel-task-denied-'));
    const registry = new ToolRegistry([...BUILTIN_TOOLS, ...FILE_TOOL_DEFINITIONS]);
    const audit = new AuditLog();
    const tasks = new TaskManager(() => undefined);
    const broker = new PermissionBroker(registry, audit, (approval) => {
      queueMicrotask(() => {
        broker.respond({ requestId: approval.id, approved: false, duration: 'once' });
      });
    });
    const path = join(root, 'denied-note.txt');
    const args = { path, content: 'must not be written' };
    const call: ToolCall = {
      id: 'denied_file_write_call',
      name: 'file_write',
      argumentsJson: JSON.stringify(args),
      arguments: args,
    };
    let turn = 0;
    const engine: TurnRunner = {
      async runTurn(): Promise<TurnOutcome> {
        turn += 1;
        return turn === 1
          ? { content: '', reasoning: '', toolCalls: [call], finishReason: 'tool_calls', aborted: false, failed: false }
          : { content: 'I did not create the file.', reasoning: '', toolCalls: [], finishReason: 'stop', aborted: false, failed: false };
      },
    };
    try {
      const agent = new AgentExecutor({
        engine,
        registry,
        permissions: broker,
        tasks,
        audit,
        executors: new ToolExecutors({ files: new FileTools() }),
        emit: () => undefined,
        isStopped: () => false,
      });

      const result = await agent.run({
        requestId: 'denied-file-task',
        request: { text: 'Create the note.', mode: 'hybrid' },
        model: 'deepseek-flash',
      });

      expect(result.task.status).toBe('completed');
      expect(result.task.steps[0]?.status).toBe('failed');
      expect(existsSync(path)).toBe(false);
      expect(audit.list().some((entry) => entry.outcome === 'denied')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
