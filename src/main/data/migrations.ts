/**
 * Schema migrations.
 *
 * Applied in order inside a transaction and recorded in `schema_migrations`.
 * Migrations are append-only: an already released version is never edited,
 * because a user's database has already run it.
 *
 * `PRAGMA user_version` is also set, so a database touched by hand for debugging
 * still reports which schema it holds.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'core-memory',
    sql: `
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE memories (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        content     TEXT NOT NULL,
        source      TEXT NOT NULL,
        -- Duplicate detection: hash of kind + normalised content + project.
        content_hash TEXT NOT NULL,
        confidence  TEXT NOT NULL,
        retention   TEXT NOT NULL,
        tags        TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        last_used_at INTEGER,
        use_count   INTEGER NOT NULL DEFAULT 0,
        expires_at  INTEGER,
        UNIQUE (project_id, content_hash)
      );

      CREATE INDEX idx_memories_project ON memories(project_id, kind);
      CREATE INDEX idx_memories_updated ON memories(updated_at DESC);

      -- External-content FTS table: the index holds no copy of the text.
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        content,
        tags,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61'
      );

      CREATE TRIGGER memory_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, content, tags)
        VALUES (new.rowid, new.content, new.tags);
      END;

      CREATE TRIGGER memory_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content, tags)
        VALUES ('delete', old.rowid, old.content, old.tags);
      END;

      CREATE TRIGGER memory_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content, tags)
        VALUES ('delete', old.rowid, old.content, old.tags);
        INSERT INTO memory_fts(rowid, content, tags)
        VALUES (new.rowid, new.content, new.tags);
      END;

      CREATE TABLE audit_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         INTEGER NOT NULL,
        project_id TEXT,
        kind       TEXT NOT NULL,
        summary    TEXT NOT NULL,
        detail     TEXT,
        outcome    TEXT NOT NULL
      );

      CREATE INDEX idx_audit_at ON audit_events(at DESC);

      CREATE TABLE model_usage (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        at                INTEGER NOT NULL,
        project_id        TEXT,
        provider          TEXT NOT NULL,
        model             TEXT NOT NULL,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        run_id            TEXT
      );

      CREATE INDEX idx_usage_at ON model_usage(at DESC);

      CREATE TABLE preferences (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'documents',
    sql: `
      CREATE TABLE documents (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path         TEXT NOT NULL,
        kind         TEXT NOT NULL,
        title        TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL,
        modified_at  INTEGER NOT NULL,
        -- Hash of the file content, used to detect changes for re-indexing.
        content_hash TEXT NOT NULL,
        indexed_at   INTEGER NOT NULL,
        chunk_count  INTEGER NOT NULL DEFAULT 0,
        extractor    TEXT NOT NULL DEFAULT '',
        error        TEXT,
        UNIQUE (project_id, path)
      );

      CREATE INDEX idx_documents_project ON documents(project_id);

      CREATE TABLE document_chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        content     TEXT NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        location    TEXT
      );

      CREATE INDEX idx_chunks_document ON document_chunks(document_id, ordinal);

      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        content,
        content='document_chunks',
        content_rowid='id',
        tokenize='unicode61'
      );

      CREATE TRIGGER chunks_fts_insert AFTER INSERT ON document_chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER chunks_fts_delete AFTER DELETE ON document_chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      END;
    `,
  },
  {
    version: 3,
    name: 'workflows',
    sql: `
      CREATE TABLE workflows (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        -- Hash of the step list, so replay can verify nothing changed silently.
        definition_hash TEXT NOT NULL,
        UNIQUE (project_id, name)
      );

      CREATE TABLE workflow_steps (
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        -- Semantic locator, never a raw coordinate unless nothing else exists.
        locator     TEXT NOT NULL,
        action      TEXT NOT NULL,
        params      TEXT NOT NULL DEFAULT '{}',
        -- Expected observable result used to verify a replayed step.
        expectation TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (workflow_id, ordinal)
      );

      CREATE TABLE workflow_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        status      TEXT NOT NULL,
        steps_done  INTEGER NOT NULL DEFAULT 0,
        failure     TEXT
      );

      CREATE TABLE tasks (
        id         TEXT PRIMARY KEY,
        project_id TEXT,
        title      TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        ended_at   INTEGER,
        payload    TEXT
      );
    `,
  },
  {
    version: 4,
    name: 'agents',
    sql: `
      CREATE TABLE agent_runs (
        id           TEXT PRIMARY KEY,
        project_id   TEXT,
        specialist   TEXT NOT NULL,
        objective    TEXT NOT NULL,
        status       TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        steps        INTEGER NOT NULL DEFAULT 0,
        tokens_used  INTEGER NOT NULL DEFAULT 0,
        result       TEXT,
        error        TEXT
      );

      CREATE TABLE delegations (
        id           TEXT PRIMARY KEY,
        parent_run   TEXT NOT NULL,
        child_run    TEXT NOT NULL,
        specialist   TEXT NOT NULL,
        granted_tools TEXT NOT NULL,
        created_at   INTEGER NOT NULL
      );

      CREATE INDEX idx_agent_runs_project ON agent_runs(project_id, started_at DESC);
    `,
  },
] as const;

/** The schema version this build expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
