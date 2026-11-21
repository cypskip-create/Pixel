import { randomUUID } from 'node:crypto';
import type { Database } from '../data/database';

export interface ProductivityNote {
  id: string; projectId: string; title: string; body: string; createdAt: number; updatedAt: number;
}
export interface ProductivityTask {
  id: string; projectId: string; title: string; description: string;
  status: 'open' | 'in_progress' | 'completed'; dueAt: number | null; checklistId: string | null; createdAt: number; updatedAt: number;
}
export interface ProductivityChecklist { id: string; projectId: string; title: string; createdAt: number; updatedAt: number }

/** Project-scoped user notes and planning tasks, separate from agent execution history. */
export class ProductivityStore {
  constructor(private readonly db: Database) {}

  createNote(projectId: string, title: string, body: string): ProductivityNote {
    const now = Date.now();
    const id = `note_${randomUUID().slice(0, 12)}`;
    this.db.execute('INSERT INTO productivity_notes (id, project_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, projectId, title.trim(), body, now, now]);
    const note = this.getNote(projectId, id);
    if (!note) throw new Error('The note was not present after saving.');
    return note;
  }

  getNote(projectId: string, id: string): ProductivityNote | null {
    const row = this.db.queryOne<NoteRow>('SELECT * FROM productivity_notes WHERE project_id = ? AND id = ?', [projectId, id]);
    return row ? mapNote(row) : null;
  }

  listNotes(projectId: string): ProductivityNote[] {
    return this.db.query<NoteRow>('SELECT * FROM productivity_notes WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500', [projectId]).map(mapNote);
  }

  updateNote(projectId: string, id: string, patch: { title?: string; body?: string }): ProductivityNote | null {
    const old = this.getNote(projectId, id);
    if (!old) return null;
    this.db.execute('UPDATE productivity_notes SET title = ?, body = ?, updated_at = ? WHERE project_id = ? AND id = ?', [patch.title?.trim() ?? old.title, patch.body ?? old.body, Date.now(), projectId, id]);
    return this.getNote(projectId, id);
  }

  deleteNote(projectId: string, id: string): boolean {
    return this.db.execute('DELETE FROM productivity_notes WHERE project_id = ? AND id = ?', [projectId, id]) === 1;
  }

  searchNotes(projectId: string, query: string, limit = 10): ProductivityNote[] {
    const bounded = Math.max(1, Math.min(30, Math.floor(limit)));
    const rows = this.db.query<NoteRow>('SELECT * FROM productivity_notes WHERE project_id = ? AND instr(lower(title || char(10) || body), lower(?)) > 0 ORDER BY updated_at DESC LIMIT ?', [projectId, query, bounded]);
    return rows.map(mapNote);
  }

  createChecklist(projectId: string, title: string): ProductivityChecklist {
    const now = Date.now(); const id = `check_${randomUUID().slice(0, 12)}`;
    this.db.execute('INSERT INTO productivity_checklists (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, projectId, title.trim(), now, now]);
    const checklist = this.getChecklist(projectId, id);
    if (!checklist) throw new Error('The checklist was not present after saving.');
    return checklist;
  }

  getChecklist(projectId: string, id: string): ProductivityChecklist | null {
    const row = this.db.queryOne<ChecklistRow>('SELECT * FROM productivity_checklists WHERE project_id = ? AND id = ?', [projectId, id]);
    return row ? mapChecklist(row) : null;
  }

  listChecklists(projectId: string): ProductivityChecklist[] {
    return this.db.query<ChecklistRow>('SELECT * FROM productivity_checklists WHERE project_id = ? ORDER BY updated_at DESC LIMIT 200', [projectId]).map(mapChecklist);
  }

  createTask(projectId: string, title: string, description = '', dueAt: number | null = null, checklistId: string | null = null): ProductivityTask {
    if (checklistId && !this.getChecklist(projectId, checklistId)) throw new Error('The selected checklist is not in the active project.');
    const now = Date.now();
    const id = `ptask_${randomUUID().slice(0, 12)}`;
    this.db.execute('INSERT INTO productivity_tasks (id, project_id, title, description, status, due_at, checklist_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, projectId, title.trim(), description, 'open', dueAt, checklistId, now, now]);
    const task = this.getTask(projectId, id);
    if (!task) throw new Error('The task was not present after saving.');
    return task;
  }

  getTask(projectId: string, id: string): ProductivityTask | null {
    const row = this.db.queryOne<TaskRow>('SELECT * FROM productivity_tasks WHERE project_id = ? AND id = ?', [projectId, id]);
    return row ? mapTask(row) : null;
  }

  listTasks(projectId: string, status?: ProductivityTask['status'], checklistId?: string | null): ProductivityTask[] {
    const clauses = ['project_id = ?']; const params: (string | null)[] = [projectId];
    if (status) { clauses.push('status = ?'); params.push(status); }
    if (checklistId !== undefined) { clauses.push('checklist_id IS ?'); params.push(checklistId); }
    const rows = this.db.query<TaskRow>(`SELECT * FROM productivity_tasks WHERE ${clauses.join(' AND ')} ORDER BY due_at IS NULL, due_at, updated_at DESC LIMIT 200`, params);
    return rows.map(mapTask);
  }

  updateTask(projectId: string, id: string, patch: { title?: string; description?: string; status?: ProductivityTask['status']; dueAt?: number | null; checklistId?: string | null }): ProductivityTask | null {
    const old = this.getTask(projectId, id);
    if (!old) return null;
    const checklistId = patch.checklistId === undefined ? old.checklistId : patch.checklistId;
    if (checklistId && !this.getChecklist(projectId, checklistId)) throw new Error('The selected checklist is not in the active project.');
    this.db.execute('UPDATE productivity_tasks SET title = ?, description = ?, status = ?, due_at = ?, checklist_id = ?, updated_at = ? WHERE project_id = ? AND id = ?', [patch.title?.trim() ?? old.title, patch.description ?? old.description, patch.status ?? old.status, patch.dueAt === undefined ? old.dueAt : patch.dueAt, checklistId, Date.now(), projectId, id]);
    return this.getTask(projectId, id);
  }
}

interface NoteRow { id: string; project_id: string; title: string; body: string; created_at: number; updated_at: number }
interface TaskRow { id: string; project_id: string; title: string; description: string; status: ProductivityTask['status']; due_at: number | null; checklist_id: string | null; created_at: number; updated_at: number }
interface ChecklistRow { id: string; project_id: string; title: string; created_at: number; updated_at: number }
function mapNote(row: NoteRow): ProductivityNote { return { id: row.id, projectId: row.project_id, title: row.title, body: row.body, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
function mapTask(row: TaskRow): ProductivityTask { return { id: row.id, projectId: row.project_id, title: row.title, description: row.description, status: row.status, dueAt: row.due_at === null ? null : Number(row.due_at), checklistId: row.checklist_id ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
function mapChecklist(row: ChecklistRow): ProductivityChecklist { return { id: row.id, projectId: row.project_id, title: row.title, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
