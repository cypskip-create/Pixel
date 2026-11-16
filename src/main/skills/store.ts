import { randomUUID } from 'node:crypto';
import type { Database } from '../data/database';
import {
  SkillDefinitionSchema,
  skillDefinitionHash,
} from './schema';
import type { SkillDefinition, SkillDraftInput } from './schema';

export type SkillRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'denied';

export class SkillStore {
  constructor(private readonly db: Database) {}

  /** Saves a new immutable draft version. Drafts are never runnable. */
  createDraft(input: SkillDraftInput): SkillDefinition {
    const previous = this.db.queryOne<{ version: number }>(
      'SELECT MAX(version) AS version FROM skills WHERE project_id = ? AND name = ?',
      [input.projectId, input.name],
    );
    const now = Date.now();
    const candidate: SkillDefinition = {
      ...input,
      id: `skill_${randomUUID().slice(0, 12)}`,
      status: 'draft',
      version: Number(previous?.version ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    const skill = SkillDefinitionSchema.parse(candidate);
    this.db.execute(
      `INSERT INTO skills (id, project_id, name, version, status, definition, definition_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [skill.id, skill.projectId, skill.name, skill.version, skill.status,
        JSON.stringify(skill), skillDefinitionHash(skill), now, now],
    );
    return this.get(skill.id) ?? (() => { throw new Error('Skill draft failed read-back validation.'); })();
  }

  /** A user-reviewed draft must be explicitly activated before it can run. */
  activate(id: string): SkillDefinition {
    const current = this.get(id);
    if (!current) throw new Error('The skill is missing or its stored definition failed validation.');
    if (current.status === 'active') return current;
    const active: SkillDefinition = SkillDefinitionSchema.parse({ ...current, status: 'active', updatedAt: Date.now() });
    const changed = this.db.execute(
      'UPDATE skills SET status = ?, definition = ?, definition_hash = ?, updated_at = ? WHERE id = ? AND status = ?',
      ['active', JSON.stringify(active), skillDefinitionHash(active), active.updatedAt, id, 'draft'],
    );
    if (changed !== 1) throw new Error('The draft changed while it was being reviewed. Reload it before activating.');
    return this.get(id) ?? (() => { throw new Error('Activated skill failed read-back validation.'); })();
  }

  get(id: string): SkillDefinition | null {
    const row = this.db.queryOne<{ definition: string; definition_hash: string }>(
      'SELECT definition, definition_hash FROM skills WHERE id = ?', [id],
    );
    if (!row) return null;
    try {
      const parsed: unknown = JSON.parse(row.definition);
      const result = SkillDefinitionSchema.safeParse(parsed);
      if (!result.success || skillDefinitionHash(result.data) !== row.definition_hash) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  list(projectId: string): SkillDefinition[] {
    const rows = this.db.query<{ id: string }>(
      'SELECT id FROM skills WHERE project_id = ? ORDER BY updated_at DESC, version DESC', [projectId],
    );
    return rows.flatMap((row) => {
      const skill = this.get(String(row.id));
      return skill ? [skill] : [];
    });
  }

  /** Active skills only; routines and replay must use this entry point. */
  getActive(id: string): SkillDefinition | null {
    const skill = this.get(id);
    return skill?.status === 'active' ? skill : null;
  }

  delete(id: string): boolean {
    return this.db.execute('DELETE FROM skills WHERE id = ?', [id]) > 0;
  }

  startRun(skill: SkillDefinition, projectId = skill.projectId): string {
    if (skill.status !== 'active' || !this.isIntact(skill)) {
      throw new Error('Only an intact, user-reviewed active skill can run.');
    }
    const id = `skillrun_${randomUUID().slice(0, 12)}`;
    this.db.execute(
      `INSERT INTO skill_runs (id, skill_id, project_id, started_at, status, step_count)
       VALUES (?, ?, ?, ?, 'running', 0)`,
      [id, skill.id, projectId, Date.now()],
    );
    return id;
  }

  finishRun(
    id: string,
    result: { status: Exclude<SkillRunStatus, 'running'>; stepCount: number; summary?: string },
  ): void {
    this.db.execute(
      `UPDATE skill_runs SET ended_at = ?, status = ?, step_count = ?, failure = ?
       WHERE id = ? AND status = 'running'`,
      [Date.now(), result.status, Math.max(0, Math.floor(result.stepCount)), result.summary ?? null, id],
    );
  }

  isIntact(skill: SkillDefinition): boolean {
    const row = this.db.queryOne<{ definition_hash: string }>(
      'SELECT definition_hash FROM skills WHERE id = ?', [skill.id],
    );
    return row !== null && String(row.definition_hash) === skillDefinitionHash(skill);
  }
}
