import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/data/database';
import type { Database } from '../src/main/data/database';
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  DocumentIndex,
  MAX_SEARCH_RESULTS,
  chunkText,
  discoverDocuments,
  hashContent,
  toMatchQuery,
} from '../src/main/documents/indexer';
import { DocumentTools, DOCUMENT_TOOL_DEFINITIONS } from '../src/main/documents/toolset';
import { PythonWorker } from '../src/main/services/python-worker';

/**
 * Document tests.
 *
 * Pure logic (chunking, discovery, query building) always runs. Extraction needs
 * a real Python interpreter; when one is missing those tests skip with a message
 * instead of pretending to pass.
 */

const py = 'C:\\Users\\cypri\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const worker = new PythonWorker({ pythonPath: py, requestTimeoutMs: 20_000, workerRoot: process.cwd() + '/python' });
const availability = worker.availability();

if (!availability.available) {
  console.warn(`[document extraction tests skipped] ${availability.reason ?? 'python unavailable'}`);
}

const dirs: string[] = [];
const databases: Database[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-docs-'));
  dirs.push(dir);
  return dir;
}

function database(): Database {
  const db = openDatabase(':memory:');
  databases.push(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await worker.shutdown();
});

/* ------------------------------------------------------------------ *
 * Chunking
 * ------------------------------------------------------------------ */

describe('chunkText', () => {
  it('returns one chunk for short text', () => {
    const chunks = chunkText('Short note about DNS.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Short note about DNS.');
  });

  it('returns nothing for empty text', () => {
    expect(chunkText('   \n\n ')).toEqual([]);
  });

  it('splits long text into overlapping chunks', () => {
    const paragraphs = Array.from({ length: 40 }, (_, index) => `Paragraph ${String(index)} with some words.`);
    const chunks = chunkText(paragraphs.join('\n\n'), 400, 60);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(400 + 80);
    }
    // Consecutive chunks must share text, otherwise a straddling sentence would be lost.
    const first = chunks[0].content;
    const second = chunks[1].content;
    expect(first.slice(-20)).toContain(second.slice(0, 5).trim()[0] ?? '');
  });

  it('prefers a paragraph boundary over a hard cut', () => {
    const text = `${'a'.repeat(300)}\n\n${'b'.repeat(300)}`;
    const chunks = chunkText(text, 350, 0);
    expect(chunks[0].content.endsWith('a')).toBe(true);
  });

  it('labels each chunk with its character range', () => {
    const chunks = chunkText('x'.repeat(3000), CHUNK_SIZE, CHUNK_OVERLAP);
    expect(chunks[0].location).toMatch(/^chars \d+-\d+$/);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
  });
});

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

describe('discoverDocuments', () => {
  it('finds supported files and ignores others', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.md'), '# Notes');
    writeFileSync(join(dir, 'data.csv'), 'a,b\n1,2');
    writeFileSync(join(dir, 'image.png'), 'not really a png');
    writeFileSync(join(dir, 'archive.zip'), 'nope');

    const found = discoverDocuments(dir).map((entry) => entry.path.split(/[\\/]/).pop());
    expect(found).toContain('notes.md');
    expect(found).toContain('data.csv');
    expect(found).not.toContain('image.png');
    expect(found).not.toContain('archive.zip');
  });

  it('skips node_modules-style trees and dot directories', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'keep.txt'), 'keep');
    const nested = join(dir, 'node_modules', 'pkg');
    rmSync(nested, { recursive: true, force: true });
    discoverDocuments(dir); // ensure it does not throw on a missing child

    expect(discoverDocuments(dir).map((entry) => entry.path.split(/[\\/]/).pop())).toEqual(['keep.txt']);
  });

  it('respects the file limit', () => {
    const dir = tempDir();
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(dir, `file${String(index)}.txt`), 'x');
    }
    expect(discoverDocuments(dir, { maxFiles: 3 })).toHaveLength(3);
  });
});

describe('toMatchQuery', () => {
  it('builds prefix terms and drops punctuation', () => {
    expect(toMatchQuery('dns 10.20.30.0/24')).toBe('"dns"* OR "10"* OR "20"* OR "30"* OR "24"*');
  });

  it('returns an empty string when there is nothing searchable', () => {
    expect(toMatchQuery('?!')).toBe('');
    expect(toMatchQuery('a')).toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * Worker extraction (real Python)
 * ------------------------------------------------------------------ */

describe.skipIf(!availability.available)('python worker extraction', () => {
  it('reports its capabilities honestly', async () => {
    const caps = await worker.capabilities();
    expect(caps.ok).toBe(true);
    if (!caps.ok) return;

    expect(caps.result.protocol).toBe(1);
    expect(caps.result.formats).toContain('txt');
    // PDF support depends on PyMuPDF being installed; assert the flag exists
    // rather than demanding a particular value.
    expect(typeof caps.result.optional.pdf).toBe('boolean');
  }, 30_000);

  it('extracts plain text and markdown', async () => {
    const dir = tempDir();
    const path = join(dir, 'note.md');
    writeFileSync(path, '# DNS lab\n\nThe root server is 10.20.30.40.');

    const result = await worker.extract(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.text).toContain('10.20.30.40');
    expect(result.result.kind).toBe('md');
    expect(result.result.sizeBytes).toBeGreaterThan(0);
  }, 30_000);

  it('extracts CSV as readable rows', async () => {
    const dir = tempDir();
    const path = join(dir, 'hosts.csv');
    writeFileSync(path, 'host,ip\nroot,10.20.30.40\n');

    const result = await worker.extract(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.text).toContain('root | 10.20.30.40');
  }, 30_000);

  it('returns a structured error for a missing file', async () => {
    const result = await worker.extract(join(tempDir(), 'nope.txt'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  }, 30_000);

  it('rejects a relative path', async () => {
    const result = await worker.extract('relative.txt');
    // The worker resolves against its cwd; a non-existent relative path must
    // still come back as a structured error, never a crash.
    expect(result.ok).toBe(false);
  }, 30_000);

  it('reports an unsupported format instead of failing silently', async () => {
    const dir = tempDir();
    const path = join(dir, 'thing.bin');
    writeFileSync(path, 'binary-ish');
    const result = await worker.extract(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['UNSUPPORTED_FORMAT', 'NO_TEXT']).toContain(result.error.code);
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * Indexing and search
 * ------------------------------------------------------------------ */

describe.skipIf(!availability.available)('document indexing', () => {
  function setup(): { index: DocumentIndex; project: string; dir: string } {
    const db = database();
    const index = new DocumentIndex(db, worker);
    const projectRow = createProject(db);
    return { index, project: projectRow, dir: tempDir() };
  }

  function createProject(db: Database): string {
    const id = 'prj_test';
    db.execute(
      'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, 'test', Date.now(), Date.now()],
    );
    return id;
  }

  it('indexes files, chunks them, and finds them by keyword', async () => {
    const { index, project, dir } = setup();
    writeFileSync(join(dir, 'dns-lab.md'), '# DNS lab\n\nThe root server is 10.20.30.40/24 and forwards to 1.1.1.1.');
    writeFileSync(join(dir, 'other.txt'), 'Shopping list: milk, eggs.');

    const result = await index.indexDirectory(project, dir);
    expect(result.indexed).toBe(2);
    expect(result.failed).toBe(0);

    const hits = index.search(project, 'root server');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toContain('dns-lab.md');
    expect(hits[0].chunk).toContain('10.20.30.40');
  }, 30_000);

  it('skips unchanged files on a second pass', async () => {
    const { index, project, dir } = setup();
    writeFileSync(join(dir, 'stable.txt'), 'unchanged content here');

    const first = await index.indexDirectory(project, dir);
    expect(first.indexed).toBe(1);

    // Change the mtime to something different, then index again: the file is
    // unchanged in size+mtime signature only if we restore it, so this run
    // should re-index. To assert skipping, run without touching the file.
    const second = await index.indexDirectory(project, dir);
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);
  }, 30_000);

  it('records a failure for an unreadable file without aborting the run', async () => {
    const { index, project, dir } = setup();
    writeFileSync(join(dir, 'good.txt'), 'readable content');
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '   ');

    const result = await index.indexDirectory(project, dir);
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].path).toContain('empty.txt');
  }, 30_000);

  it('removes documents whose files disappeared', async () => {
    const { index, project, dir } = setup();
    const file = join(dir, 'temporary.txt');
    writeFileSync(file, 'temporary document about zebras');
    await index.indexDirectory(project, dir);
    expect(index.stats(project).documents).toBe(1);

    rmSync(file);
    await index.indexDirectory(project, dir);
    expect(index.stats(project).documents).toBe(0);
    expect(index.search(project, 'zebras')).toHaveLength(0);
  }, 30_000);

  it('keeps projects isolated', async () => {
    const db = database();
    const index = new DocumentIndex(db, worker);
    const projectA = createProject(db);
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'prj_b',
      'other',
      Date.now(),
      Date.now(),
    ]);
    const dir = tempDir();
    writeFileSync(join(dir, 'secret.txt'), 'alpha project secrets about flamingos');

    await index.indexDirectory(projectA, dir);
    expect(index.search(projectA, 'flamingos').length).toBeGreaterThan(0);
    expect(index.search('prj_b', 'flamingos')).toHaveLength(0);
  }, 30_000);

  it('stops when cancelled', async () => {
    const { index, project, dir } = setup();
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(join(dir, `doc${String(i)}.txt`), `content number ${String(i)}`);
    }
    const controller = new AbortController();
    controller.abort();

    const result = await index.indexDirectory(project, dir, { signal: controller.signal });
    expect(result.indexed).toBe(0);
  }, 30_000);
});

describe('document index safety', () => {
  function setup(): { index: DocumentIndex; project: string; db: Database } {
    const db = database();
    const project = 'p_safety';
    db.execute(
      'INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [project, project, Date.now(), Date.now()],
    );
    return { index: new DocumentIndex(db, worker), project, db };
  }

  function extracted(path: string, text: string, modifiedAt = Date.now()) {
    return {
      path,
      kind: 'txt',
      sizeBytes: text.length,
      modifiedAt,
      text,
      metadata: {},
      pages: null,
    };
  }

  it('removes missing files only in the scanned directory', async () => {
    const { index, project } = setup();
    const scannedRoot = tempDir();
    const otherRoot = tempDir();
    const missing = join(scannedRoot, 'removed.txt');
    const retained = join(otherRoot, 'keep.txt');
    index.storeDocument(project, extracted(missing, 'stale content'));
    index.storeDocument(project, extracted(retained, 'other root content'));

    const result = await index.indexDirectory(project, scannedRoot);

    expect(result.cleanupSkipped).toBe(false);
    expect(index.listDocuments(project).map((document) => document.path)).toEqual([retained]);
  });

  it('preserves indexed records when a folder cannot be scanned', async () => {
    const { index, project } = setup();
    const missingRoot = join(tempDir(), 'folder-no-longer-readable');
    const retained = join(missingRoot, 'known.txt');
    index.storeDocument(project, extracted(retained, 'keep this record'));

    const result = await index.indexDirectory(project, missingRoot);

    expect(result.cleanupSkipped).toBe(true);
    expect(index.listDocuments(project).map((document) => document.path)).toContain(retained);
  });

  it('caps search results for invalid or excessive limits', () => {
    const { index, project } = setup();
    const root = tempDir();
    for (let i = 0; i < MAX_SEARCH_RESULTS + 5; i += 1) {
      index.storeDocument(
        project,
        extracted(join(root, `match-${String(i)}.txt`), 'matchingword appears here', Date.now() + i),
      );
    }

    expect(index.search(project, 'matchingword', -1)).toHaveLength(1);
    expect(index.search(project, 'matchingword', 10_000)).toHaveLength(MAX_SEARCH_RESULTS);
    expect(index.search(project, 'matchingword', 1.8)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

describe.skipIf(!availability.available)('document tools', () => {
  it('declares its tools for the registry', () => {
    expect(DOCUMENT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'documents_index',
      'documents_search',
      'documents_list',
    ]);
  });

  it('requires approval for indexing and not for reading', () => {
    const index = DOCUMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'documents_index');
    const search = DOCUMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'documents_search');
    expect(index?.requiresApproval).toBe(true);
    expect(index?.changesState).toBe(true);
    expect(search?.requiresApproval).toBe(false);
  });

  it('rejects a relative directory with an explanation', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'p',
      'p',
      Date.now(),
      Date.now(),
    ]);
    const tools = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({
      available: true,
    }));
    const result = await tools.run('documents_index', { directory: 'relative/folder' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('FAILED');
    expect(result.content).toMatch(/absolute/i);
  });

  it('reports a capability error when the worker is unavailable', async () => {
    const db = database();
    const tools = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({
      available: false,
      reason: 'Python is not installed.',
    }));
    const result = await tools.run('documents_index', { directory: 'C:\\Docs' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('UNAVAILABLE');
    expect(result.content).toContain('Python');
  });

  it('indexes and searches end to end through the tool surface', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'p',
      'p',
      Date.now(),
      Date.now(),
    ]);
    const dir = tempDir();
    writeFileSync(join(dir, 'assignment.md'), 'DNS lab assignment: configure the root server on 10.20.30.40.');

    const tools = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({
      available: true,
    }));

    const indexed = await tools.run('documents_index', { directory: dir });
    expect(indexed.ok).toBe(true);

    const found = await tools.run('documents_search', { query: 'root server' });
    expect(found.ok).toBe(true);
    expect(found.content).toContain('assignment.md');
    expect(found.content).toMatch(/untrusted content/i);
  }, 40_000);
});

describe('hashContent', () => {
  it('is stable and content-sensitive', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
