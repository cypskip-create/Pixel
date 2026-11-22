/**
 * Document indexing and search.
 *
 * Text is extracted by the Python worker, chunked here, and stored in SQLite with
 * FTS5 so retrieval is keyword-based and local. Chunking lives in TypeScript
 * because it is the orchestrator's policy decision (how much of a document may
 * enter a model context), not a parsing concern.
 *
 * Only directories the user adds are ever walked, with hard bounds on depth, file
 * count and file size.
 */

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Database, SqlValue } from '../data/database';
import type { PythonWorker } from '../services/python-worker';
import type { ExtractedDocument } from '../services/python-worker';

export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.xlsx', '.xlsm', '.csv', '.tsv',
  '.txt', '.md', '.markdown', '.json', '.xml', '.yaml', '.yml',
  '.log', '.ini', '.conf', '.html', '.htm', '.rst',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.java', '.go', '.rs', '.sql',
]);

export const CHUNK_SIZE = 1_200;
export const CHUNK_OVERLAP = 150;
export const MAX_FILES_PER_RUN = 500;
export const MAX_WALK_DEPTH = 8;
export const MAX_SEARCH_RESULTS = 20;

export interface Chunk {
  ordinal: number;
  content: string;
  location: string;
}

/**
 * Split text into overlapping chunks on paragraph boundaries where possible.
 *
 * Overlap keeps a sentence that straddles a boundary retrievable, which matters
 * for keyword search. Pure and deterministic.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): Chunk[] {
  const normalised = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (normalised.length === 0) return [];
  if (normalised.length <= size) {
    return [{ ordinal: 0, content: normalised, location: 'whole document' }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let ordinal = 0;

  while (start < normalised.length) {
    let end = Math.min(start + size, normalised.length);

    if (end < normalised.length) {
      // Prefer a paragraph break, then a sentence end, then a word boundary.
      const window = normalised.slice(start, end);
      const paragraph = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
      const space = window.lastIndexOf(' ');

      if (paragraph > size * 0.5) end = start + paragraph + 2;
      else if (sentence > size * 0.5) end = start + sentence + 1;
      else if (space > size * 0.5) end = start + space + 1;
    }

    const content = normalised.slice(start, end).trim();
    if (content.length > 0) {
      chunks.push({ ordinal, content, location: `chars ${String(start)}-${String(end)}` });
      ordinal += 1;
    }

    if (end >= normalised.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Change-detection signature: size plus modification time rounded to milliseconds.
 *
 * Deliberately not a content hash: hashing would mean reading every file on every
 * scan, which is the cost this exists to avoid. This catches same-size edits
 * within a second on filesystems that report sub-second timestamps. As with any
 * metadata signature, an edit that restores both size and mtime is not detected.
 */
export function signatureOf(sizeBytes: number, modifiedAt: number): string {
  return createHash('sha256')
    .update(`${String(sizeBytes)}:${String(Math.floor(modifiedAt))}`)
    .digest('hex')
    .slice(0, 16);
}

export function fileSignatureOf(entry: DirectoryEntry): string {
  return signatureOf(entry.sizeBytes, entry.modifiedAt);
}

export interface DirectoryEntry {
  path: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: number;
}

/**
 * Walk a directory for indexable files.
 *
 * Deterministic order, bounded depth, no symlink traversal, and skip hidden,
 * sensitive-name and node_modules-style trees so a broad selection cannot
 * index unrelated or credential-bearing material.
 */
interface DiscoveryResult {
  entries: DirectoryEntry[];
  /** False when a read error or traversal bound means the listing may be partial. */
  complete: boolean;
}

export function discoverDocuments(
  root: string,
  options: { maxFiles?: number; maxDepth?: number; maxBytes?: number } = {},
): DirectoryEntry[] {
  return discoverDocumentsWithStatus(root, options).entries;
}

function discoverDocumentsWithStatus(
  root: string,
  options: { maxFiles?: number; maxDepth?: number; maxBytes?: number } = {},
): DiscoveryResult {
  const resolvedRoot = resolve(root);
  const maxFiles = options.maxFiles ?? MAX_FILES_PER_RUN;
  const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const skip = new Set(['node_modules', '.git', '.cache', '__pycache__', 'dist', 'build']);

  const results: DirectoryEntry[] = [];
  let complete = true;

  try {
    if (hasSymlinkPathComponent(resolvedRoot) || !lstatSync(resolvedRoot).isDirectory()) {
      return { entries: results, complete: false };
    }
  } catch {
    return { entries: results, complete: false };
  }

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || results.length >= maxFiles) {
      complete = false;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      complete = false;
      return;
    }

    for (const entry of entries.sort()) {
      if (results.length >= maxFiles) {
        complete = false;
        return;
      }
      if (entry.startsWith('.') || isSensitiveDocumentName(entry)) continue;
      const full = join(dir, entry);
      let stats;
      try {
        // lstat is intentional: stat follows a link and could index files
        // outside the directory the user approved.
        stats = lstatSync(full);
      } catch {
        complete = false;
        continue;
      }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        if (skip.has(entry.toLowerCase())) continue;
        walk(full, depth + 1);
      } else if (stats.isFile()) {
        const extension = extname(entry).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
        if (stats.size > maxBytes) continue;
        results.push({
          path: full,
          extension,
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs,
        });
      }
    }
  };

  walk(resolvedRoot, 0);
  return { entries: results, complete };
}

function isSensitiveDocumentName(name: string): boolean {
  const lower = basename(name).toLowerCase();
  return lower === '.env' || (lower.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(lower))
    || /^id_(rsa|dsa|ed25519|ecdsa)(\.pub)?$/.test(lower)
    || /(^|[._-])(credential|credentials|secret|secrets|password|token)([._-]|$)/.test(lower)
    || /\.(pem|p12|pfx|key)$/.test(lower)
    || lower === '.npmrc';
}

/** Refuse a selected root reached through a symbolic link or junction. */
function hasSymlinkPathComponent(path: string): boolean {
  const volumeRoot = parse(path).root;
  let current = volumeRoot;
  for (const component of path.slice(volumeRoot.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

export interface IndexProgress {
  total: number;
  done: number;
  indexed: number;
  skipped: number;
  failed: number;
  currentPath?: string;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  failed: number;
  errors: Array<{ path: string; message: string }>;
  /** Existing entries were retained because the scan was partial or cancelled. */
  cleanupSkipped: boolean;
}

export interface IndexedDocumentPassage {
  ordinal: number;
  content: string;
  location: string | null;
}

export interface IndexedDocumentRead {
  state: 'ready' | 'stale' | 'unavailable';
  documentId: string;
  title: string;
  path: string;
  kind: string;
  indexedAt: number;
  chunkCount: number;
  startChunk: number;
  hasMore: boolean;
  passages: IndexedDocumentPassage[];
}

export class DocumentIndex {
  constructor(
    private readonly db: Database,
    private readonly worker: PythonWorker,
  ) {}

  /**
   * Index a directory: extract, chunk and store. Files whose content hash is
   * unchanged are skipped, so a re-index is cheap.
   */
  async indexDirectory(
    projectId: string,
    directory: string,
    options: {
      onProgress?: (progress: IndexProgress) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<IndexResult> {
    const root = resolve(directory);
    const discovery = discoverDocumentsWithStatus(root);
    const entries = discovery.entries;
    const progress: IndexProgress = {
      total: entries.length,
      done: 0,
      indexed: 0,
      skipped: 0,
      failed: 0,
    };
    const errors: Array<{ path: string; message: string }> = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (options.signal?.aborted) break;
      progress.currentPath = entry.path;
      seen.add(entry.path);

      try {
        const existing = this.db.queryOne<{ content_hash: string }>(
          'SELECT content_hash FROM documents WHERE project_id = ? AND path = ?',
          [projectId, entry.path],
        );

        // Cheap change detection before paying for extraction: the stored
        // signature is size+mtime, so it can be compared without reading the file.
        if (existing) {
          if (String(existing.content_hash) === fileSignatureOf(entry)) {
            progress.skipped += 1;
            progress.done += 1;
            options.onProgress?.({ ...progress });
            continue;
          }
        }

        const extraction = await this.worker.extract(entry.path, options.signal);
        if (!extraction.ok) {
          progress.failed += 1;
          errors.push({ path: entry.path, message: extraction.error.message });
          this.recordFailure(projectId, entry, extraction.error.message);
          progress.done += 1;
          options.onProgress?.({ ...progress });
          continue;
        }

        this.storeDocument(projectId, extraction.result);
        progress.indexed += 1;
      } catch (error) {
        progress.failed += 1;
        errors.push({
          path: entry.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      progress.done += 1;
      options.onProgress?.({ ...progress });
    }

    const cleanupSkipped = !discovery.complete || Boolean(options.signal?.aborted);
    if (!cleanupSkipped) this.removeMissing(projectId, seen, root);
    return {
      indexed: progress.indexed,
      skipped: progress.skipped,
      failed: progress.failed,
      errors,
      cleanupSkipped,
    };
  }

  /** Store one already-extracted document, replacing any previous version. */
  storeDocument(projectId: string, document: ExtractedDocument): void {
    const chunks = chunkText(document.text);
    // The signature drives re-indexing; the text hash identifies the payload.
    const hash = signatureOf(document.sizeBytes, document.modifiedAt);

    this.db.transaction(() => {
      this.db.execute('DELETE FROM documents WHERE project_id = ? AND path = ?', [
        projectId,
        document.path,
      ]);

      const id = `doc_${hashContent(`${document.path}:${String(document.modifiedAt)}`).slice(0, 12)}`;
      this.db.execute(
        `INSERT INTO documents
           (id, project_id, path, kind, title, size_bytes, modified_at, content_hash,
            indexed_at, chunk_count, extractor, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          projectId,
          document.path,
          document.kind,
          titleOf(document.path),
          document.sizeBytes,
          document.modifiedAt,
          hash,
          Date.now(),
          chunks.length,
          document.kind,
        ],
      );

      for (const chunk of chunks) {
        this.db.execute(
          'INSERT INTO document_chunks (document_id, ordinal, content, token_estimate, location) VALUES (?, ?, ?, ?, ?)',
          [
            id,
            chunk.ordinal,
            chunk.content,
            Math.ceil(chunk.content.length / 4),
            chunk.location,
          ],
        );
      }
    });
  }

  /** Remove missing entries only beneath the root that was just scanned. */
  removeMissing(projectId: string, seen: Set<string>, rootDirectory: string): number {
    const root = resolve(rootDirectory);
    const rows = this.db.query<{ id: string; path: string }>(
      'SELECT id, path FROM documents WHERE project_id = ?',
      [projectId],
    );
    let removed = 0;
    for (const row of rows) {
      const path = resolve(String(row.path));
      if (!isPathWithin(root, path) || seen.has(path)) continue;
      this.db.execute('DELETE FROM documents WHERE id = ?', [String(row.id)]);
      removed += 1;
    }
    return removed;
  }

  /** Keyword search across extracted chunks, with source attribution. */
  search(
    projectId: string,
    query: string,
    limit = 8,
  ): Array<{
    documentId: string;
    path: string;
    title: string;
    chunk: string;
    score: number;
    location: string | null;
  }> {
    const match = toMatchQuery(query);
    if (match.length === 0) return [];
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 8;
    const safeLimit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, requestedLimit));

    const params: SqlValue[] = [match, projectId];
    try {
      const rows = this.db.query<{
        document_id: string;
        path: string;
        title: string;
        content: string;
        location: string | null;
        rank: number;
      }>(
        `SELECT c.document_id, d.path, d.title, c.content, c.location, bm25(chunks_fts) AS rank
           FROM chunks_fts
           JOIN document_chunks c ON c.id = chunks_fts.rowid
           JOIN documents d ON d.id = c.document_id
          WHERE chunks_fts MATCH ? AND d.project_id = ?
          ORDER BY rank LIMIT ?`,
        [...params, safeLimit],
      );

      return rows.map((row) => ({
        documentId: String(row.document_id),
        path: String(row.path),
        title: String(row.title),
        chunk: String(row.content),
        score: 1 / (1 + Math.max(0, Number(row.rank))),
        location: row.location === null ? null : String(row.location),
      }));
    } catch {
      return [];
    }
  }

  listDocuments(projectId: string): Array<{
    id: string; path: string; title: string; kind: string; sizeBytes: number;
    modifiedAt: number; indexedAt: number; chunks: number; folderId: string;
    folderName: string; fileName: string;
  }> {
    return this.db
      .query<{ id: string; path: string; title: string; kind: string; size_bytes: number; modified_at: number; indexed_at: number; chunk_count: number }>(
        'SELECT id, path, title, kind, size_bytes, modified_at, indexed_at, chunk_count FROM documents WHERE project_id = ? ORDER BY indexed_at DESC',
        [projectId],
      )
      .map((row) => {
        const path = String(row.path);
        const parent = dirname(path);
        return {
          id: String(row.id),
          path,
          title: String(row.title),
          kind: String(row.kind),
          sizeBytes: Number(row.size_bytes),
          modifiedAt: Number(row.modified_at),
          indexedAt: Number(row.indexed_at),
          chunks: Number(row.chunk_count),
          folderId: hashContent(resolve(parent).toLocaleLowerCase()).slice(0, 16),
          folderName: basename(parent) || 'Documents',
          fileName: basename(path),
        };
      });
  }

  /** Resolve a folder action only from a group represented in this project. */
  resolveFolderPath(projectId: string, folderId: string): string | null {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(folderId)) return null;
    const matches = this.listDocuments(projectId).filter((document) => document.folderId === folderId);
    if (matches.length === 0) return null;
    const folders = new Set(matches.map((document) => resolve(dirname(document.path)).toLocaleLowerCase()));
    if (folders.size !== 1) return null;
    const folder = resolve(dirname(matches[0].path));
    try {
      if (hasSymlinkPathComponent(folder) || !lstatSync(folder).isDirectory()) return null;
      return folder;
    } catch {
      return null;
    }
  }

  /** Read a bounded page from the active project's indexed copy of one document. */
  readDocument(projectId: string, documentId: string, startChunk = 0, limit = 6): IndexedDocumentRead | null {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(documentId)) return null;
    const start = Number.isFinite(startChunk) ? Math.max(0, Math.trunc(startChunk)) : 0;
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 6;
    const safeLimit = Math.min(10, Math.max(1, requestedLimit));
    const row = this.db.queryOne<{
      id: string;
      path: string;
      kind: string;
      title: string;
      size_bytes: number;
      modified_at: number;
      indexed_at: number;
      chunk_count: number;
      error: string | null;
    }>(
      `SELECT id, path, kind, title, size_bytes, modified_at, indexed_at, chunk_count, error
         FROM documents WHERE project_id = ? AND id = ?`,
      [projectId, documentId],
    );
    if (!row || row.error) return null;

    const base = {
      documentId: String(row.id),
      title: String(row.title),
      path: String(row.path),
      kind: String(row.kind),
      indexedAt: Number(row.indexed_at),
      chunkCount: Number(row.chunk_count),
      startChunk: start,
    };
    let state: IndexedDocumentRead['state'] = 'ready';
    try {
      const path = resolve(String(row.path));
      if (hasSymlinkPathComponent(path)) state = 'unavailable';
      else {
        const source = lstatSync(path);
        if (source.isSymbolicLink() || !source.isFile()) state = 'unavailable';
        else if (signatureOf(source.size, source.mtimeMs) !== signatureOf(Number(row.size_bytes), Number(row.modified_at))) state = 'stale';
      }
    } catch {
      state = 'unavailable';
    }

    if (state !== 'ready') {
      return { ...base, state, hasMore: false, passages: [] };
    }
    const rows = this.db.query<{ ordinal: number; content: string; location: string | null }>(
      `SELECT ordinal, content, location FROM document_chunks
        WHERE document_id = ? ORDER BY ordinal LIMIT ? OFFSET ?`,
      [documentId, safeLimit, start],
    );
    return {
      ...base,
      state,
      hasMore: start + rows.length < base.chunkCount,
      passages: rows.map((passage) => ({
        ordinal: Number(passage.ordinal),
        content: String(passage.content),
        location: passage.location === null ? null : String(passage.location),
      })),
    };
  }

  stats(projectId: string): { documents: number; chunks: number; failed: number } {
    const documents = Number(
      this.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE project_id = ?', [
        projectId,
      ])?.n ?? 0,
    );
    const chunks = Number(
      this.db.queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.project_id = ?',
        [projectId],
      )?.n ?? 0,
    );
    const failed = Number(
      this.db.queryOne<{ n: number }>(
        'SELECT COUNT(*) AS n FROM documents WHERE project_id = ? AND error IS NOT NULL',
        [projectId],
      )?.n ?? 0,
    );
    return { documents, chunks, failed };
  }

  private recordFailure(
    projectId: string,
    entry: DirectoryEntry,
    message: string,
  ): void {
    // Failures are recorded rather than thrown: one unreadable file in a folder
    // must not abort the whole index run.
    this.db.execute(
      `INSERT INTO documents
         (id, project_id, path, kind, title, size_bytes, modified_at, content_hash,
          indexed_at, chunk_count, extractor, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)
       ON CONFLICT(project_id, path) DO UPDATE SET error = excluded.error, indexed_at = excluded.indexed_at`,
      [
        `doc_fail_${hashContent(entry.path).slice(0, 10)}`,
        projectId,
        entry.path,
        entry.extension.replace('.', ''),
        titleOf(entry.path),
        entry.sizeBytes,
        entry.modifiedAt,
        'failed',
        Date.now(),
        message,
      ],
    );
  }

}

function isPathWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot.length > 0 &&
    fromRoot !== '..' &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function titleOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
  return name.length > 0 ? name : path;
}

/** FTS5 MATCH expression built from plain words, so punctuation cannot break it. */
export function toMatchQuery(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 8);
  if (words.length === 0) return '';
  return words.map((word) => `"${word}"*`).join(' OR ');
}
