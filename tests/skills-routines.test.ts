import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/main/data/database';
import type { Database } from '../src/main/data/database';
import { SkillStore } from '../src/main/skills/store';
import type { SkillDraftInput } from '../src/main/skills/schema';
import { replaySkill } from '../src/main/skills/replay';
import type { StepRunner } from '../src/main/workflows';
import { LocalRoutineScheduler, RoutineStore } from '../src/main/routines';

const databases: Database[] = [];
const database = (): Database => {
  const db = openDatabase(':memory:');
  databases.push(db);
  db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['project_a', 'Project A', Date.now(), Date.now()]);
  return db;
};

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length > 0) databases.pop()?.close();
});

function definition(overrides: Partial<SkillDraftInput> = {}): SkillDraftInput {
  return {
    schemaVersion: 1,
    projectId: 'project_a',
    name: 'Check public status',
    purpose: 'Check a public status page and report the visible status.',
    triggers: ['check status'],
    inputs: [],
    requiredTools: ['browser_navigate', 'browser_inspect'],
    steps: [
      { ordinal: 0, kind: 'tool', locator: 'browser_navigate', action: 'browser_navigate', params: { url: 'https://status.example.com' }, expectation: { urlPrefix: 'https://status.example.com' }, approvalRequired: true },
      { ordinal: 1, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: {}, expectation: { resultContains: 'status' }, approvalRequired: false },
    ],
    decisionBranches: ['If the service is degraded, include the affected service names.'],
    verificationRules: ['Read the status from the page after navigation.'],
    failureHandling: ['Stop if the status page cannot be read.'],
    approvalRequirements: ['Ask before any action that changes state or submits information.'],
    ...overrides,
  };
}

async function waitForHistory(store: RoutineStore, routineId: string, expected: string): Promise<void> {
  await vi.waitFor(() => expect(store.history(routineId)[0]?.status).toBe(expected), { timeout: 1_000 });
}

describe('reviewed skills', () => {
  it('stores drafts as non-runnable and activates only after explicit review', () => {
    const db = database();
    const store = new SkillStore(db);
    const draft = store.createDraft(definition());
    expect(draft.status).toBe('draft');
    expect(store.getActive(draft.id)).toBeNull();

    const active = store.activate(draft.id);
    expect(active.status).toBe('active');
    expect(store.getActive(active.id)?.version).toBe(1);
    expect(store.createDraft(definition()).version).toBe(2);
  });

  it('rejects literal typed content, undeclared inputs and coordinate-only locators', () => {
    const store = new SkillStore(database());
    expect(() => store.createDraft(definition({
      inputs: [{ name: 'search', description: 'Search term', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_type', action: 'browser_type', params: { text: 'private@email.test' }, expectation: {}, approvalRequired: true }],
      requiredTools: ['browser_type'],
    }))).toThrow(/literal text is not stored/);

    expect(() => store.createDraft(definition({
      inputs: [{ name: 'search', description: 'Search term', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_type', action: 'browser_type', params: { text: '${input.other}' }, expectation: {}, approvalRequired: true }],
      requiredTools: ['browser_type'],
    }))).toThrow(/undeclared skill input/);

    expect(() => store.createDraft(definition({
      steps: [{ ordinal: 0, kind: 'native', locator: 'x=120,y=500', action: 'click', params: {}, expectation: {}, approvalRequired: true }],
    }))).toThrow(/Raw coordinates/);

    expect(() => store.createDraft(definition({
      requiredTools: ['get_foreground_window'],
      steps: [{ ordinal: 0, kind: 'native', locator: 'NetworkCategory', action: 'invoke_ui_element', params: {}, expectation: {}, approvalRequired: true }],
    }))).toThrow(/must list invoke_ui_element/);
    expect(() => store.createDraft(definition({
      requiredTools: ['invoke_ui_element'],
      steps: [{ ordinal: 0, kind: 'native', locator: 'NetworkCategory', action: 'click_coordinates', params: {}, expectation: {}, approvalRequired: true }],
    }))).toThrow(/semantic UI Automation tool/);
  });

  it('activates a native semantic skill only when its required UIA tool is declared', () => {
    const store = new SkillStore(database());
    const draft = store.createDraft(definition({
      requiredTools: ['get_foreground_window', 'find_ui_elements', 'invoke_ui_element'],
      steps: [
        { ordinal: 0, kind: 'native', locator: 'NetworkCategory', action: 'invoke_ui_element', params: { role: 'Button' }, expectation: { observation: 'Verify the Network page appears.' }, approvalRequired: true },
      ],
    }));
    expect(store.activate(draft.id).status).toBe('active');
  });

  it('rejects secrets across all stored fields without flagging ordinary password-related instructions', () => {
    const store = new SkillStore(database());
    expect(() => store.createDraft(definition({ purpose: 'Open password reset settings and inspect the visible options.' }))).not.toThrow();
    expect(() => store.createDraft(definition({ purpose: 'Use the account password:topSecret123 when prompted.' }))).toThrow(/Credential data/);
    expect(() => store.createDraft(definition({
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: {}, expectation: { api_key: 'sk-exampleSecret123456' }, approvalRequired: false }],
    }))).toThrow(/Credential data/);
    expect(() => store.createDraft(definition({
      inputs: [{ name: 'username', description: 'password:topSecret123', required: true }],
    }))).toThrow(/Credential/);
  });

  it('refuses modified stored definitions and enforces each step’s approval declaration', async () => {
    const db = database();
    const store = new SkillStore(db);
    const active = store.activate(store.createDraft(definition()).id);
    const runner: StepRunner = { run: async () => ({ ok: true, observed: 'verified' }) };
    const denied = await replaySkill(store, active.id, runner, {
      mode: 'hybrid',
      authorize: () => ({ allowed: true, needsApproval: false, reason: 'allowed by current scope' }),
      requestApproval: async () => false,
    });
    expect(denied.status).toBe('denied');
    expect(denied.steps[0]?.status).toBe('skipped');

    db.execute('UPDATE skills SET definition = ? WHERE id = ?', [JSON.stringify({ ...active, purpose: 'tampered' }), active.id]);
    expect(store.get(active.id)).toBeNull();
    const refused = await replaySkill(store, active.id, runner, {
      mode: 'hybrid', authorize: () => ({ allowed: true, needsApproval: false, reason: '' }),
    });
    expect(refused.status).toBe('denied');
  });

  it('rechecks policy, substitutes runtime inputs and verifies each step', async () => {
    const db = database();
    const store = new SkillStore(db);
    const active = store.activate(store.createDraft(definition({
      inputs: [{ name: 'query', description: 'Search phrase', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: { query: '${input.query}' }, expectation: { resultContains: 'OK' }, approvalRequired: false }],
      requiredTools: ['browser_inspect'],
    })).id);
    const seen: string[] = [];
    const runner: StepRunner = { run: async (step) => {
      seen.push(String(step.params['query']));
      return { ok: true, observed: 'OK was present.' };
    } };
    const result = await replaySkill(store, active.id, runner, {
      mode: 'hybrid', inputs: { query: 'service health' },
      authorize: () => ({ allowed: true, needsApproval: false, reason: 'read only' }),
    });
    expect(result.status).toBe('completed');
    expect(seen).toEqual(['service health']);
    expect(() => store.createDraft(definition({ name: 'Bad tool', steps: [{ ordinal: 0, kind: 'tool', locator: 'missing_tool', action: 'missing_tool', params: {}, expectation: {}, approvalRequired: false }] }))).toThrow(/requiredTools/);
  });

  it('rejects oversized or credential-like direct replay inputs and redacts echoed values', async () => {
    const db = database();
    const store = new SkillStore(db);
    const active = store.activate(store.createDraft(definition({
      inputs: [{ name: 'query', description: 'Search phrase', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: { query: '${input.query}' }, expectation: {}, approvalRequired: false }],
      requiredTools: ['browser_inspect'],
    })).id);
    const authorize = () => ({ allowed: true, needsApproval: false, reason: 'read only' });
    const runner: StepRunner = { run: async (step) => ({ ok: true, observed: `Observed ${String(step.params['query']).toLowerCase()}` }) };

    const oversized = await replaySkill(store, active.id, runner, { mode: 'hybrid', inputs: { query: 'x'.repeat(2_001) }, authorize });
    expect(oversized.status).toBe('failed');
    expect(oversized.failure).toMatch(/2,000 characters/);
    const credential = await replaySkill(store, active.id, runner, { mode: 'hybrid', inputs: { query: 'Bearer abcdefghijklmnop' }, authorize });
    expect(credential.status).toBe('failed');
    expect(credential.failure).toMatch(/credential material/);

    const secretLike = 'Customer-Lookup-483920';
    const observedByCallback: string[] = [];
    const echoed = await replaySkill(store, active.id, runner, {
      mode: 'hybrid', inputs: { query: secretLike }, authorize,
      onStep: (step) => observedByCallback.push(step.detail),
    });
    expect(echoed.status).toBe('completed');
    expect(echoed.steps[0]?.detail).toBe('Observed [redacted input]');
    expect(observedByCallback).toEqual(['Observed [redacted input]']);
    expect(JSON.stringify(echoed)).not.toContain(secretLike);

    await expect(replaySkill(store, active.id, {
      run: async () => { throw new Error(`provider echoed ${secretLike}`); },
    }, { mode: 'hybrid', inputs: { query: secretLike }, authorize })).rejects.toThrow('provider echoed [redacted input]');

    const rejected = await replaySkill(store, active.id, {
      run: async () => ({ ok: false, observed: `Could not query ${secretLike.toLowerCase()}` }),
    }, { mode: 'hybrid', inputs: { query: secretLike }, authorize });
    expect(rejected.failure).toBe('Could not query [redacted input]');
    const persistedFailure = db.queryOne<{ failure: string | null }>(
      "SELECT failure FROM skill_runs WHERE skill_id = ? AND status = 'failed' ORDER BY rowid DESC LIMIT 1",
      [active.id],
    );
    expect(persistedFailure?.failure).toBe('Could not query [redacted input]');
  });
});

describe('durable local routines', () => {
  function setup(): { store: RoutineStore; skills: SkillStore; activeSkillId: string } {
    const db = database();
    const skills = new SkillStore(db);
    const active = skills.activate(skills.createDraft(definition()).id);
    return { store: new RoutineStore(db, skills), skills, activeSkillId: active.id };
  }

  it('claims a daily local occurrence once and records completed execution', async () => {
    const { store, skills, activeSkillId } = setup();
    const routine = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Daily check', localTime: '10:00', timezone: 'Africa/Nairobi' });
    const execute = vi.fn(async () => ({ status: 'completed' as const, summary: 'Healthy', taskId: 'task_1' }));
    const scheduler = new LocalRoutineScheduler(store, skills, execute, () => undefined, () => Date.UTC(2026, 10, 16, 7, 0, 15));
    await scheduler.tick();
    await scheduler.tick();
    await waitForHistory(store, routine.id, 'completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.history(routine.id)[0]?.taskId).toBe('task_1');
    scheduler.stop();
  });

  it('marks a missed schedule after sleep and does not run it late', async () => {
    const { store, skills, activeSkillId } = setup();
    const routine = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Daily check', localTime: '10:00', timezone: 'Africa/Nairobi' });
    const execute = vi.fn(async () => ({ status: 'completed' as const }));
    const scheduler = new LocalRoutineScheduler(store, skills, execute, () => undefined, () => Date.UTC(2026, 10, 16, 8, 1));
    await scheduler.tick();
    expect(store.history(routine.id)[0]?.status).toBe('missed');
    expect(execute).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('serializes routines due together and allows cancelling queued work', async () => {
    const { store, skills, activeSkillId } = setup();
    const first = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'First', localTime: '10:00', timezone: 'Africa/Nairobi' });
    const second = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Second', localTime: '10:00', timezone: 'Africa/Nairobi' });
    let finishFirst: () => void = () => undefined;
    const execute = vi.fn(async (routine: RoutineRecordLike) => {
      if (routine.id === first.id) await new Promise<void>((resolve) => { finishFirst = resolve; });
      return { status: 'completed' as const };
    });
    const scheduler = new LocalRoutineScheduler(store, skills, execute, () => undefined, () => Date.UTC(2026, 10, 16, 7, 0));
    await scheduler.tick();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(scheduler.cancel(second.id)).toBe(true);
    finishFirst();
    await waitForHistory(store, first.id, 'completed');
    expect(store.history(second.id)[0]?.status).toBe('cancelled');
    expect(execute).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('propagates cancellation into the active routine executor', async () => {
    const { store, skills, activeSkillId } = setup();
    const routine = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Cancel me', localTime: '10:00', timezone: 'Africa/Nairobi' });
    const execute = vi.fn((_routine: RoutineRecordLike, _skill: unknown, _key: string, signal: AbortSignal) =>
      new Promise<{ status: 'cancelled' }>((resolve) => signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true })),
    );
    const scheduler = new LocalRoutineScheduler(store, skills, execute, () => undefined, () => Date.UTC(2026, 10, 16, 7, 0));
    await scheduler.tick();
    expect(scheduler.cancel(routine.id)).toBe(true);
    await waitForHistory(store, routine.id, 'cancelled');
    scheduler.stop();
  });

  it('records process interruption without replay and pauses a failed routine', async () => {
    const { store, skills, activeSkillId } = setup();
    const routine = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Daily check', localTime: '10:00', timezone: 'Africa/Nairobi' });
    const scheduler = new LocalRoutineScheduler(store, skills, async () => ({ status: 'failed', failure: 'verification failed' }), () => undefined, () => Date.UTC(2026, 10, 16, 7, 0));
    await scheduler.tick();
    await waitForHistory(store, routine.id, 'failed');
    expect(store.get(routine.id)?.enabled).toBe(false);
    const run = store.claim({ ...routine, enabled: true }, 'orphaned-occurrence', Date.now());
    expect(run).not.toBeNull();
    expect(store.recoverInterrupted()).toBe(1);
    expect(store.history(routine.id).find((item) => item.id === run)?.status).toBe('cancelled');
    scheduler.stop();
  });

  it('requires a one-time user retry after failure and leaves the daily schedule paused', async () => {
    const { store, skills, activeSkillId } = setup();
    const routine = store.create({ projectId: 'project_a', skillId: activeSkillId, name: 'Retry check', localTime: '10:00', timezone: 'Africa/Nairobi' });
    let attempts = 0;
    let now = Date.UTC(2026, 10, 16, 7, 0);
    const scheduler = new LocalRoutineScheduler(store, skills, async () => {
      attempts += 1;
      return attempts === 1 ? { status: 'failed' as const, failure: 'Page was unavailable.' } : { status: 'completed' as const, summary: 'Current state checked.' };
    }, () => undefined, () => now);
    await scheduler.tick();
    await waitForHistory(store, routine.id, 'failed');
    expect(store.get(routine.id)?.enabled).toBe(false);
    now += 60_000;
    expect(scheduler.retry(routine.id)).toBe(true);
    await vi.waitFor(() => expect(store.history(routine.id)[0]?.status).toBe('completed'), { timeout: 1_000 });
    expect(attempts).toBe(2);
    expect(store.get(routine.id)?.enabled).toBe(false);
    scheduler.stop();
  });

  it('rejects cross-project, inactive and interactive-input routine targets', () => {
    const { store, skills, activeSkillId } = setup();
    expect(() => store.create({ projectId: 'other', skillId: activeSkillId, name: 'Wrong scope', localTime: '10:00', timezone: 'UTC' })).toThrow(/same project/);
    expect(() => store.create({ projectId: 'project_a', skillId: 'missing', name: 'Inactive', localTime: '10:00', timezone: 'UTC' })).toThrow(/active skill/);
    const needsInput = skills.activate(skills.createDraft(definition({
      name: 'Requires input',
      inputs: [{ name: 'query', description: 'Query', required: true }],
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: { query: '${input.query}' }, expectation: {}, approvalRequired: true }],
      requiredTools: ['browser_inspect'],
    })).id);
    expect(() => store.create({ projectId: 'project_a', skillId: needsInput.id, name: 'No input source', localTime: '10:00', timezone: 'UTC' })).toThrow(/interactive inputs/);

    const unknownPredicate = skills.activate(skills.createDraft(definition({
      name: 'Unknown result check',
      steps: [{ ordinal: 0, kind: 'tool', locator: 'browser_inspect', action: 'browser_inspect', params: {}, expectation: { statusVisible: true }, approvalRequired: false }],
      requiredTools: ['browser_inspect'],
    })).id);
    expect(() => store.create({ projectId: 'project_a', skillId: unknownPredicate.id, name: 'Unsupported predicate', localTime: '10:00', timezone: 'UTC' })).toThrow(/unsupported expected-result/);
  });
});

type RoutineRecordLike = ReturnType<RoutineStore['get']> & {};
