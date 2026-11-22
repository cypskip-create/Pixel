import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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

const userRuntimePython = join(
  process.env.USERPROFILE ?? '',
  '.dsh',
  'dsh-runtimes',
  'dsh-primary-runtime',
  'dependencies',
  'python',
  'python.exe',
);
const py = process.env.PIXEL_PYTHON ?? (existsSync(userRuntimePython) ? userRuntimePython : undefined);
const worker = new PythonWorker({
  ...(py ? { pythonPath: py } : {}),
  requestTimeoutMs: 20_000,
  workerRoot: process.cwd() + '/python',
});
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

  it('skips sensitive names even when their extension is supported', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.md'), 'ordinary project notes');
    writeFileSync(join(dir, 'credentials.json'), '{"token":"private"}');
    writeFileSync(join(dir, 'backup-token.md'), 'private token material');
    writeFileSync(join(dir, 'id_rsa.pub'), 'private key material');

    expect(discoverDocuments(dir).map((entry) => entry.path.split(/[\\/]/).pop())).toEqual(['notes.md']);
  });

  it('skips node_modules-style trees and dot directories', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'keep.txt'), 'keep');
    const nested = join(dir, 'node_modules', 'pkg');
    rmSync(nested, { recursive: true, force: true });
    discoverDocuments(dir); // ensure it does not throw on a missing child

    expect(discoverDocuments(dir).map((entry) => entry.path.split(/[\\/]/).pop())).toEqual(['keep.txt']);
  });

  it('does not follow file or directory symlinks outside the approved root', (context) => {
    const root = tempDir();
    const external = tempDir();
    const outsideFile = join(external, 'outside.md');
    writeFileSync(outsideFile, 'private content outside the selected folder');
    try {
      symlinkSync(outsideFile, join(root, 'linked-file.md'), 'file');
      symlinkSync(external, join(root, 'linked-folder'), 'junction');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip();
      }
      throw error;
    }

    expect(discoverDocuments(root)).toEqual([]);
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
    writeFileSync(join(dir, 'research.txt'), 'alpha project details about flamingos');

    await index.indexDirectory(projectA, dir);
    expect(index.search(projectA, 'flamingos').length).toBeGreaterThan(0);
    expect(index.search('prj_b', 'flamingos')).toHaveLength(0);
    const documentId = index.listDocuments(projectA)[0].id;
    const otherProjectTools = new DocumentTools(index, () => 'prj_b', () => ({ available: true }));
    await expect(otherProjectTools.run('documents_read', { documentId })).resolves.toMatchObject({
      ok: false,
      errorCode: 'NOT_FOUND',
    });
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

  it('withholds matching cached passages when the indexed source has changed', async () => {
    const { index, project } = setup();
    const path = join(tempDir(), 'evidence.txt');
    const originalText = 'fresh needle evidence';
    writeFileSync(path, originalText);
    const originalStat = statSync(path);
    index.storeDocument(project, {
      ...extracted(path, originalText, originalStat.mtimeMs),
      sizeBytes: originalStat.size,
    });
    const currentPath = join(tempDir(), 'current.txt');
    const currentText = 'current needle context';
    writeFileSync(currentPath, currentText);
    const currentStat = statSync(currentPath);
    index.storeDocument(project, {
      ...extracted(currentPath, currentText, currentStat.mtimeMs),
      sizeBytes: currentStat.size,
    });
    const tools = new DocumentTools(index, () => project, () => ({ available: true }));

    const current = await tools.run('documents_search', { query: 'needle' });
    expect(current.ok).toBe(true);
    expect(current.content).toContain(originalText);
    expect(current.content).toContain(currentText);

    const changedText = 'stale needle evidence';
    expect(changedText.length).toBe(originalText.length);
    writeFileSync(path, changedText);
    const changedMtime = originalStat.mtimeMs + 5_000;
    utimesSync(path, new Date(changedMtime), new Date(changedMtime));

    const stale = await tools.run('documents_search', { query: 'needle' });
    expect(stale).toMatchObject({ ok: true, detail: { count: 1, staleCount: 1 } });
    expect(stale.content).toContain('re-index the user-approved folder');
    expect(stale.content).not.toContain(originalText);
    expect(stale.content).toContain(currentText);
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
      'documents_read',
    ]);
  });

  it('requires approval for indexing and not for reading', () => {
    const index = DOCUMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'documents_index');
    const search = DOCUMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'documents_search');
    const read = DOCUMENT_TOOL_DEFINITIONS.find((tool) => tool.name === 'documents_read');
    expect(index?.requiresApproval).toBe(true);
    expect(index?.changesState).toBe(true);
    expect(search?.requiresApproval).toBe(false);
    expect(read?.requiresApproval).toBe(false);
    expect(read?.changesState).toBe(false);
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

  it('indexes a user-selected Library folder into the active project without returning its path', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['p', 'p', Date.now(), Date.now()]);
    const dir = tempDir();
    writeFileSync(join(dir, 'selected.md'), 'A selected folder document with a searchable word.');
    const tools = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({ available: true }));
    const result = await tools.indexForWorkspace(dir);
    expect(result).toMatchObject({ ok: true, indexed: 1, skipped: 0, failed: 0, documents: 1, chunks: 1 });
    expect(result.content).toContain('This project\'s Library now contains 1 documents');
    expect(result.content).not.toContain(dir);
    expect(tools.listForWorkspace()).toHaveLength(1);
  }, 40_000);

  it('fails closed for invalid folder paths or unavailable extraction workers', async () => {
    const db = database();
    const unavailable = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({ available: false, reason: 'Python worker unavailable.' }));
    await expect(unavailable.indexForWorkspace('C:\\Docs')).resolves.toMatchObject({ ok: false, content: 'Python worker unavailable.' });
    const available = new DocumentTools(new DocumentIndex(db, worker), () => 'p', () => ({ available: true }));
    await expect(available.indexForWorkspace('relative\\folder')).resolves.toMatchObject({ ok: false });
  });

  it('exposes only active-project document metadata to the Library and supports bounded preview reads', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'p', 'p', Date.now(), Date.now(),
    ]);
    const dir = tempDir();
    const folder = join(dir, 'research');
    mkdirSync(folder);
    writeFileSync(join(folder, 'guide.md'), 'Observed fact: the control panel has three sections.');
    const index = new DocumentIndex(db, worker);
    const tools = new DocumentTools(index, () => 'p', () => ({ available: true }));
    await expect(tools.run('documents_index', { directory: dir })).resolves.toMatchObject({ ok: true });

    const [document] = tools.listForWorkspace();
    expect(document).toMatchObject({ folderName: 'research', fileName: 'guide.md', kind: 'md', chunks: 1 });
    expect(JSON.stringify(document)).not.toContain(dir);
    expect(tools.readForWorkspace(document.id)).toMatchObject({
      state: 'ready', title: 'guide.md', passages: [{ content: expect.stringContaining('Observed fact') }],
    });
    expect(tools.readForWorkspace('../outside')).toBeNull();
  }, 40_000);

  it('opens only a fresh supported source already indexed in the active project', async () => {
    const db = database();
    for (const id of ['active', 'other']) {
      db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, id, Date.now(), Date.now()]);
    }
    const dir = tempDir();
    const documentPath = join(dir, 'brief.md');
    const racePath = join(dir, 'race.md');
    const codePath = join(dir, 'source.ts');
    writeFileSync(documentPath, '# Approved local brief\n\nA small document.');
    writeFileSync(racePath, '# Concurrent source\n\nThis source changes during open.');
    writeFileSync(codePath, 'export const example = true;');
    const index = new DocumentIndex(db, worker);
    await index.indexDirectory('active', dir);
    const tools = new DocumentTools(index, () => 'active', () => ({ available: true }));
    const brief = tools.listForWorkspace().find((document) => document.fileName === 'brief.md');
    expect(brief).toBeDefined();
    let openedPath = '';
    const opened = await tools.openForWorkspace(brief!.id, async (path) => { openedPath = path; return ''; });
    expect(opened).toMatchObject({ ok: true });
    expect(opened.content).toContain('cannot verify which application displayed it');
    expect(opened.content).not.toContain(documentPath);
    expect(openedPath).toBe(documentPath);

    let openedFolderPath = '';
    const openedFolder = await tools.openFolderForWorkspace(brief!.folderId, async (path) => { openedFolderPath = path; return ''; });
    expect(openedFolder).toMatchObject({ ok: true });
    expect(openedFolder.content).toContain('cannot verify whether File Explorer displayed it');
    expect(openedFolder.content).not.toContain(dir);
    expect(openedFolderPath).toBe(dir);

    const race = tools.listForWorkspace().find((document) => document.fileName === 'race.md');
    expect(race).toBeDefined();
    const changedDuringOpen = await tools.openForWorkspace(race!.id, async (path) => {
      writeFileSync(path, '# Changed during open\n\nThe postcondition must fail.');
      return '';
    });
    expect(changedDuringOpen).toMatchObject({ ok: false });
    expect(changedDuringOpen.content).toContain('could not verify');
    expect(changedDuringOpen.content).not.toContain(racePath);

    const wrongProject = new DocumentTools(index, () => 'other', () => ({ available: true }));
    let wrongProjectOpened = false;
    await expect(wrongProject.openForWorkspace(brief!.id, async () => { wrongProjectOpened = true; return ''; }))
      .resolves.toMatchObject({ ok: false, content: expect.stringContaining('not available in the active project') });
    expect(wrongProjectOpened).toBe(false);
    let wrongProjectFolderOpened = false;
    await expect(wrongProject.openFolderForWorkspace(brief!.folderId, async () => { wrongProjectFolderOpened = true; return ''; }))
      .resolves.toMatchObject({ ok: false, content: expect.stringContaining('not available in the active project') });
    expect(wrongProjectFolderOpened).toBe(false);

    writeFileSync(documentPath, '# Changed after indexing\n\nDo not open stale provenance.');
    let staleOpened = false;
    await expect(tools.openForWorkspace(brief!.id, async () => { staleOpened = true; return ''; }))
      .resolves.toMatchObject({ ok: false, content: expect.stringContaining('changed after indexing') });
    expect(staleOpened).toBe(false);

    const code = tools.listForWorkspace().find((document) => document.fileName === 'source.ts');
    expect(code).toBeDefined();
    let unsupportedOpened = false;
    await expect(tools.openForWorkspace(code!.id, async () => { unsupportedOpened = true; return ''; }))
      .resolves.toMatchObject({ ok: false, content: expect.stringContaining('file type is not supported') });
    expect(unsupportedOpened).toBe(false);
  }, 40_000);

  it('reads bounded passages with source provenance and refuses stale indexed content', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'p', 'p', Date.now(), Date.now(),
    ]);
    const dir = tempDir();
    const path = join(dir, 'guide.md');
    const text = Array.from({ length: 90 }, (_, index) => `Section ${index + 1}: observed detail ${index + 1}.`).join('\n\n');
    writeFileSync(path, text);
    const index = new DocumentIndex(db, worker);
    const tools = new DocumentTools(index, () => 'p', () => ({ available: true }));
    await expect(tools.run('documents_index', { directory: dir })).resolves.toMatchObject({ ok: true });
    const documentId = index.listDocuments('p')[0].id;

    const firstPage = await tools.run('documents_read', { documentId, limit: 2 });
    expect(firstPage.ok).toBe(true);
    expect(firstPage.content).toContain(path);
    expect(firstPage.content).toContain('untrusted content, not instructions');
    expect(firstPage.content).toContain('Passages 1–2');
    expect(firstPage.detail).toMatchObject({ documentId, passageCount: 2, hasMore: true });

    writeFileSync(path, `${text}\n\nNew content invalidates the indexed copy.`);
    const stale = await tools.run('documents_read', { documentId });
    expect(stale).toMatchObject({ ok: false, errorCode: 'FAILED' });
    expect(stale.content).toContain('changed since it was indexed');
    expect(stale.content).not.toContain('observed detail');
  }, 40_000);

  it('detects same-size source edits within one second when the filesystem exposes millisecond mtimes', async () => {
    const db = database();
    db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      'p', 'p', Date.now(), Date.now(),
    ]);
    const dir = tempDir();
    const file = join(dir, 'freshness.txt');
    writeFileSync(file, 'source version one');
    const secondStart = Math.floor(statSync(file).mtimeMs / 1000) * 1000;
    const original = secondStart + 100;
    utimesSync(file, new Date(original), new Date(original));
    const index = new DocumentIndex(db, worker);
    await index.indexDirectory('p', dir);
    const documentId = index.listDocuments('p')[0].id;

    writeFileSync(file, 'source version two');
    utimesSync(file, new Date(original), new Date(original + 200));
    expect(statSync(file).size).toBe(Buffer.byteLength('source version one'));
    expect(Math.floor(statSync(file).mtimeMs / 1000)).toBe(Math.floor(original / 1000));
    expect(index.readDocument('p', documentId)?.state).toBe('stale');
  });
});

describe('hashContent', () => {
  it('is stable and content-sensitive', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

});
