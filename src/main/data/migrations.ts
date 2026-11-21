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
  {
    version: 5,
    name: 'durable-task-events',
    sql: `
      ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE task_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        at         INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        status     TEXT NOT NULL,
        summary    TEXT NOT NULL
      );

      CREATE INDEX idx_task_events_task ON task_events(task_id, at, id);
      CREATE INDEX idx_tasks_updated ON tasks(updated_at DESC, created_at DESC);
    `,
  },
  {
    version: 6,
    name: 'reviewed-skills-and-local-routines',
    sql: `
      CREATE TABLE skills (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        version         INTEGER NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('draft', 'active')),
        definition      TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE (project_id, name, version)
      );

      CREATE INDEX idx_skills_project ON skills(project_id, updated_at DESC);

      CREATE TABLE skill_runs (
        id         TEXT PRIMARY KEY,
        skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at   INTEGER,
        status     TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'denied')),
        step_count INTEGER NOT NULL DEFAULT 0,
        failure    TEXT
      );

      CREATE INDEX idx_skill_runs_skill ON skill_runs(skill_id, started_at DESC);

      CREATE TABLE routines (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
        name       TEXT NOT NULL,
        local_time TEXT NOT NULL,
        timezone   TEXT NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_routines_enabled ON routines(enabled, local_time);

      CREATE TABLE routine_runs (
        id             TEXT PRIMARY KEY,
        routine_id     TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        skill_id       TEXT NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
        scheduled_key  TEXT NOT NULL,
        started_at     INTEGER NOT NULL,
        ended_at       INTEGER,
        status         TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'missed', 'denied')),
        task_id        TEXT,
        summary        TEXT,
        failure        TEXT,
        UNIQUE (routine_id, scheduled_key)
      );

      CREATE INDEX idx_routine_runs_routine ON routine_runs(routine_id, started_at DESC);
    `,
  },
  {
    version: 7,
    name: 'permission-grants-and-memory-revisions',
    sql: `
      CREATE TABLE permission_grants (
        id             TEXT PRIMARY KEY,
        tool_name      TEXT NOT NULL,
        target_json    TEXT NOT NULL,
        risk           TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        last_used_at   INTEGER,
        expires_at     INTEGER,
        revoked_at     INTEGER,
        policy_version INTEGER NOT NULL
      );

      CREATE INDEX idx_permission_grants_active
        ON permission_grants(revoked_at, tool_name, created_at DESC);

      CREATE TABLE memory_revisions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id       TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        source          TEXT NOT NULL,
        confidence      TEXT NOT NULL,
        updated_at      INTEGER NOT NULL,
        reason          TEXT NOT NULL
      );

      CREATE INDEX idx_memory_revisions_memory ON memory_revisions(memory_id, updated_at DESC);
    `,
  },
  {
    version: 8,
    name: 'project-scoped-notes-and-productivity-tasks',
    sql: `
      CREATE TABLE productivity_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_productivity_notes_project_updated
        ON productivity_notes(project_id, updated_at DESC);

      CREATE TABLE productivity_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed')),
        due_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_productivity_tasks_project_status
        ON productivity_tasks(project_id, status, updated_at DESC);
    `,
  },
  {
    version: 9,
    name: 'project-checklists-and-task-grouping',
    sql: `
      CREATE TABLE productivity_checklists (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_productivity_checklists_project_updated
        ON productivity_checklists(project_id, updated_at DESC);
      ALTER TABLE productivity_tasks ADD COLUMN checklist_id TEXT
        REFERENCES productivity_checklists(id) ON DELETE SET NULL;
      CREATE INDEX idx_productivity_tasks_checklist_due
        ON productivity_tasks(project_id, checklist_id, due_at, updated_at DESC);
    `,
  },
  {
    version: 10,
    name: 'plugin-installation-state',
    sql: `
      CREATE TABLE plugin_installations (
        plugin_id TEXT PRIMARY KEY,
        manifest_version TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        config_json TEXT NOT NULL DEFAULT '{}',
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_error TEXT
      );
    `,
  },
  {
    version: 11,
    name: 'project-scoped-note-document-links',
    sql: `
      CREATE TABLE productivity_note_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        note_id TEXT NOT NULL REFERENCES productivity_notes(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        created_at INTEGER NOT NULL,
        UNIQUE (note_id, path)
      );
      CREATE INDEX idx_productivity_note_documents_note
        ON productivity_note_documents(project_id, note_id, created_at);
    `,
  },
  {
    version: 12,
    name: 'project-scoped-plugin-availability',
    sql: `
      CREATE TABLE plugin_project_availability (
        plugin_id TEXT NOT NULL REFERENCES plugin_installations(plugin_id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        availability TEXT NOT NULL CHECK (availability IN ('enabled', 'disabled')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, project_id)
      );
      CREATE INDEX idx_plugin_project_availability_project
        ON plugin_project_availability(project_id, plugin_id);
    `,
  },
] as const;

/** The schema version this build expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
