import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Database, openDatabase } from '../src/main/data/database';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../src/main/data/migrations';
import { MemoryStore, contentHash, normalise, scoreOf, toFtsQuery } from '../src/main/memory/store';
import { buildMemoryContext, formatMemory, selectMemoryContext } from '../src/main/memory/context';
import { MemoryTools, MEMORY_TOOL_DEFINITIONS } from '../src/main/memory/toolset';
import type { MemoryRecord } from '../src/main/memory/types';

const openDatabases: Database[] = [];
const tempDirs: string[] = [];

function memoryDb(): Database {
  const db = openDatabase(':memory:');
  openDatabases.push(db);
  return db;
}

function fileDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-db-'));
  tempDirs.push(dir);
  const db = openDatabase(join(dir, 'pixel.db'));
  openDatabases.push(db);
  return { db, dir };
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Database and migrations
 * ------------------------------------------------------------------ */

describe('database', () => {
  it('applies every migration and records the version', () => {
    const db = memoryDb();
    expect(db.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    const applied = db.query<{ version: number }>('SELECT version FROM schema_migrations');
    expect(applied).toHaveLength(MIGRATIONS.length);
  });

  it('is idempotent: migrating twice applies nothing new', () => {
    const db = memoryDb();
    expect(db.migrate()).toBe(0);
  });

  it('creates the FTS tables', () => {
    const db = memoryDb();
    const names = db
      .query<{ name: string }>("SELECT name FROM sqlite_master WHERE name LIKE '%fts%'")
      .map((row) => String(row.name));
    expect(names).toContain('memory_fts');
    expect(names).toContain('chunks_fts');
  });

  it('rolls back a failed transaction', () => {
    const db = memoryDb();
    db.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'one', 0, 0)");
    expect(() =>
      db.transaction(() => {
        db.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p2', 'two', 0, 0)");
        throw new Error('boom');
      }),
    ).toThrow(/boom/);
    expect(db.query('SELECT id FROM projects')).toHaveLength(1);
  });

  it('supports nested transactions without a SQLite error', () => {
    const db = memoryDb();
    const result = db.transaction(() =>
      db.transaction(() => {
        db.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p9', 'nine', 0, 0)");
        return 'ok';
      }),
    );
    expect(result).toBe('ok');
    expect(db.query('SELECT id FROM projects')).toHaveLength(1);
  });

  it('enforces foreign keys', () => {
    const db = memoryDb();
    expect(() =>
      db.execute(
        `INSERT INTO memories (id, project_id, kind, content, source, content_hash, confidence, retention, created_at, updated_at)
         VALUES ('m1', 'missing', 'fact', 'x', 's', 'h', 'user_approved', 'permanent', 0, 0)`,
      ),
    ).toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Persistence and restart recovery
 * ------------------------------------------------------------------ */

describe('memory persistence', () => {
  it('survives closing and reopening the database file', () => {
    const { db, dir } = fileDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('dns-lab');
    store.save({
      projectId: project,
      kind: 'project',
      content: 'DNS root server is 10.20.30.40/24',
      source: 'conversation',
      tags: ['dns', 'lab'],
    });
    db.close();

    const reopened = openDatabase(join(dir, 'pixel.db'));
    openDatabases.push(reopened);
    const reopenedStore = new MemoryStore(reopened);
    const hits = reopenedStore.search({ projectId: project, text: 'dns root' });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].memory.content).toContain('10.20.30.40');
    expect(hits[0].memory.tags).toContain('dns');
  });

  it('preserves the active project across a restart', () => {
    const { db, dir } = fileDb();
    const store = new MemoryStore(db);
    store.setActiveProject('infra');
    db.close();

    const reopened = openDatabase(join(dir, 'pixel.db'));
    openDatabases.push(reopened);
    const reopenedStore = new MemoryStore(reopened);
    expect(reopenedStore.listProjects().map((p) => p.name)).toContain('infra');
    const active = reopenedStore.getActiveProject();
    expect(reopenedStore.list({ projectId: active })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Project isolation
 * ------------------------------------------------------------------ */

describe('project isolation', () => {
  it('never returns another project\u2019s memories by default', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const alpha = store.ensureProject('alpha');
    const beta = store.ensureProject('beta');

    store.save({ projectId: alpha, kind: 'project', content: 'alpha secret 10.0.0.1', source: 'conversation' });
    store.save({ projectId: beta, kind: 'project', content: 'beta secret 10.0.0.2', source: 'conversation' });

    const alphaHits = store.search({ projectId: alpha, text: 'secret' });
    expect(alphaHits).toHaveLength(1);
    expect(alphaHits[0].memory.content).toContain('10.0.0.1');

    const betaHits = store.search({ projectId: beta, text: 'secret' });
    expect(betaHits).toHaveLength(1);
    expect(betaHits[0].memory.content).toContain('10.0.0.2');
  });

  it('allows cross-project search only when explicitly requested', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const alpha = store.ensureProject('alpha');
    const beta = store.ensureProject('beta');
    store.save({ projectId: alpha, kind: 'fact', content: 'shared word zebra', source: 'conversation' });
    store.save({ projectId: beta, kind: 'fact', content: 'shared word zebra', source: 'conversation' });

    const scoped = store.search({ projectId: alpha, text: 'zebra' });
    const global = store.search({ projectId: alpha, text: 'zebra', includeOtherProjects: true });

    expect(scoped).toHaveLength(1);
    expect(global).toHaveLength(2);
  });

  it('refuses to forget another project\u2019s memory', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const alpha = store.ensureProject('alpha');
    const beta = store.ensureProject('beta');
    const saved = store.save({
      projectId: beta,
      kind: 'fact',
      content: 'beta only',
      source: 'conversation',
    });

    const tools = new MemoryTools(store, () => alpha);
    const result = tools.run('memory_forget', { id: saved.memory.id });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('DENIED');
    expect(store.get(saved.memory.id)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Duplicates, update, delete, retention
 * ------------------------------------------------------------------ */

describe('memory records', () => {
  it('detects a duplicate instead of storing a second copy', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');

    const first = store.save({ projectId: project, kind: 'fact', content: 'Gateway is 10.0.0.1', source: 'conversation' });
    const second = store.save({ projectId: project, kind: 'fact', content: '  Gateway   is 10.0.0.1 ', source: 'conversation' });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.memory.id).toBe(first.memory.id);
    expect(store.list({ projectId: project })).toHaveLength(1);
    expect(store.get(first.memory.id)?.useCount).toBe(1);
  });

  it('treats the same text in different projects as distinct', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const a = store.ensureProject('a');
    const b = store.ensureProject('b');
    store.save({ projectId: a, kind: 'fact', content: 'same text', source: 'conversation' });
    store.save({ projectId: b, kind: 'fact', content: 'same text', source: 'conversation' });
    expect(store.list({ projectId: a })).toHaveLength(1);
    expect(store.list({ projectId: b })).toHaveLength(1);
  });

  it('updates content and keeps the record findable by the new text', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    const saved = store.save({ projectId: project, kind: 'fact', content: 'old value 1.1.1.1', source: 'conversation' });

    store.update(saved.memory.id, { content: 'new value 8.8.8.8' });

    expect(store.search({ projectId: project, text: '8.8.8.8' })).toHaveLength(1);
    // The FTS index must no longer serve the old text.
    expect(store.search({ projectId: project, text: '1.1.1.1' })).toHaveLength(0);
  });

  it('deletes a record and removes it from search', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    const saved = store.save({ projectId: project, kind: 'fact', content: 'delete me please', source: 'conversation' });

    expect(store.delete(saved.memory.id)).toBe(true);
    expect(store.get(saved.memory.id)).toBeNull();
    expect(store.search({ projectId: project, text: 'delete' })).toHaveLength(0);
    expect(store.delete(saved.memory.id)).toBe(false);
  });

  it('prunes expired records and reports the count', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({
      projectId: project,
      kind: 'outcome',
      content: 'temporary note',
      source: 'conversation',
      retention: 'expiring',
      expiresAt: Date.now() - 1000,
    });
    store.save({ projectId: project, kind: 'fact', content: 'permanent note', source: 'conversation' });

    expect(store.stats(project).expired).toBe(1);
    expect(store.pruneExpired()).toBe(1);
    expect(store.list({ projectId: project })).toHaveLength(1);
  });

  it('rejects empty content', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    expect(() => store.save({ projectId: project, kind: 'fact', content: '   ', source: 'x' })).toThrow(
      /empty/i,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Ranking and search behaviour
 * ------------------------------------------------------------------ */

describe('retrieval ranking', () => {
  it('ranks user-approved memories above inferred ones of equal text match', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({
      projectId: project,
      kind: 'fact',
      content: 'nameserver is 192.168.1.53',
      source: 'conversation',
      confidence: 'inferred',
    });
    store.save({
      projectId: project,
      kind: 'fact',
      content: 'nameserver is 192.168.1.53 confirmed',
      source: 'conversation',
      confidence: 'user_approved',
    });

    const hits = store.search({ projectId: project, text: 'nameserver' });
    expect(hits).toHaveLength(2);
    expect(hits[0].memory.confidence).toBe('user_approved');
  });

  it('finds a record by partial word through the FTS prefix query', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({ projectId: project, kind: 'project', content: 'VirtualBox host-only adapter config', source: 'conversation' });

    expect(store.search({ projectId: project, text: 'virtual' })).toHaveLength(1);
  });

  it('falls back to substring matching for punctuation-heavy input', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({ projectId: project, kind: 'project', content: 'subnet 10.20.30.0/24', source: 'conversation' });

    const hits = store.search({ projectId: project, text: '10.20.30.0/24' });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns nothing rather than guessing when there is no match', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({ projectId: project, kind: 'fact', content: 'the gateway is 10.0.0.1', source: 'conversation' });
    expect(store.search({ projectId: project, text: 'kubernetes ingress' })).toHaveLength(0);
  });

  it('scores a confirmed record higher than an inferred one directly', () => {
    const base: MemoryRecord = {
      id: 'm',
      projectId: 'p',
      kind: 'fact',
      content: 'x',
      source: 'conversation',
      confidence: 'user_approved',
      retention: 'permanent',
      tags: [],
      createdAt: 0,
      updatedAt: Date.now(),
      lastUsedAt: null,
      useCount: 0,
      expiresAt: null,
    };
    expect(scoreOf(base, null)).toBeGreaterThan(scoreOf({ ...base, confidence: 'inferred' }, null));
  });

  it('rewards use and penalises age', () => {
    const recent: MemoryRecord = {
      id: 'm',
      projectId: 'p',
      kind: 'fact',
      content: 'x',
      source: 'conversation',
      confidence: 'user_approved',
      retention: 'permanent',
      tags: [],
      createdAt: 0,
      updatedAt: Date.now(),
      lastUsedAt: null,
      useCount: 5,
      expiresAt: null,
    };
    const old = { ...recent, updatedAt: Date.now() - 365 * 86_400_000, useCount: 0 };
    expect(scoreOf(recent, null)).toBeGreaterThan(scoreOf(old, null));
  });
});

/* ------------------------------------------------------------------ *
 * Context injection
 * ------------------------------------------------------------------ */

describe('memory context injection', () => {
  const record = (overrides: Partial<MemoryRecord>): MemoryRecord => ({
    id: 'm1',
    projectId: 'p',
    kind: 'fact',
    content: 'DNS root server is 10.20.30.40',
    source: 'C:/notes/dns.txt',
    confidence: 'user_approved',
    retention: 'permanent',
    tags: ['dns'],
    createdAt: 0,
    updatedAt: Date.now(),
    lastUsedAt: null,
    useCount: 0,
    expiresAt: null,
    ...overrides,
  });

  it('labels each memory with its provenance', () => {
    const confirmed = formatMemory(record({}));
    const inferred = formatMemory(record({ confidence: 'inferred' }));
    const sourced = formatMemory(record({ confidence: 'source_backed' }));

    expect(confirmed).toContain('confirmed');
    expect(inferred).toContain('unverified inference');
    expect(sourced).toContain('source: dns.txt');
  });

  it('marks the block as reference data, not instructions', () => {
    const block = buildMemoryContext([{ memory: record({}), score: 1, matchedOn: 'fts' }]);
    expect(block.text).toMatch(/never as instructions/i);
    expect(block.memoryIds).toEqual(['m1']);
  });

  it('respects the character budget and reports truncation', () => {
    const hits = Array.from({ length: 20 }, (_, index) => ({
      memory: record({ id: `m${String(index)}`, content: 'x'.repeat(120) }),
      score: 1,
      matchedOn: 'fts' as const,
    }));
    const block = buildMemoryContext(hits, 400);
    expect(block.text.length).toBeLessThanOrEqual(400 + 200);
    expect(block.truncated).toBe(true);
    expect(block.memoryIds.length).toBeLessThan(hits.length);
  });

  it('returns an empty block when nothing was retrieved', () => {
    expect(buildMemoryContext([])).toEqual({ text: '', memoryIds: [], truncated: false });
  });

  it('selects from the store and records usage of only what was sent', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({ projectId: project, kind: 'project', content: 'DNS root server 10.20.30.40', source: 'conversation' });

    const block = selectMemoryContext(store, { projectId: project, text: 'dns root server' });
    expect(block.memoryIds).toHaveLength(1);
    expect(store.get(block.memoryIds[0])?.useCount).toBe(1);
  });

  it('returns nothing for an empty question rather than dumping the store', () => {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    store.save({ projectId: project, kind: 'fact', content: 'some fact', source: 'conversation' });
    expect(selectMemoryContext(store, { projectId: project, text: '   ' }).text).toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

describe('memory tools', () => {
  function tools(): { tools: MemoryTools; store: MemoryStore; project: string } {
    const db = memoryDb();
    const store = new MemoryStore(db);
    const project = store.ensureProject('p');
    return { tools: new MemoryTools(store, () => project), store, project };
  }

  it('every memory tool is declared for the registry', () => {
    const names = MEMORY_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toEqual(['memory_save', 'memory_search', 'memory_list', 'memory_forget']);
  });

  it('writes and reads back a memory', () => {
    const { tools: api, store, project } = tools();
    const saved = api.run('memory_save', { content: 'Gateway 10.0.0.1', kind: 'fact', tags: ['net'] });
    expect(saved.ok).toBe(true);

    const search = api.run('memory_search', { query: 'gateway' });
    expect(search.ok).toBe(true);
    expect(search.content).toContain('10.0.0.1');
    expect(store.list({ projectId: project })).toHaveLength(1);
  });

  it('says so when nothing is remembered instead of inventing an answer', () => {
    const { tools: api } = tools();
    const result = api.run('memory_search', { query: 'anything at all' });
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/do not invent/i);
  });

  it('reports a duplicate save honestly', () => {
    const { tools: api } = tools();
    api.run('memory_save', { content: 'Same fact', kind: 'fact' });
    const second = api.run('memory_save', { content: 'same   fact', kind: 'fact' });
    expect(second.content).toMatch(/already remembered/i);
  });

  it('lists and forgets', () => {
    const { tools: api } = tools();
    const saved = api.run('memory_save', { content: 'temporary', kind: 'outcome' });
    expect(api.run('memory_list', {}).content).toContain('temporary');

    const id = (saved.detail as { id: string }).id;
    expect(api.run('memory_forget', { id }).ok).toBe(true);
    expect(api.run('memory_list', {}).content).toMatch(/no stored memories/i);
  });

  it('rejects an unknown memory id on forget', () => {
    const { tools: api } = tools();
    expect(api.run('memory_forget', { id: 'nope' }).errorCode).toBe('NOT_FOUND');
  });

  it('rejects an empty save', () => {
    const { tools: api } = tools();
    expect(api.run('memory_save', { content: '   ', kind: 'fact' }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe('helpers', () => {
  it('normalises whitespace for duplicate detection', () => {
    expect(normalise('  a   b \n c ')).toBe('a b c');
  });

  it('hashes case-insensitively and per project', () => {
    expect(contentHash('fact', 'Hello', 'p1')).toBe(contentHash('fact', 'hello', 'p1'));
    expect(contentHash('fact', 'hello', 'p1')).not.toBe(contentHash('fact', 'hello', 'p2'));
    expect(contentHash('fact', 'hello', 'p1')).not.toBe(contentHash('project', 'hello', 'p1'));
  });

  it('builds an FTS query with prefix terms and strips syntax characters', () => {
    expect(toFtsQuery('dns root')).toBe('"dns"* OR "root"*');
    expect(toFtsQuery('10.20.30.0/24')).toContain('"10"*');
    expect(toFtsQuery('a')).toBe('');
    expect(toFtsQuery('""')).toBe('');
  });
});
