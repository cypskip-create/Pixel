import type { ToolDefinition } from '../../shared/types';
import { ProductivityStore, type ProductivityChecklist, type ProductivityTask } from './store';

const statusSchema = { type: 'string', enum: ['open', 'in_progress', 'completed'] };
const noteId = { type: 'string', minLength: 6, maxLength: 80 };
const taskId = { type: 'string', minLength: 7, maxLength: 80 };
const checklistId = { type: 'string', minLength: 7, maxLength: 80 };

export const PRODUCTIVITY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { name: 'notes_create', description: 'Create a persistent editable note in the active Pixel project.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 180 }, body: { type: 'string', maxLength: 20_000 } }, required: ['title', 'body'], additionalProperties: false } },
  { name: 'notes_read', description: 'Read one note by its ID, only from the active Pixel project.', category: 'productivity', risk: 'low', requiresApproval: false, changesState: false, parameters: { type: 'object', properties: { id: noteId }, required: ['id'], additionalProperties: false } },
  { name: 'notes_search', description: 'Search note titles and text in the active Pixel project and return source note IDs.', category: 'productivity', risk: 'low', requiresApproval: false, changesState: false, parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['query'], additionalProperties: false } },
  { name: 'notes_update', description: 'Update the title or body of one note in the active Pixel project.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { id: noteId, title: { type: 'string', minLength: 1, maxLength: 180 }, body: { type: 'string', maxLength: 20_000 } }, required: ['id'], additionalProperties: false } },
  { name: 'notes_delete', description: 'Delete one note from the active Pixel project. This is irreversible and always requires approval.', category: 'productivity', risk: 'high', requiresApproval: true, changesState: true, parameters: { type: 'object', properties: { id: noteId }, required: ['id'], additionalProperties: false } },
  { name: 'checklists_create', description: 'Create a named checklist in the active Pixel project to group related tasks.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['title'], additionalProperties: false } },
  { name: 'checklists_list', description: 'List checklists available in the active Pixel project.', category: 'productivity', risk: 'low', requiresApproval: false, changesState: false, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'tasks_create', description: 'Create a persistent task in the active Pixel project, optionally within an existing checklist and with an ISO date due date.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 180 }, description: { type: 'string', maxLength: 4_000 }, dueAt: { type: 'string', format: 'date-time' }, checklistId }, required: ['title'], additionalProperties: false } },
  { name: 'tasks_list', description: 'List persistent tasks in the active Pixel project, optionally filtered by status or checklist ID. Use null checklistId to list ungrouped tasks.', category: 'productivity', risk: 'low', requiresApproval: false, changesState: false, parameters: { type: 'object', properties: { status: statusSchema, checklistId: { anyOf: [checklistId, { type: 'null' }] } }, additionalProperties: false } },
  { name: 'tasks_update', description: 'Update a task title, description, due date, status or checklist in the active Pixel project. Set checklistId null to remove it from its checklist.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { id: taskId, title: { type: 'string', minLength: 1, maxLength: 180 }, description: { type: 'string', maxLength: 4_000 }, status: statusSchema, dueAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] }, checklistId: { anyOf: [checklistId, { type: 'null' }] } }, required: ['id'], additionalProperties: false } },
  { name: 'tasks_complete', description: 'Mark a task in the active Pixel project as completed and verify its stored status.', category: 'productivity', risk: 'medium', requiresApproval: false, changesState: true, parameters: { type: 'object', properties: { id: taskId }, required: ['id'], additionalProperties: false } },
] as const;

export interface ProductivityResult { ok: boolean; content: string; detail?: Record<string, unknown>; errorCode?: 'FAILED' | 'NOT_FOUND'; verification?: { summary: string; source: string } }

/** Agent-facing operations for local notes and planning tasks. Every lookup is project scoped. */
export class ProductivityTools {
  constructor(private readonly store: ProductivityStore, private readonly projectId: () => string) {}
  handles(name: string): boolean { return PRODUCTIVITY_TOOL_DEFINITIONS.some((tool) => tool.name === name); }
  run(name: string, args: Record<string, unknown>): ProductivityResult {
    const project = this.projectId();
    switch (name) {
      case 'notes_create': {
        const title = text(args.title, 180); const body = text(args.body, 20_000, true);
        if (!title || body === null) return fail('A note needs a title and a body of at most 20,000 characters.');
        const note = this.store.createNote(project, title, body);
        return { ok: true, content: `Created note “${note.title}” (${note.id}) in the active project.`, detail: { ...note }, verification: { summary: `Read back the saved note ${note.id}.`, source: 'SQLite project-scoped note read-back' } };
      }
      case 'notes_read': {
        const note = this.store.getNote(project, text(args.id, 80) ?? '');
        return note ? { ok: true, content: `# ${note.title}\n\n${note.body}`, detail: { ...note }, verification: { summary: `Found note ${note.id} in the active project.`, source: 'SQLite project-scoped note lookup' } } : missing('No note with that ID exists in the active project.');
      }
      case 'notes_search': {
        const query = text(args.query, 500);
        if (!query) return fail('A non-empty note search query is required.');
        const notes = this.store.searchNotes(project, query, typeof args.limit === 'number' ? args.limit : 10);
        return { ok: true, content: notes.length ? notes.map((note) => `- ${note.title} (${note.id})\n${note.body.slice(0, 500)}`).join('\n') : `No notes matched “${query}” in the active project.`, detail: { count: notes.length, notes: notes.map((note) => ({ ...note })) }, verification: { summary: `Searched active-project notes and found ${notes.length} match(es).`, source: 'SQLite project-scoped note search' } };
      }
      case 'notes_update': {
        const patch: { title?: string; body?: string } = {};
        if (args.title !== undefined) { const title = text(args.title, 180); if (!title) return fail('A note title must not be empty and is limited to 180 characters.'); patch.title = title; }
        if (args.body !== undefined) { const body = text(args.body, 20_000, true); if (body === null) return fail('A note body is limited to 20,000 characters.'); patch.body = body; }
        if (!Object.keys(patch).length) return fail('Provide a note title or body to update.');
        const note = this.store.updateNote(project, text(args.id, 80) ?? '', patch);
        return note ? { ok: true, content: `Updated note “${note.title}” and verified the saved version.`, detail: { ...note }, verification: { summary: `Read back updated note ${note.id}.`, source: 'SQLite project-scoped note read-back' } } : missing('No note with that ID exists in the active project.');
      }
      case 'notes_delete': {
        const id = text(args.id, 80) ?? '';
        return this.store.deleteNote(project, id) ? { ok: true, content: `Deleted note ${id} from the active project.`, detail: { id, absent: this.store.getNote(project, id) === null }, verification: { summary: `Confirmed note ${id} is absent from the active project.`, source: 'SQLite note lookup after deletion' } } : missing('No note with that ID exists in the active project.');
      }
      case 'checklists_create': {
        const title = text(args.title, 180);
        if (!title) return fail('A checklist needs a title of at most 180 characters.');
        const checklist = this.store.createChecklist(project, title);
        return { ok: true, content: `Created checklist “${checklist.title}” (${checklist.id}) in the active project.`, detail: { ...checklist }, verification: { summary: `Read back checklist ${checklist.id}.`, source: 'SQLite project-scoped checklist read-back' } };
      }
      case 'checklists_list': {
        const checklists = this.store.listChecklists(project);
        return { ok: true, content: checklists.length ? checklists.map((item) => `- ${item.title} (${item.id})`).join('\n') : 'No checklists are stored in the active project.', detail: { count: checklists.length, checklists: checklists.map((item: ProductivityChecklist) => ({ ...item })) }, verification: { summary: `Read ${checklists.length} checklist(s) from the active project.`, source: 'SQLite project-scoped checklist list' } };
      }
      case 'tasks_create': {
        const title = text(args.title, 180); const description = args.description === undefined ? '' : text(args.description, 4_000, true);
        const dueAt = parseDate(args.dueAt);
        if (!title || description === null || dueAt === false) return fail('Task title, description or ISO due date is invalid.');
        const checklist = args.checklistId === undefined ? null : this.store.getChecklist(project, text(args.checklistId, 80) ?? '');
        if (args.checklistId !== undefined && !checklist) return missing('The specified checklist does not exist in the active project.');
        const task = this.store.createTask(project, title, description, dueAt, checklist?.id ?? null);
        return { ok: true, content: `Created task “${task.title}” (${task.id}) in the active project.`, detail: { ...task }, verification: { summary: `Read back task ${task.id} with status ${task.status}.`, source: 'SQLite project-scoped task read-back' } };
      }
      case 'tasks_list': {
        const status = args.status as ProductivityTask['status'] | undefined;
        let checklistId: string | null | undefined;
        if (args.checklistId !== undefined) {
          checklistId = args.checklistId === null ? null : text(args.checklistId, 80);
          if (checklistId === null && args.checklistId !== null) return fail('Checklist ID is invalid.');
          if (typeof checklistId === 'string' && !this.store.getChecklist(project, checklistId)) return missing('The specified checklist does not exist in the active project.');
        }
        const tasks = this.store.listTasks(project, status, checklistId);
        return { ok: true, content: tasks.length ? tasks.map((task) => `- [${task.status}] ${task.title} (${task.id})${task.dueAt ? ` — due ${new Date(task.dueAt).toISOString()}` : ''}`).join('\n') : 'No tasks are stored in the active project.', detail: { count: tasks.length, tasks: tasks.map((task) => ({ ...task })) }, verification: { summary: `Read ${tasks.length} task(s) from the active project.`, source: 'SQLite project-scoped task list' } };
      }
      case 'tasks_update':
      case 'tasks_complete': {
        const patch: { title?: string; description?: string; status?: ProductivityTask['status']; dueAt?: number | null; checklistId?: string | null } = {};
        if (name === 'tasks_complete') patch.status = 'completed';
        if (args.title !== undefined) { const title = text(args.title, 180); if (!title) return fail('Task title must not be empty and is limited to 180 characters.'); patch.title = title; }
        if (args.description !== undefined) { const description = text(args.description, 4_000, true); if (description === null) return fail('Task description is limited to 4,000 characters.'); patch.description = description; }
        if (args.status !== undefined) { if (!['open', 'in_progress', 'completed'].includes(String(args.status))) return fail('Task status must be open, in_progress or completed.'); patch.status = args.status as ProductivityTask['status']; }
        if (args.dueAt !== undefined) { const dueAt = parseDate(args.dueAt); if (dueAt === false) return fail('Due date must be a valid ISO date-time or null.'); patch.dueAt = dueAt; }
        if (args.checklistId !== undefined) {
          if (args.checklistId === null) patch.checklistId = null;
          else { const checklist = this.store.getChecklist(project, text(args.checklistId, 80) ?? ''); if (!checklist) return missing('The specified checklist does not exist in the active project.'); patch.checklistId = checklist.id; }
        }
        const task = this.store.updateTask(project, text(args.id, 80) ?? '', patch);
        return task ? { ok: true, content: `Updated task “${task.title}” (${task.status}); the stored row was verified.`, detail: { ...task }, verification: { summary: `Read back task ${task.id} with status ${task.status}.`, source: 'SQLite project-scoped task read-back' } } : missing('No task with that ID exists in the active project.');
      }
      default: return missing(`Unknown productivity tool ${name}.`);
    }
  }
}

function text(value: unknown, limit: number, allowEmpty = false): string | null { if (typeof value !== 'string' || value.length > limit) return null; const result = value.trim(); return result.length || allowEmpty ? result : null; }
function parseDate(value: unknown): number | null | false { if (value === undefined || value === null || value === '') return null; if (typeof value !== 'string') return false; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : false; }
function fail(content: string): ProductivityResult { return { ok: false, content, errorCode: 'FAILED' }; }
function missing(content: string): ProductivityResult { return { ok: false, content, errorCode: 'NOT_FOUND' }; }
