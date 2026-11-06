/**
 * Project-aware memory store.
 *
 * Everything here is project-scoped. A memory belongs to exactly one project and
 * is invisible to queries for another project unless the caller explicitly asks
 * for cross-project results, which the tool gateway only allows for the user's own
 * explicit request.
 *
 * Duplicate detection is a UNIQUE(project_id, content_hash) constraint rather than
 * an application check, so two concurrent saves cannot both insert. A duplicate
 * save returns the existing record and says so, which is what the model needs to
 * hear instead of a silent second copy.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Database, SqlValue } from '../data/database';
import type {
  MemoryDraft,
  MemoryKind,
  MemoryRecord,
  MemorySearchHit,
  MemorySearchQuery,
  MemoryStats,
  Confidence,
  Retention,
} from './types';
import { RANK } from './types';

interface MemoryRow {
  id: string;
  project_id: string;
  kind: string;
  content: string;
  source: string;
  confidence: string;
  retention: string;
  tags: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
  expires_at: number | null;
}

const DAY_MS = 86_400_000;

export interface SaveResult {
  memory: MemoryRecord;
  /** True when an identical record already existed and was returned instead. */
  duplicate: boolean;
}

export class MemoryStore {
  constructor(private readonly db: Database) {}

  /* ------------------------------ projects ---------------------------- */

  /** Create the project if needed and return its id. */
  ensureProject(name: string, description?: string): string {
    const existing = this.db.queryOne<{ id: string }>('SELECT id FROM projects WHERE name = ?', [
      name,
    ]);
    if (existing) return String(existing.id);

    const id = `prj_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    this.db.execute(
      'INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, description ?? null, now, now],
    );
    return id;
  }

  listProjects(): Array<{ id: string; name: string; description: string | null }> {
    return this.db
      .query<{ id: string; name: string; description: string | null }>(
        'SELECT id, name, description FROM projects ORDER BY name',
      )
      .map((row) => ({ id: String(row.id), name: String(row.name), description: row.description }));
  }

  /** The project new memories are filed under until the user changes it. */
  getActiveProject(): string {
    const row = this.db.queryOne<{ value: string }>(
      "SELECT value FROM preferences WHERE key = 'active_project'",
    );
    if (row) return String(row.value);
    return this.ensureProject('default');
  }

  setActiveProject(name: string): string {
    const id = this.ensureProject(name);
    this.db.execute(
      `INSERT INTO preferences (key, value, updated_at) VALUES ('active_project', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [id, Date.now()],
    );
    return id;
  }

  /* ------------------------------ writing ----------------------------- */

  save(draft: MemoryDraft): SaveResult {
    const content = normalise(draft.content);
    if (content.length === 0) throw new Error('A memory cannot be empty.');

    const hash = contentHash(draft.kind, content, draft.projectId);
    const existing = this.db.queryOne<MemoryRow>(
      'SELECT * FROM memories WHERE project_id = ? AND content_hash = ?',
      [draft.projectId, hash],
    );

    if (existing) {
      const merged = { ...existing, use_count: Number(existing.use_count) + 1 };
      this.db.execute('UPDATE memories SET use_count = ?, last_used_at = ? WHERE id = ?', [
        merged.use_count,
        Date.now(),
        String(existing.id),
      ]);
      return { memory: toRecord({ ...existing, use_count: merged.use_count }), duplicate: true };
    }

    const id = `mem_${randomUUID().slice(0, 12)}`;
    const now = Date.now();
    this.db.execute(
      `INSERT INTO memories
        (id, project_id, kind, content, source, content_hash, confidence, retention, tags,
         created_at, updated_at, last_used_at, use_count, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
      [
        id,
        draft.projectId,
        draft.kind,
        content,
        draft.source,
        hash,
        (draft.confidence ?? 'user_approved') satisfies Confidence,
        (draft.retention ?? 'permanent') satisfies Retention,
        (draft.tags ?? []).join(' '),
        now,
        now,
        draft.retention === 'expiring' ? (draft.expiresAt ?? now + 7 * DAY_MS) : null,
      ],
    );

    const saved = this.get(id);
    if (!saved) throw new Error('The memory could not be read back after saving.');
    return { memory: saved, duplicate: false };
  }

  update(id: string, patch: { content?: string; kind?: MemoryKind; tags?: string[] }): MemoryRecord {
    const current = this.get(id);
    if (!current) throw new Error(`No memory with id ${id}.`);

    const content = patch.content !== undefined ? normalise(patch.content) : current.content;
    const kind = patch.kind ?? current.kind;
    const tags = (patch.tags ?? current.tags).join(' ');

    this.db.execute(
      `UPDATE memories
         SET content = ?, kind = ?, tags = ?, content_hash = ?, updated_at = ?
       WHERE id = ?`,
      [content, kind, tags, contentHash(kind, content, current.projectId), Date.now(), id],
    );

    const updated = this.get(id);
    if (!updated) throw new Error('The memory disappeared during update.');
    return updated;
  }

  delete(id: string): boolean {
    return this.db.execute('DELETE FROM memories WHERE id = ?', [id]) > 0;
  }

  /** Remove expired records. Returns how many went. */
  pruneExpired(now = Date.now()): number {
    return this.db.execute(
      "DELETE FROM memories WHERE retention = 'expiring' AND expires_at IS NOT NULL AND expires_at <= ?",
      [now],
    );
  }

  /* ------------------------------ reading ----------------------------- */

  get(id: string): MemoryRecord | null {
    const row = this.db.queryOne<MemoryRow>('SELECT * FROM memories WHERE id = ?', [id]);
    return row ? toRecord(row) : null;
  }

  list(options: { projectId: string; kind?: MemoryKind; limit?: number }): MemoryRecord[] {
    const params: SqlValue[] = [options.projectId];
    let sql = 'SELECT * FROM memories WHERE project_id = ?';
    if (options.kind) {
      sql += ' AND kind = ?';
      params.push(options.kind);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(options.limit ?? 50);
    return this.db.query<MemoryRow>(sql, params).map(toRecord);
  }

  /**
   * Search memories.
   *
   * FTS5 first (bm25 + our ranking); if a query yields nothing - typically because
   * the text has no full-text tokens in common - fall back to a bounded substring
   * scan so short or partial user phrasing still finds the record.
   */
  search(query: MemorySearchQuery): MemorySearchHit[] {
    const limit = Math.max(1, Math.min(query.limit ?? 10, 50));
    const projectIds = query.includeOtherProjects
      ? this.db.query<{ id: string }>('SELECT id FROM projects').map((row) => String(row.id))
      : [query.projectId];

    const text = query.text.trim();
    if (text.length === 0) {
      return this.list({ projectId: query.projectId, limit }).map((memory) => ({
        memory,
        score: 1,
        matchedOn: 'substring',
      }));
    }

    const fts = this.searchFts(text, projectIds, query.kinds, limit);
    if (fts.length > 0) return fts;
    return this.searchSubstring(text, projectIds, query.kinds, limit);
  }

  private searchFts(
    text: string,
    projectIds: string[],
    kinds: MemoryKind[] | undefined,
    limit: number,
  ): MemorySearchHit[] {
    const match = toFtsQuery(text);
    if (!match) return [];

    const placeholders = projectIds.map(() => '?').join(', ');
    const params: SqlValue[] = [match, ...projectIds];
    let sql = `
      SELECT m.*, bm25(memory_fts) AS rank
        FROM memory_fts
        JOIN memories m ON m.rowid = memory_fts.rowid
       WHERE memory_fts MATCH ? AND m.project_id IN (${placeholders})`;
    if (kinds && kinds.length > 0) {
      sql += ` AND m.kind IN (${kinds.map(() => '?').join(', ')})`;
      params.push(...kinds);
    }
    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit * 4);

    try {
      const rows = this.db.query<MemoryRow & { rank: number }>(sql, params);
      return rows
        .map((row) => ({
          memory: toRecord(row),
          score: scoreOf(toRecord(row), Number(row.rank)),
          matchedOn: 'fts' as const,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch {
      // Malformed FTS expression: fall through to the substring path.
      return [];
    }
  }

  private searchSubstring(
    text: string,
    projectIds: string[],
    kinds: MemoryKind[] | undefined,
    limit: number,
  ): MemorySearchHit[] {
    const placeholders = projectIds.map(() => '?').join(', ');
    const params: SqlValue[] = [`%${text.toLowerCase()}%`, ...projectIds];
    let sql = `
      SELECT * FROM memories
       WHERE lower(content) LIKE ? AND project_id IN (${placeholders})`;
    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(', ')})`;
      params.push(...kinds);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit * 4);

    return this.db
      .query<MemoryRow>(sql, params)
      .map((row) => ({
        memory: toRecord(row),
        score: scoreOf(toRecord(row), null),
        matchedOn: 'substring' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Record that a memory was used, which nudges its ranking upward. */
  touch(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    for (const id of ids) {
      this.db.execute(
        'UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?',
        [now, id],
      );
    }
  }

  stats(projectId: string): MemoryStats {
    const total = Number(
      this.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM memories WHERE project_id = ?', [
        projectId,
      ])?.n ?? 0,
    );
    const byKind: Record<string, number> = {};
    for (const row of this.db.query<{ kind: string; n: number }>(
      'SELECT kind, COUNT(*) AS n FROM memories WHERE project_id = ? GROUP BY kind',
      [projectId],
    )) {
      byKind[String(row.kind)] = Number(row.n);
    }
    const expired = Number(
      this.db.queryOne<{ n: number }>(
        "SELECT COUNT(*) AS n FROM memories WHERE project_id = ? AND retention = 'expiring' AND expires_at IS NOT NULL AND expires_at <= ?",
        [projectId, Date.now()],
      )?.n ?? 0,
    );
    return { total, byKind, expired };
  }
}

/* -------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------- */

/** Collapse whitespace so trivial formatting cannot defeat duplicate detection. */
export function normalise(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

/** Stable hash identifying an equivalent memory within a project. */
export function contentHash(kind: string, content: string, projectId: string): string {
  return createHash('sha256')
    .update(`${projectId}\u0000${kind}\u0000${content.toLowerCase()}`)
    .digest('hex');
}

/**
 * Relevance score: FTS rank, confidence, usage and recency.
 *
 * bm25 in SQLite is "smaller is better", so it is inverted. The weights are
 * exported in RANK so the tests assert ordering rather than magic numbers.
 */
export function scoreOf(memory: MemoryRecord, rank: number | null): number {
  const confidence =
    memory.confidence === 'user_approved'
      ? RANK.confidenceUserApproved
      : memory.confidence === 'source_backed'
        ? RANK.confidenceSourceBacked
        : RANK.confidenceInferred;

  const textScore = rank === null ? RANK.substringBase : 1 / (1 + Math.max(0, rank));
  const usage = Math.min(memory.useCount, 10) * RANK.usageWeight * 0.1;
  const ageDays = (Date.now() - memory.updatedAt) / DAY_MS;
  const recency = Math.pow(0.5, ageDays / RANK.recencyHalfLifeDays);

  return textScore + confidence + usage + recency * 0.5;
}

/**
 * Turn user text into an FTS5 query.
 *
 * Each word becomes a prefix term, so "dns root" matches "dns root server". FTS5
 * syntax characters are stripped rather than escaped, because passing them through
 * produces a syntax error for perfectly ordinary input like "10.0.0.1/24".
 */
export function toFtsQuery(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (words.length === 0) return '';
  return words.map((word) => `"${word}"*`).join(' OR ');
}

function toRecord(row: MemoryRow | (MemoryRow & { rank?: number })): MemoryRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: String(row.kind) as MemoryKind,
    content: String(row.content),
    source: String(row.source),
    confidence: String(row.confidence) as Confidence,
    retention: String(row.retention) as Retention,
    tags: String(row.tags ?? '')
      .split(' ')
      .filter((tag) => tag.length > 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    useCount: Number(row.use_count),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  };
}
