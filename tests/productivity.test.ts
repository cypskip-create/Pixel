import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/data/database';
import { ProductivityStore } from '../src/main/productivity/store';
import { PRODUCTIVITY_TOOL_DEFINITIONS, ProductivityTools } from '../src/main/productivity/toolset';
import { ToolExecutors } from '../src/main/agent/executors';
import { ToolRegistry } from '../src/main/agent/tools';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });
function setup() {
  const db = openDatabase(':memory:'); databases.push(db);
  const a = 'project-a'; const b = 'project-b';
  db.execute('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [a, 'A', '', 1, 1]);
  db.execute('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [b, 'B', '', 1, 1]);
  const store = new ProductivityStore(db); let active = a;
  const tools = new ProductivityTools(store, () => active);
  return { db, store, tools, active: (id: string) => { active = id; } };
}

describe('project productivity tools', () => {
  it('registers strict agent schemas and makes routine notes/tasks available in Hybrid and Agent', () => {
    const registry = new ToolRegistry(PRODUCTIVITY_TOOL_DEFINITIONS);
    for (const name of ['notes_create', 'notes_read', 'notes_search', 'notes_update', 'checklists_create', 'checklists_list', 'tasks_create', 'tasks_list', 'tasks_update', 'tasks_complete']) {
      expect(registry.get(name)).toBeDefined();
      expect(registry.schemasFor('agent').some((tool) => tool.name === name)).toBe(true);
      expect(registry.schemasFor('hybrid').some((tool) => tool.name === name)).toBe(true);
      const example = name === 'notes_create' ? { title: 't', body: 'b' }
        : name === 'notes_read' || name === 'notes_update' ? { id: 'note_123456', ...(name === 'notes_update' ? { title: 'new' } : {}) }
          : name === 'notes_search' ? { query: 'x' }
          : name === 'checklists_create' ? { title: 't' }
            : name === 'checklists_list' ? {}
              : name === 'tasks_create' ? { title: 't', dueAt: '2026-12-01T09:00:00.000Z' }
              : name === 'tasks_list' ? { status: 'open' }
                : { id: 'ptask_123456', ...(name === 'tasks_update' ? { dueAt: null } : {}) };
      expect(registry.validateArgs(name, example), `${name} schema`).toEqual({ ok: true });
    }
    expect(registry.get('notes_delete')).toMatchObject({ risk: 'high', requiresApproval: true });
  });

  it('creates, reads, searches and updates persistent project notes with postcondition evidence', () => {
    const { tools } = setup();
    const created = tools.run('notes_create', { title: 'DNS Plan', body: 'Check resolver settings and document the result.' });
    expect(created.ok).toBe(true);
    expect(created.verification).toBeDefined();
    const id = (created.detail as { id: string }).id;
    expect(tools.run('notes_read', { id }).content).toContain('Check resolver settings');
    expect(tools.run('notes_search', { query: 'resolver' }).detail).toMatchObject({ count: 1 });
    const updated = tools.run('notes_update', { id, body: 'Updated: check resolver settings.' });
    expect(updated.ok).toBe(true);
    expect(updated.content).toContain('verified');
    expect(tools.run('notes_read', { id }).content).toContain('Updated:');
  });

  it('keeps note and task lookups isolated to the active project', () => {
    const { tools, active } = setup();
    const note = tools.run('notes_create', { title: 'Private project note', body: 'Only project A.' });
    const noteId = (note.detail as { id: string }).id;
    const task = tools.run('tasks_create', { title: 'Finish test plan' });
    const taskId = (task.detail as { id: string }).id;
    active('project-b');
    expect(tools.run('notes_read', { id: noteId }).errorCode).toBe('NOT_FOUND');
    expect(tools.run('tasks_update', { id: taskId, status: 'completed' }).errorCode).toBe('NOT_FOUND');
  });

  it('creates, updates and completes persistent tasks, then verifies stored status', () => {
    const { tools } = setup();
    const created = tools.run('tasks_create', { title: 'Review guide', description: 'Check the acceptance steps', dueAt: '2026-12-01T09:00:00.000Z' });
    expect(created.ok).toBe(true);
    const id = (created.detail as { id: string }).id;
    const started = tools.run('tasks_update', { id, status: 'in_progress' });
    expect(started.detail).toMatchObject({ status: 'in_progress' });
    const done = tools.run('tasks_complete', { id });
    expect(done.detail).toMatchObject({ status: 'completed' });
    expect(tools.run('tasks_list', { status: 'completed' }).detail).toMatchObject({ count: 1 });
  });

  it('groups tasks in project-scoped checklists and refuses cross-project checklist IDs', () => {
    const { tools, active } = setup();
    const createdList = tools.run('checklists_create', { title: 'Launch steps' });
    const checklistId = (createdList.detail as { id: string }).id;
    const task = tools.run('tasks_create', { title: 'Prepare release notes', checklistId });
    expect(task.ok).toBe(true);
    expect(task.detail).toMatchObject({ checklistId });
    expect(tools.run('tasks_list', { checklistId }).detail).toMatchObject({ count: 1 });
    expect(tools.run('tasks_list', { checklistId: null }).detail).toMatchObject({ count: 0 });
    active('project-b');
    expect(tools.run('tasks_create', { title: 'Wrong scope', checklistId }).errorCode).toBe('NOT_FOUND');
    expect(tools.run('tasks_list', { checklistId }).errorCode).toBe('NOT_FOUND');
  });

  it('deletes only an active-project note through the high-risk tool and verifies absence', () => {
    const { tools } = setup();
    const created = tools.run('notes_create', { title: 'Discard later', body: 'Draft.' });
    const id = (created.detail as { id: string }).id;
    const deleted = tools.run('notes_delete', { id });
    expect(deleted.ok).toBe(true);
    expect(deleted.verification?.summary).toContain('absent');
  });

  it('is routed through the shared agent ToolExecutors dispatcher', async () => {
    const setupData = setup();
    const executor = new ToolExecutors({ productivity: setupData.tools });
    const created = await executor.run('notes_create', { title: 'From agent', body: 'Saved by shared dispatcher.' });
    expect(created.ok).toBe(true);
    const listed = await executor.run('tasks_create', { title: 'Agent task' });
    expect(listed.ok).toBe(true);
    const tasks = await executor.run('tasks_list', {});
    expect(tasks.content).toContain('Agent task');
  });
});
