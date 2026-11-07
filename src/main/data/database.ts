/**
 * SQLite access layer.
 *
 * One owner: the Electron main process. No worker receives a handle, so there is
 * a single writer and no cross-process locking problem.
 *
 * Uses Node's built-in `node:sqlite` (Node 24, bundled with Electron 45) so the
 * project needs no native module and the `--ignore-scripts` install still works.
 * SQLite is synchronous here; calls are short and the database lives on local
 * disk, which is the recommended way to use `DatabaseSync`.
 */

import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations';

export type SqlValue = string | number | null | bigint | Uint8Array;
export type SqlParams = SqlValue[] | Record<string, SqlValue>;
export type Row = Record<string, SqlValue>;

export interface DatabaseOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  /** Journal mode. WAL for the real app; memory databases ignore it. */
  wal?: boolean;
}

/**
 * A thin, typed wrapper around DatabaseSync.
 *
 * Deliberately small: it exposes query/execute/transaction and migration, and
 * nothing else, so all SQL stays readable in the domain modules.
 */
export class Database {
  private readonly db: DatabaseSync;
  private readonly statementCache = new Map<string, StatementSync>();
  private transactionDepth = 0;

  constructor(options: DatabaseOptions) {
    if (options.path !== ':memory:') {
      mkdirSync(dirname(options.path), { recursive: true });
    }
    this.db = new DatabaseSync(options.path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    if (options.wal !== false && options.path !== ':memory:') {
      // WAL survives an unclean exit and keeps readers non-blocking.
      this.db.exec('PRAGMA journal_mode = WAL');
    }
  }

  /** Apply any migrations this database has not seen. Returns how many ran. */
  migrate(): number {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = new Set(
      this.query<{ version: number }>('SELECT version FROM schema_migrations').map((row) =>
        Number(row.version),
      ),
    );

    let count = 0;
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;

      // Each migration is atomic: a failure leaves the database on the previous
      // version rather than half-migrated.
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          migration.version,
          migration.name,
          Date.now(),
        ]);
      });
      count += 1;
    }

    this.db.exec(`PRAGMA user_version = ${String(LATEST_SCHEMA_VERSION)}`);
    return count;
  }

  /** Current schema version recorded in the database. */
  schemaVersion(): number {
    try {
      const rows = this.query<{ version: number }>(
        'SELECT MAX(version) AS version FROM schema_migrations',
      );
      return Number(rows[0]?.version ?? 0);
    } catch {
      return 0;
    }
  }

  query<T = Row>(sql: string, params?: SqlParams): T[] {
    return this.prepare(sql).all(...toArgs(params)) as unknown as T[];
  }

  queryOne<T = Row>(sql: string, params?: SqlParams): T | null {
    const rows = this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /** Run a statement, returning the number of changed rows. */
  execute(sql: string, params?: SqlParams): number {
    const result = this.prepare(sql).run(...toArgs(params));
    return Number(result.changes ?? 0);
  }

  /** Insert and return the new rowid. */
  insert(sql: string, params?: SqlParams): number {
    const result = this.prepare(sql).run(...toArgs(params));
    return Number(result.lastInsertRowid ?? 0);
  }

  /**
   * Run work inside a transaction.
   *
   * Nested calls reuse the outer transaction, so a domain method can call another
   * transactional method without SQLite rejecting `BEGIN`.
   */
  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work();

    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction may already be gone; the original error matters more.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  close(): void {
    this.statementCache.clear();
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statementCache.get(sql);
    if (cached) return cached;

    const statement = this.db.prepare(sql);
    // Bound so an unusual query cannot grow the cache without limit.
    if (this.statementCache.size > 256) this.statementCache.clear();
    this.statementCache.set(sql, statement);
    return statement;
  }
}

/** Convert an optional param object into the spread form DatabaseSync expects. */
function toArgs(params?: SqlParams): SqlValue[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : (Object.values(params) as SqlValue[]);
}

/** Open (and migrate) the application database. */
export function openDatabase(path: string): Database {
  const database = new Database({ path });
  database.migrate();
  return database;
}
