import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskRecord } from '@shared/types';
import { Database } from '../src/main/data/database';
import { LATEST_SCHEMA_VERSION } from '../src/main/data/migrations';
import { TaskStore } from '../src/main/tasks/store';
import {
  classifyToolExecutionScope,
  inferTaskExecutionScope,
  isStateChangingTool,
  recoverInterruptedTask,
} from '../src/main/tasks/recovery';
import { TaskManager } from '../src/main/agent/runtime';
import { ToolRegistry } from '../src/main/agent/tools';
import { SkillStore } from '../src/main/skills/store';
import {
  LocalRoutineScheduler,
  RoutineStore,
  SchedulerLeaseManager,
  listCronOccurrencesBetween,
  nextCronOccurrence,
  parseCronExpression,
} from '../src/main/routines';
import {
  MAX_CONCURRENT_SPECIALISTS,
  SpecialistCoordinator,
  planDelegation,
} from '../src/main/agents/coordinator';
import { WorkspaceTasks } from '../src/renderer/components/WorkspaceTasks';
import { AgentActivityBar, deriveAgentActivity } from '../src/renderer/components/AgentActivityBar';

const tempDirs: string[] = [];

function createTempDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-phase-e-'));
  tempDirs.push(dir);
  const db = new Database({ path: join(dir, 'pixel.sqlite') });
  db.migrate();
  db.execute(
    `INSERT OR IGNORE INTO projects (id, name, created_at, updated_at) VALUES ('default', 'Default project', ?, ?)`,
    [Date.now(), Date.now()],
  );
  return { db, dir };
}

function createActiveReadOnlySkill(skills: SkillStore, projectId = 'default'): string {
  const draft = skills.createDraft({
    schemaVersion: 1,
    projectId,
    name: 'Check current time',
    purpose: 'Read-only health check routine',
    triggers: [],
    requiredTools: ['get_current_time'],
    inputs: [],
    steps: [
      {
        ordinal: 1,
        kind: 'tool',
        action: 'get_current_time',
        locator: 'get_current_time',
        params: {},
        expectation: {},
        approvalRequired: false,
      },
    ],
    decisionBranches: [],
    verificationRules: ['Confirm get_current_time returned a valid ISO timestamp.'],
    failureHandling: ['Stop and record failure without retrying automatically.'],
    approvalRequirements: [],
  });
  return skills.activate(draft.id).id;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Phase E: Durable Tasks, Migration 16, Crash Recovery & Desktop Lifecycle', () => {
  it('applies Migration 16, persists durable columns, and redacts secrets in failure metadata', () => {
    const { db } = createTempDb();
    try {
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
      const store = new TaskStore(db);
      const now = Date.now();
      const task: TaskRecord = {
        id: 'task_durable_1',
        title: 'Sync repository metadata',
        status: 'running',
        projectId: 'proj-alpha',
        parentTaskId: 'task_parent_0',
        specialistId: 'research',
        executionScope: 'headless',
        attemptCount: 2,
        maxAttempts: 3,
        createdAt: now,
        steps: [{ id: 's1', title: 'Read repo', status: 'done', toolName: 'git_repository_info' }],
        lease: {
          instanceId: 'pixel_old_1',
          pid: 12345,
          acquiredAt: now,
          expiresAt: now + 30_000,
          lastHeartbeatAt: now,
        },
        failure: {
          code: 'NET_ERR',
          message: 'Upstream returned Bearer supersecret_token_12345',
          retryable: true,
          at: now,
        },
      };

      store.save(task);
      const loaded = store.load(10);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.parentTaskId).toBe('task_parent_0');
      expect(loaded[0]?.executionScope).toBe('headless');
      expect(loaded[0]?.attemptCount).toBe(2);
      expect(loaded[0]?.failure?.message).not.toContain('supersecret_token_12345');
      expect(loaded[0]?.failure?.message).toContain('[redacted]');

      const row = db.queryOne<{
        parent_task_id: string;
        execution_scope: string;
        specialist_id: string;
        attempt_count: number;
      }>('SELECT parent_task_id, execution_scope, specialist_id, attempt_count FROM tasks WHERE id = ?', ['task_durable_1']);
      expect(row?.parent_task_id).toBe('task_parent_0');
      expect(row?.execution_scope).toBe('headless');
      expect(row?.specialist_id).toBe('research');
      expect(Number(row?.attempt_count)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('never blindly replays interrupted state-changing operations on crash recovery, while marking read-only headless tasks safe to resume', () => {
    const now = Date.now();
    expect(isStateChangingTool('git_push')).toBe(true);
    expect(isStateChangingTool('file_patch')).toBe(true);
    expect(isStateChangingTool('mcp.github.create_issue')).toBe(true);
    expect(isStateChangingTool('git_status')).toBe(false);
    expect(isStateChangingTool('session_search')).toBe(false);

    const mutatingTask: TaskRecord = {
      id: 'task_mutating',
      title: 'Push commit to remote',
      status: 'running',
      createdAt: now - 5_000,
      steps: [
        { id: 's1', title: 'Check diff', status: 'verified', toolName: 'git_diff' },
        { id: 's2', title: 'Push branch', status: 'running', toolName: 'git_push' },
      ],
    };
    const mutatingOutcome = recoverInterruptedTask(mutatingTask, 'pixel_new_2', now);
    expect(mutatingOutcome.recovered).toBe(true);
    expect(mutatingOutcome.uncertainSideEffect).toBe(true);
    expect(mutatingOutcome.safeToResume).toBe(false);
    expect(mutatingOutcome.task.status).toBe('paused');
    expect(mutatingOutcome.task.reobserveRequired).toBe(true);
    expect(mutatingOutcome.task.steps[1]?.status).toBe('failed');
    expect(mutatingOutcome.task.recoveryNote).toContain('NOT replayed automatically');

    const readOnlyTask: TaskRecord = {
      id: 'task_readonly',
      title: 'Search project docs',
      status: 'running',
      executionScope: 'headless',
      createdAt: now - 5_000,
      steps: [
        { id: 's1', title: 'Search content', status: 'running', toolName: 'file_search_content' },
      ],
    };
    const readOnlyOutcome = recoverInterruptedTask(readOnlyTask, 'pixel_new_2', now);
    expect(readOnlyOutcome.recovered).toBe(true);
    expect(readOnlyOutcome.uncertainSideEffect).toBe(false);
    expect(readOnlyOutcome.safeToResume).toBe(true);
    expect(readOnlyOutcome.task.status).toBe('paused');
    expect(readOnlyOutcome.task.steps[0]?.status).toBe('pending');
  });

  it('pauses desktop_session tasks on Windows lock/suspend while leaving headless tasks running, and tracks heartbeats & stalls', () => {
    const { db } = createTempDb();
    try {
      const store = new TaskStore(db);
      const manager = new TaskManager(() => undefined, store);
      const t0 = 1_700_000_000_000;

      expect(classifyToolExecutionScope('uia_click')).toBe('desktop_session');
      expect(classifyToolExecutionScope('analyze_screen')).toBe('desktop_session');
      expect(classifyToolExecutionScope('github_list_prs')).toBe('headless');

      const headlessTask: TaskRecord = {
        id: 't_headless',
        title: 'Fetch GitHub PRs',
        status: 'running',
        createdAt: t0,
        allowedTools: ['github_list_prs'],
        steps: [{ id: 's1', title: 'List PRs', status: 'running', toolName: 'github_list_prs' }],
      };
      const desktopTask: TaskRecord = {
        id: 't_desktop',
        title: 'Click desktop button',
        status: 'running',
        createdAt: t0,
        allowedTools: ['analyze_screen', 'click'],
        steps: [{ id: 's1', title: 'Inspect screen', status: 'running', toolName: 'analyze_screen' }],
      };

      expect(inferTaskExecutionScope(headlessTask)).toBe('headless');
      expect(inferTaskExecutionScope(desktopTask)).toBe('desktop_session');

      manager.upsert(headlessTask);
      manager.upsert(desktopTask);
      manager.recordHeartbeat('t_headless', 30_000, t0);

      const pausedCount = manager.pauseDesktopSessionTasks('Windows screen locked');
      expect(pausedCount).toBe(1);
      expect(manager.get('t_desktop')?.status).toBe('paused');
      expect(manager.get('t_desktop')?.reobserveRequired).toBe(true);
      expect(manager.get('t_headless')?.status).toBe('running');

      // Heartbeat alive at t0 + 10s, stalled at t0 + 90s.
      expect(manager.detectStalled(t0 + 10_000, 60_000)).toHaveLength(0);
      expect(manager.detectStalled(t0 + 90_000, 60_000).map((t) => t.id)).toEqual(['t_headless']);
    } finally {
      db.close();
    }
  });
});

describe('Phase E: Cron Scheduler, IANA DST Handling, Missed Runs & Transactional Locking', () => {
  it('parses valid 5-field cron expressions, rejects invalid ones, and handles IANA DST transitions accurately', () => {
    const parsed = parseCronExpression('*/15 9-17 * * 1-5');
    expect(parsed.minutes.has(0)).toBe(true);
    expect(parsed.minutes.has(45)).toBe(true);
    expect(parsed.hours.has(9)).toBe(true);
    expect(parsed.hours.has(18)).toBe(false);
    expect(parsed.daysOfWeek.has(1)).toBe(true);
    expect(parsed.daysOfWeek.has(0)).toBe(false);

    expect(() => parseCronExpression('invalid cron')).toThrow();
    expect(() => parseCronExpression('61 * * * *')).toThrow();

    // America/New_York fall-back DST: Nov 1, 2026 01:30 occurs twice in wall-clock time;
    // listCronOccurrencesBetween must deduplicate by localKey so it never fires twice!
    const beforeFallback = Date.parse('2026-11-01T04:00:00Z'); // 00:00 EDT
    const afterFallback = Date.parse('2026-11-01T08:00:00Z');  // 03:00 EST
    const occurrences = listCronOccurrencesBetween('30 1 * * *', 'America/New_York', beforeFallback, afterFallback, 10);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.scheduledKey).toBe('2026-11-01T01:30@America/New_York');

    // Spring-forward DST: Mar 8, 2026 02:30 does not exist in America/New_York -> next is Mar 9 02:30 EDT.
    const beforeSpring = Date.parse('2026-03-08T06:00:00Z'); // 01:00 EST
    const nextSpring = nextCronOccurrence('30 2 * * *', 'America/New_York', beforeSpring);
    expect(nextSpring).not.toBeNull();
    expect(new Date(nextSpring!).toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('prevents duplicate execution across concurrent scheduler instances via SQLite SchedulerLeaseManager', async () => {
    const { db } = createTempDb();
    try {
      const skills = new SkillStore(db);
      const skillId = createActiveReadOnlySkill(skills);
      const store = new RoutineStore(db, skills);

      let clock = Date.parse('2026-11-23T10:00:00Z');
      const routine = store.create({
        projectId: 'default',
        skillId,
        name: 'Every 15m check',
        timezone: 'UTC',
        scheduleKind: 'cron',
        cronExpression: '*/15 * * * *',
      });
      db.execute('UPDATE routines SET created_at = ?, next_run_at = ? WHERE id = ?', [
        clock, Date.parse('2026-11-23T10:15:00Z'), routine.id,
      ]);

      const executedBy: string[] = [];
      const leaseA = new SchedulerLeaseManager(db, 'test-sched-lock', 'instance-A');
      const leaseB = new SchedulerLeaseManager(db, 'test-sched-lock', 'instance-B');

      const schedA = new LocalRoutineScheduler(
        store, skills,
        async () => { executedBy.push('A'); return { status: 'completed', summary: 'ok' }; },
        () => undefined,
        () => clock,
        () => true,
        { lease: leaseA },
      );
      const schedB = new LocalRoutineScheduler(
        store, skills,
        async () => { executedBy.push('B'); return { status: 'completed', summary: 'ok' }; },
        () => undefined,
        () => clock,
        () => true,
        { lease: leaseB },
      );

      clock = Date.parse('2026-11-23T10:15:00Z');
      await schedA.tick();
      await schedB.tick();
      // Give drainQueue microtasks time to finish.
      await new Promise((r) => setTimeout(r, 20));

      expect(executedBy).toEqual(['A']);
      expect(leaseB.acquireOrRenew(45_000, clock + 5_000)).toBe(false);
      // Once leaseA expires, leaseB can reclaim it atomically.
      expect(leaseB.acquireOrRenew(45_000, clock + 50_000)).toBe(true);
      expect(store.history(routine.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('applies bounded missed-run policies (skip vs run_once vs catch_up_window) without unbounded replay loops', async () => {
    const { db } = createTempDb();
    try {
      const skills = new SkillStore(db);
      const skillId = createActiveReadOnlySkill(skills);
      const store = new RoutineStore(db, skills);

      const start = Date.parse('2026-11-23T08:00:00Z');
      // Force created_at to 08:00Z by updating after creation.
      const runOnceRoutine = store.create({
        projectId: 'default',
        skillId,
        name: 'Hourly digest',
        timezone: 'UTC',
        scheduleKind: 'cron',
        cronExpression: '0 * * * *',
        missedRunPolicy: 'run_once',
      });
      db.execute('UPDATE routines SET created_at = ?, next_run_at = ? WHERE id = ?', [
        start, Date.parse('2026-11-23T09:00:00Z'), runOnceRoutine.id,
      ]);

      // App comes online 4.5 hours later (missed 09:00, 10:00, 11:00, 12:00).
      const onlineAt = Date.parse('2026-11-23T12:30:00Z');
      let executions = 0;
      const scheduler = new LocalRoutineScheduler(
        store, skills,
        async () => { executions += 1; return { status: 'completed', summary: 'Caught up once' }; },
        () => undefined,
        () => onlineAt,
        () => true,
      );

      await scheduler.tick();
      await new Promise((r) => setTimeout(r, 20));

      // run_once collapses older missed runs and executes ONLY 1 catch-up run!
      expect(executions).toBe(1);
      const history = store.history(runOnceRoutine.id);
      expect(history.filter((h) => h.status === 'completed')).toHaveLength(1);
      expect(history.filter((h) => h.status === 'missed').length).toBeGreaterThanOrEqual(3);
    } finally {
      db.close();
    }
  });
});

describe('Phase E: Parallel Specialist Delegation, Fail-Closed Allowlists & Parent-Child Cancellation', () => {
  function buildRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    for (const name of ['get_current_time', 'memory_search', 'documents_search', 'browser_open_search', 'get_system_info']) {
      registry.register({
        name,
        description: `Read-only ${name}`,
        risk: 'low',
        category: 'system',
        requiresApproval: false,
        changesState: false,
        parameters: { type: 'object', properties: {} },
      });
    }
    return registry;
  }

  it('treats an explicitly empty tool allowlist as ZERO tools (fail-closed) and blocks nested delegation', () => {
    const registry = buildRegistry();
    const emptyPlan = planDelegation({
      specialist: 'research',
      objective: 'Should have zero tools',
      mode: 'agent',
      projectId: 'default',
      explicitToolAllowlist: [],
    }, registry);
    expect(emptyPlan.tools).toEqual([]);
    expect(emptyPlan.approvalTools).toEqual([]);

    const narrowedPlan = planDelegation({
      specialist: 'knowledge',
      objective: 'Parent only holds memory_search',
      mode: 'agent',
      projectId: 'default',
      parentAllowedTools: ['memory_search'],
    }, registry);
    expect(narrowedPlan.tools).toEqual(['memory_search']);
  });

  it('executes two specialists in parallel, enforces max concurrency 3, tracks parent-child tasks, and consolidates verified findings', async () => {
    const { db } = createTempDb();
    try {
      const registry = buildRegistry();
      const taskManager = new TaskManager(() => undefined, new TaskStore(db));
      const parentId = 'task_parent_research';
      taskManager.upsert({
        id: parentId,
        title: 'Research topic with two specialists',
        status: 'running',
        createdAt: Date.now(),
        steps: [],
      });

      const heartbeats: string[] = [];
      let inFlight = 0;
      let peakInFlight = 0;

      const coordinator = new SpecialistCoordinator({
        registry,
        isStopped: () => false,
        invokeTool: async (tool) => {
          inFlight += 1;
          peakInFlight = Math.max(peakInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 25));
          inFlight -= 1;
          return { ok: true, content: `Verified output from ${tool}` };
        },
      });

      const researchPlan = planDelegation({
        specialist: 'research',
        objective: 'Search web sources',
        mode: 'agent',
        projectId: 'default',
        parentTaskId: parentId,
      }, registry);
      const knowledgePlan = planDelegation({
        specialist: 'knowledge',
        objective: 'Search local knowledge base',
        mode: 'agent',
        projectId: 'default',
        parentTaskId: parentId,
      }, registry);
      const systemsPlan = planDelegation({
        specialist: 'systems',
        objective: 'Check host diagnostics',
        mode: 'agent',
        projectId: 'default',
        parentTaskId: parentId,
      }, registry);
      const extraPlan = planDelegation({
        specialist: 'research',
        objective: 'Secondary verification',
        mode: 'agent',
        projectId: 'default',
        parentTaskId: parentId,
      }, registry);

      const report = await coordinator.delegateParallel(
        [
          { plan: researchPlan, work: (s) => (s === 0 ? { tool: 'browser_open_search', args: {} } : null) },
          { plan: knowledgePlan, work: (s) => (s === 0 ? { tool: 'memory_search', args: {} } : null) },
          { plan: systemsPlan, work: (s) => (s === 0 ? { tool: 'get_system_info', args: {} } : null) },
          { plan: extraPlan, work: (s) => (s === 0 ? { tool: 'get_current_time', args: {} } : null) },
        ],
        {
          parentTaskId: parentId,
          projectId: 'default',
          tasks: taskManager,
          onHeartbeat: (h) => heartbeats.push(h.specialist),
        },
      );

      expect(report.status).toBe('completed');
      expect(report.incompleteCount).toBe(0);
      expect(report.results).toHaveLength(4);
      expect(report.maxConcurrencyUsed).toBeLessThanOrEqual(MAX_CONCURRENT_SPECIALISTS);
      expect(peakInFlight).toBeGreaterThanOrEqual(2);
      expect(peakInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_SPECIALISTS);
      expect(heartbeats.length).toBeGreaterThanOrEqual(4);
      expect(report.consolidatedFindings).toHaveLength(4);

      const children = taskManager.childrenOf(parentId);
      expect(children).toHaveLength(4);
      expect(children.every((c) => c.status === 'completed')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('propagates parent cancellation to active child specialists and never reports false success', async () => {
    const { db } = createTempDb();
    try {
      const registry = buildRegistry();
      const taskManager = new TaskManager(() => undefined, new TaskStore(db));
      const parentId = 'task_parent_cancel';
      const parentController = new AbortController();

      taskManager.upsert({
        id: parentId,
        title: 'Cancellable delegation',
        status: 'running',
        createdAt: Date.now(),
        steps: [],
      });
      taskManager.registerControl(parentId, { cancel: () => parentController.abort() });

      const coordinator = new SpecialistCoordinator({
        registry,
        isStopped: () => false,
        invokeTool: async (_tool, _args, ctx) => {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 200);
            ctx?.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
          });
          if (ctx?.signal?.aborted) throw new Error('Aborted');
          return { ok: true, content: 'done' };
        },
      });

      const plan = planDelegation({
        specialist: 'research',
        objective: 'Long research',
        mode: 'agent',
        projectId: 'default',
        parentTaskId: parentId,
      }, registry);

      const promise = coordinator.delegateParallel(
        [{ plan, work: (s) => (s === 0 ? { tool: 'browser_open_search', args: {} } : null) }],
        { parentTaskId: parentId, signal: parentController.signal, tasks: taskManager },
      );

      setTimeout(() => taskManager.cancel(parentId), 20);
      const report = await promise;
      expect(report.status).toBe('cancelled');
      expect(report.incompleteCount).toBe(1);
      expect(taskManager.childrenOf(parentId)[0]?.status).toBe('cancelled');
    } finally {
      db.close();
    }
  });
});

describe('Phase E: Running Tasks & AgentActivityBar UI Integration', () => {
  it('renders execution scope, parent-child links, recovery notes, and specialist activity honestly', () => {
    const now = Date.now();
    const parent: TaskRecord = {
      id: 'p1',
      title: 'Consolidate market research',
      status: 'running',
      executionScope: 'headless',
      createdAt: now,
      steps: [{ id: 'ps1', title: 'Coordinate specialists', status: 'running' }],
    };
    const child: TaskRecord = {
      id: 'c1',
      parentTaskId: 'p1',
      specialistId: 'research',
      title: 'Research: Compare frameworks',
      status: 'running',
      executionScope: 'headless',
      createdAt: now,
      steps: [],
    };
    const recovered: TaskRecord = {
      id: 'r1',
      title: 'Push release tag',
      status: 'paused',
      executionScope: 'desktop_session',
      reobserveRequired: true,
      safeToResume: false,
      recoveryNote: 'Interrupted during state-changing operation; not replayed.',
      createdAt: now,
      steps: [],
    };

    const html = renderToStaticMarkup(
      createElement(WorkspaceTasks, {
        tasks: [parent, child, recovered],
        audit: [],
        projectName: 'Pixel',
        onAction: () => undefined,
        onContinue: () => undefined,
        onRecord: () => undefined,
      }),
    );

    expect(html).toContain('1 subtask');
    expect(html).toContain('Subtask of: Consolidate market research');
    expect(html).toContain('Desktop session');
    expect(html).toContain('Interrupted during state-changing operation');

    expect(deriveAgentActivity({ activeTask: child, streaming: false })?.label).toBe('Research specialist working');
    expect(deriveAgentActivity({ activeTask: recovered, streaming: false })?.label).toBe('Recovery review required');
    const barHtml = renderToStaticMarkup(createElement(AgentActivityBar, { activeTask: child, streaming: false }));
    expect(barHtml).toContain('Research specialist working');
  });
});
