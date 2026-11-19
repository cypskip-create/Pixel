import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_BOARD_OBJECTS,
  boardSvg,
  createBoard,
  validateBoardDocument,
} from '../../shared/drawingBoard';
import type {
  BoardDiagramEdge,
  BoardObject,
  BoardOperation,
  BoardSnapshot,
  PixelBoardDocument,
} from '../../shared/drawingBoard';

const MAX_BOARD_FILE_BYTES = 2_000_000;
const HISTORY_LIMIT = 50;

export type BoardFileFormat = 'pixelboard' | 'svg';

/**
 * Main-process authority for the single active Pixel Board document.
 * Renderer edits and agent tool calls use the same revisioned operations.
 */
export class PixelBoardService {
  private document: PixelBoardDocument;
  private revision = 0;
  private readonly history: PixelBoardDocument[] = [];
  private readonly future: PixelBoardDocument[] = [];
  private readonly listeners = new Set<(snapshot: BoardSnapshot) => void>();
  private loadedFromDisk = false;

  constructor(private readonly draftPath: string) {
    this.document = createBoard();
    this.loadDraft();
  }

  getSnapshot(): BoardSnapshot {
    return this.snapshot();
  }

  subscribe(listener: (snapshot: BoardSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One-time compatibility import. The old localStorage draft is never removed. */
  importLegacyDraft(value: unknown): BoardSnapshot {
    if (this.loadedFromDisk || this.revision !== 0 || hasContent(this.document)) return this.snapshot();
    const document = validateBoardDocument(value);
    if (!document) throw new Error('The recovered local board draft is invalid.');
    this.commit(document);
    return this.snapshot();
  }

  create(title: string, replace = false, expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    const cleanTitle = boundedTitle(title);
    if (hasObjects(this.document) && !replace) {
      throw new Error('The current Board contains unsaved work. Save it or clear it before creating a new Board.');
    }
    this.commit(createBoard(cleanTitle));
    return this.snapshot();
  }

  apply(operations: BoardOperation[], expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
      throw new Error('A Board change must contain between 1 and 100 operations.');
    }
    let candidate: PixelBoardDocument = cloneDocument(this.document);
    for (const operation of operations) candidate = applyOperation(candidate, operation);
    candidate.updatedAt = Date.now();
    const checked = validateBoardDocument(candidate);
    if (!checked) throw new Error('The requested changes would make the Board invalid or exceed its object limits.');
    this.commit(checked);
    return this.snapshot();
  }

  undo(expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    const previous = this.history.at(-1);
    if (!previous) return this.snapshot();
    const nextRevision = this.revision + 1;
    this.persistSnapshot(previous, nextRevision);
    this.history.pop();
    this.future.push(cloneDocument(this.document));
    this.document = cloneDocument(previous);
    this.revision = nextRevision;
    this.publish();
    return this.snapshot();
  }

  redo(expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    const next = this.future.at(-1);
    if (!next) return this.snapshot();
    const nextRevision = this.revision + 1;
    this.persistSnapshot(next, nextRevision);
    this.future.pop();
    this.history.push(cloneDocument(this.document));
    this.document = cloneDocument(next);
    this.revision = nextRevision;
    this.publish();
    return this.snapshot();
  }

  openDocument(value: unknown, replace = false, expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    const document = validateBoardDocument(value);
    if (!document) throw new Error('This file is not a valid Pixel Board document.');
    if (hasContent(this.document) && !replace) {
      throw new Error('The current Board contains work. Save or clear it before opening another document.');
    }
    this.commit(document);
    return this.snapshot();
  }

  openFromFile(filePath: string, replace = false, expectedRevision?: number): BoardSnapshot {
    const path = resolve(filePath);
    if (extname(path).toLowerCase() !== '.pixelboard') throw new Error('Choose a .pixelboard document.');
    const size = statSync(path).size;
    if (size < 1 || size > MAX_BOARD_FILE_BYTES) throw new Error('Board files must be between 1 byte and 2 MB.');
    return this.openDocument(JSON.parse(readFileSync(path, 'utf8')), replace, expectedRevision);
  }

  saveToFile(filePath: string, format: BoardFileFormat, overwrite = false): { path: string; bytes: number; format: BoardFileFormat; verified: true } {
    const path = resolve(filePath);
    const expectedExtension = format === 'pixelboard' ? '.pixelboard' : '.svg';
    if (extname(path).toLowerCase() !== expectedExtension) throw new Error(`Choose a ${expectedExtension} destination.`);
    if (existsSync(path) && !overwrite) throw new Error('That file already exists. Confirm replacement before saving.');
    const content = format === 'pixelboard'
      ? JSON.stringify(this.document, null, 2)
      : boardSvg(this.document);
    if (Buffer.byteLength(content, 'utf8') > MAX_BOARD_FILE_BYTES) throw new Error('The exported Board is larger than the 2 MB safety limit.');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx', mode: 0o600 });

    const saved = readFileSync(path, 'utf8');
    const valid = format === 'pixelboard'
      ? JSON.stringify(validateBoardDocument(JSON.parse(saved))) === JSON.stringify(this.document)
      : saved.startsWith('<svg ') && saved.includes('</svg>');
    if (!valid) throw new Error('Pixel wrote the file but could not verify its contents.');
    return { path, bytes: Buffer.byteLength(saved, 'utf8'), format, verified: true };
  }

  createDiagram(title: string, nodes: string[], edges: BoardDiagramEdge[], expectedRevision?: number): BoardSnapshot {
    this.assertRevision(expectedRevision);
    const cleanTitle = boundedTitle(title);
    if (nodes.length < 2 || nodes.length > 5 || nodes.some((node) => typeof node !== 'string' || !node.trim() || node.length > 64)) {
      throw new Error('A diagram needs 2–5 non-empty node labels of at most 64 characters.');
    }
    if (edges.length > 12 || edges.some((edge) => !Number.isInteger(edge.from) || !Number.isInteger(edge.to) || edge.from < 0 || edge.to < 0 || edge.from >= nodes.length || edge.to >= nodes.length || edge.from === edge.to || (edge.label !== undefined && edge.label.length > 48))) {
      throw new Error('Diagram connectors must reference different existing nodes and contain at most 12 edges.');
    }
    if (this.document.objects.length) throw new Error('The Board already has objects. Save and clear it before making a new auto-laid-out diagram.');

    const object = (kind: BoardObject['kind'], points: BoardObject['points'], text?: string): BoardObject => ({
      id: randomUUID(), kind, points, color: '#4299F5', width: kind === 'text' ? 4 : 2,
      ...(text === undefined ? {} : { text }),
    });
    const nodeWidth = 150;
    const nodeHeight = 78;
    const gap = (BOARD_WIDTH - 2 * 55 - nodes.length * nodeWidth) / Math.max(1, nodes.length - 1);
    const top = Math.min(BOARD_HEIGHT - nodeHeight - 40, 330);
    const objects: BoardObject[] = [object('text', [{ x: 55, y: 92 }], cleanTitle)];
    const centers: Array<{ left: number; right: number; midY: number }> = [];
    nodes.forEach((node, index) => {
      const left = 55 + index * (nodeWidth + gap);
      const right = left + nodeWidth;
      centers.push({ left, right, midY: top + nodeHeight / 2 });
      objects.push(object('rectangle', [{ x: left, y: top }, { x: right, y: top + nodeHeight }]));
      objects.push(object('text', [{ x: left + 9, y: top + 31 }], wrapLabel(node.trim(), 15)));
    });
    for (const edge of edges) {
      const source = centers[edge.from]!;
      const destination = centers[edge.to]!;
      const forward = edge.from < edge.to;
      const start = forward ? source.right : source.left;
      const end = forward ? destination.left : destination.right;
      const y = source.midY;
      objects.push(object('arrow', [{ x: start, y }, { x: end, y }]));
      if (edge.label?.trim()) objects.push(object('text', [{ x: (start + end) / 2 - 25, y: y - 12 }], edge.label.trim()));
    }
    const candidate = validateBoardDocument({
      ...createBoard(cleanTitle), objects, updatedAt: Date.now(),
    });
    if (!candidate) throw new Error('The auto-layout could not create a valid diagram.');
    this.commit(candidate);
    return this.snapshot();
  }

  private assertRevision(expected?: number): void {
    if (expected !== undefined && expected !== this.revision) {
      throw new Error(`The Board changed since it was loaded (expected revision ${expected}, current ${this.revision}). Refresh and retry the edit.`);
    }
  }

  private commit(next: PixelBoardDocument): void {
    const checked = validateBoardDocument(next);
    if (!checked) throw new Error('The Board document failed validation.');
    const nextRevision = this.revision + 1;
    this.persistSnapshot(checked, nextRevision);
    this.history.push(cloneDocument(this.document));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
    this.document = cloneDocument(checked);
    this.revision = nextRevision;
    this.publish();
  }

  private persistSnapshot(document: PixelBoardDocument, revision: number): void {
    mkdirSync(dirname(this.draftPath), { recursive: true });
    const temporary = `${this.draftPath}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, revision, document }), { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(temporary, this.draftPath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* leave the active draft untouched */ }
      throw error;
    }
    this.loadedFromDisk = true;
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* observer failure cannot roll back a committed Board change */ }
    }
  }

  private loadDraft(): void {
    if (!existsSync(this.draftPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.draftPath, 'utf8')) as unknown;
      const envelope = raw && typeof raw === 'object' && 'document' in raw ? raw as { schemaVersion?: unknown; revision?: unknown; document?: unknown } : null;
      const document = validateBoardDocument(envelope?.document ?? raw);
      if (!document) return;
      this.document = document;
      this.revision = envelope?.schemaVersion === 1 && Number.isSafeInteger(envelope.revision) && Number(envelope.revision) >= 0 ? Number(envelope.revision) : 0;
      this.loadedFromDisk = true;
    } catch {
      // Keep a damaged draft untouched so a later recovery or manual inspection can use it.
    }
  }

  private snapshot(): BoardSnapshot {
    return { document: cloneDocument(this.document), revision: this.revision, canUndo: this.history.length > 0, canRedo: this.future.length > 0 };
  }
}

function applyOperation(document: PixelBoardDocument, operation: BoardOperation): PixelBoardDocument {
  if (!operation || typeof operation !== 'object') throw new Error('Invalid Board operation.');
  switch (operation.type) {
    case 'add':
      if (document.objects.length >= MAX_BOARD_OBJECTS) throw new Error('The Board reached its 500-object limit.');
      return { ...document, objects: [...document.objects, operation.object] };
    case 'update': {
      const index = document.objects.findIndex((object) => object.id === operation.id);
      if (index < 0) throw new Error(`Board object ${operation.id} no longer exists.`);
      const objects = [...document.objects];
      objects[index] = { ...objects[index]!, ...operation.patch };
      return { ...document, objects };
    }
    case 'move': {
      if (!Number.isFinite(operation.dx) || !Number.isFinite(operation.dy) || Math.abs(operation.dx) > BOARD_WIDTH || Math.abs(operation.dy) > BOARD_HEIGHT) throw new Error('Invalid Board movement.');
      const index = document.objects.findIndex((object) => object.id === operation.id);
      if (index < 0) throw new Error(`Board object ${operation.id} no longer exists.`);
      const objects = [...document.objects];
      objects[index] = { ...objects[index]!, points: objects[index]!.points.map((point) => ({
        x: clamp(point.x + operation.dx, 0, BOARD_WIDTH), y: clamp(point.y + operation.dy, 0, BOARD_HEIGHT),
      })) };
      return { ...document, objects };
    }
    case 'delete': {
      if (!document.objects.some((object) => object.id === operation.id)) throw new Error(`Board object ${operation.id} no longer exists.`);
      return { ...document, objects: document.objects.filter((object) => object.id !== operation.id) };
    }
    case 'clear':
      return { ...document, objects: [] };
    case 'setTitle':
      return { ...document, title: boundedTitle(operation.title) };
    default:
      throw new Error('Unsupported Board operation.');
  }
}

function boundedTitle(title: string): string {
  if (typeof title !== 'string') throw new Error('Board title must be text.');
  const cleaned = title.trim().slice(0, 120) || 'Untitled board';
  return cleaned;
}

function hasContent(document: PixelBoardDocument): boolean {
  return document.objects.length > 0 || document.title !== 'Untitled board';
}

function hasObjects(document: PixelBoardDocument): boolean {
  return document.objects.length > 0;
}

function cloneDocument(document: PixelBoardDocument): PixelBoardDocument {
  return { ...document, objects: document.objects.map((object) => ({ ...object, points: object.points.map((point) => ({ ...point })) })) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function wrapLabel(value: string, width: number): string {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join('\n');
}
