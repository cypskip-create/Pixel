export type BoardTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'connector'
  | 'rectangle'
  | 'circle'
  | 'text'
  | 'marker'
  | 'eraser';
export type BoardObjectKind = Exclude<BoardTool, 'select' | 'eraser'>;

export interface BoardPoint { x: number; y: number }
export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface BoardObject {
  id: string;
  kind: BoardObjectKind;
  points: BoardPoint[];
  text?: string;
  step?: number;
  color: string;
  width: number;
  /** Optional linked source object ID for connector objects. */
  fromId?: string;
  /** Optional linked target object ID for connector objects. */
  toId?: string;
  /** Whether a connector renders an arrowhead (default true). */
  arrowHead?: boolean;
}

export interface PixelBoardDocument {
  format: 'pixel-board';
  version: 1;
  title: string;
  updatedAt: number;
  objects: BoardObject[];
}

export type BoardOperation =
  | { type: 'add'; object: BoardObject }
  | { type: 'update'; id: string; patch: Partial<Pick<BoardObject, 'text' | 'color' | 'width' | 'step' | 'fromId' | 'toId' | 'arrowHead'>> }
  | { type: 'move'; id: string; dx: number; dy: number }
  | { type: 'delete'; id: string }
  | { type: 'clear' }
  | { type: 'setTitle'; title: string };

export interface BoardSnapshot {
  document: PixelBoardDocument;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
}

export interface BoardDiagramEdge {
  from: number;
  to: number;
  label?: string;
}

export type BoardAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'distribute-x' | 'distribute-y';

export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 650;
export const BOARD_GRID_SIZE = 20;
export const MAX_BOARD_OBJECTS = 500;
export const BOARD_DRAFT_KEY = 'pixel.workspace.board-draft.v1';

export function createBoard(title = 'Untitled board'): PixelBoardDocument {
  return { format: 'pixel-board', version: 1, title, updatedAt: Date.now(), objects: [] };
}

export function snapPointToGrid(point: BoardPoint, gridSize = BOARD_GRID_SIZE): BoardPoint {
  const step = Math.max(1, gridSize);
  return {
    x: Math.max(0, Math.min(BOARD_WIDTH, Math.round(point.x / step) * step)),
    y: Math.max(0, Math.min(BOARD_HEIGHT, Math.round(point.y / step) * step)),
  };
}

export function getObjectBounds(object: BoardObject): BoardBounds {
  const xs = object.points.map((p) => p.x);
  const ys = object.points.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  if (object.kind === 'marker') {
    minX -= 16;
    maxX += 16;
    minY -= 16;
    maxY += 16;
  } else if (object.kind === 'text') {
    const fontSize = Math.max(18, object.width * 5);
    const lines = (object.text ?? '').split(/\r?\n/);
    const longest = Math.max(1, ...lines.map((l) => l.length));
    maxX = Math.min(BOARD_WIDTH, minX + Math.max(40, longest * fontSize * 0.55));
    minY = Math.max(0, minY - fontSize * 0.85);
    maxY = Math.min(BOARD_HEIGHT, minY + Math.max(fontSize, lines.length * fontSize * 1.25));
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
}

export function objectIntersectsRect(
  object: BoardObject,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const b = getObjectBounds(object);
  return b.maxX >= rect.minX && b.minX <= rect.maxX && b.maxY >= rect.minY && b.minY <= rect.maxY;
}

/**
 * Resolves live connector endpoints from linked `fromId` / `toId` objects when
 * both exist, falling back to stored points otherwise.
 */
export function resolveConnectorPoints(
  connector: BoardObject,
  objects: readonly BoardObject[],
): [BoardPoint, BoardPoint] {
  const first = connector.points[0] ?? { x: 0, y: 0 };
  const last = connector.points.at(-1) ?? first;
  if (connector.kind !== 'connector') return [first, last];

  const fromObj = connector.fromId ? objects.find((o) => o.id === connector.fromId) : undefined;
  const toObj = connector.toId ? objects.find((o) => o.id === connector.toId) : undefined;
  if (!fromObj && !toObj) return [first, last];

  const fromBounds = fromObj ? getObjectBounds(fromObj) : null;
  const toBounds = toObj ? getObjectBounds(toObj) : null;

  const startCenter = fromBounds ? { x: fromBounds.cx, y: fromBounds.cy } : first;
  const endCenter = toBounds ? { x: toBounds.cx, y: toBounds.cy } : last;

  const start = fromBounds ? anchorOnBoundsEdge(fromBounds, endCenter) : startCenter;
  const end = toBounds ? anchorOnBoundsEdge(toBounds, startCenter) : endCenter;
  return [start, end];
}

function anchorOnBoundsEdge(bounds: BoardBounds, toward: BoardPoint): BoardPoint {
  const dx = toward.x - bounds.cx;
  const dy = toward.y - bounds.cy;
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) {
    return { x: bounds.cx, y: bounds.cy };
  }
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;
  const scaleX = Math.abs(dx) > 1e-3 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = Math.abs(dy) > 1e-3 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  return {
    x: Math.max(0, Math.min(BOARD_WIDTH, Math.round((bounds.cx + dx * scale) * 10) / 10)),
    y: Math.max(0, Math.min(BOARD_HEIGHT, Math.round((bounds.cy + dy * scale) * 10) / 10)),
  };
}

/**
 * Computes atomic `move` operations to align or distribute 2+ selected objects
 * through the trusted main-process `PixelBoardService`.
 */
export function buildAlignmentOperations(
  objects: readonly BoardObject[],
  selectedIds: readonly string[],
  alignment: BoardAlignment,
): BoardOperation[] {
  const idSet = new Set(selectedIds);
  const targets = objects.filter((o) => idSet.has(o.id) && o.kind !== 'connector');
  if (targets.length < 2) return [];

  const entries = targets.map((object) => ({ object, bounds: getObjectBounds(object) }));
  const ops: BoardOperation[] = [];

  if (alignment === 'left') {
    const targetX = Math.min(...entries.map((e) => e.bounds.minX));
    for (const e of entries) {
      const dx = targetX - e.bounds.minX;
      if (Math.abs(dx) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx, dy: 0 });
    }
  } else if (alignment === 'right') {
    const targetX = Math.max(...entries.map((e) => e.bounds.maxX));
    for (const e of entries) {
      const dx = targetX - e.bounds.maxX;
      if (Math.abs(dx) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx, dy: 0 });
    }
  } else if (alignment === 'center-x') {
    const minX = Math.min(...entries.map((e) => e.bounds.minX));
    const maxX = Math.max(...entries.map((e) => e.bounds.maxX));
    const center = (minX + maxX) / 2;
    for (const e of entries) {
      const dx = center - e.bounds.cx;
      if (Math.abs(dx) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx, dy: 0 });
    }
  } else if (alignment === 'top') {
    const targetY = Math.min(...entries.map((e) => e.bounds.minY));
    for (const e of entries) {
      const dy = targetY - e.bounds.minY;
      if (Math.abs(dy) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx: 0, dy });
    }
  } else if (alignment === 'bottom') {
    const targetY = Math.max(...entries.map((e) => e.bounds.maxY));
    for (const e of entries) {
      const dy = targetY - e.bounds.maxY;
      if (Math.abs(dy) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx: 0, dy });
    }
  } else if (alignment === 'center-y') {
    const minY = Math.min(...entries.map((e) => e.bounds.minY));
    const maxY = Math.max(...entries.map((e) => e.bounds.maxY));
    const center = (minY + maxY) / 2;
    for (const e of entries) {
      const dy = center - e.bounds.cy;
      if (Math.abs(dy) >= 0.5) ops.push({ type: 'move', id: e.object.id, dx: 0, dy });
    }
  } else if (alignment === 'distribute-x' && entries.length >= 3) {
    const sorted = [...entries].sort((a, b) => a.bounds.cx - b.bounds.cx);
    const first = sorted[0]!.bounds.cx;
    const last = sorted[sorted.length - 1]!.bounds.cx;
    const step = (last - first) / (sorted.length - 1);
    for (let i = 1; i < sorted.length - 1; i += 1) {
      const targetCx = first + step * i;
      const dx = targetCx - sorted[i]!.bounds.cx;
      if (Math.abs(dx) >= 0.5) ops.push({ type: 'move', id: sorted[i]!.object.id, dx, dy: 0 });
    }
  } else if (alignment === 'distribute-y' && entries.length >= 3) {
    const sorted = [...entries].sort((a, b) => a.bounds.cy - b.bounds.cy);
    const first = sorted[0]!.bounds.cy;
    const last = sorted[sorted.length - 1]!.bounds.cy;
    const step = (last - first) / (sorted.length - 1);
    for (let i = 1; i < sorted.length - 1; i += 1) {
      const targetCy = first + step * i;
      const dy = targetCy - sorted[i]!.bounds.cy;
      if (Math.abs(dy) >= 0.5) ops.push({ type: 'move', id: sorted[i]!.object.id, dx: 0, dy });
    }
  }

  return ops;
}

/** Wrap Board text to a bounded logical width while retaining explicit paragraphs. */
export function wrapBoardText(value: string, maxChars = 72, maxLines = 32): string {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, '').split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) throw new Error(`Board text is too long to lay out in ${maxLines} visible lines.`);
  }
  if (lines.length > maxLines) throw new Error(`Board text is too long to lay out in ${maxLines} visible lines.`);
  return lines.join('\n');
}

export function validateBoardDocument(value: unknown): PixelBoardDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PixelBoardDocument>;
  if (candidate.format !== 'pixel-board' || candidate.version !== 1 ||
      typeof candidate.title !== 'string' || candidate.title.length > 120 ||
      !Array.isArray(candidate.objects) || candidate.objects.length > MAX_BOARD_OBJECTS) return null;
  const objects: BoardObject[] = [];
  const ids = new Set<string>();
  const allowedKinds = new Set(['pen', 'highlighter', 'line', 'arrow', 'connector', 'rectangle', 'circle', 'text', 'marker']);
  for (const raw of candidate.objects) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Partial<BoardObject>;
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100 || ids.has(item.id) ||
        !allowedKinds.has(item.kind ?? '') ||
        !Array.isArray(item.points) || item.points.length < 1 || item.points.length > 4_000 ||
        typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color) ||
        typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width < 1 || item.width > 32 ||
        (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > 2_000)) ||
        (item.step !== undefined && (!Number.isInteger(item.step) || item.step < 1 || item.step > 99)) ||
        (item.fromId !== undefined && (typeof item.fromId !== 'string' || item.fromId.length > 100)) ||
        (item.toId !== undefined && (typeof item.toId !== 'string' || item.toId.length > 100)) ||
        (item.arrowHead !== undefined && typeof item.arrowHead !== 'boolean')) return null;
    const points: BoardPoint[] = [];
    ids.add(item.id);
    for (const point of item.points) {
      if (!point || typeof point !== 'object' || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < 0 || point.x > BOARD_WIDTH || point.y < 0 || point.y > BOARD_HEIGHT) return null;
      points.push({ x: point.x, y: point.y });
    }
    objects.push({
      id: item.id,
      kind: item.kind as BoardObjectKind,
      points,
      color: item.color,
      width: item.width,
      ...(item.text ? { text: item.text } : {}),
      ...(item.step ? { step: item.step } : {}),
      ...(item.fromId ? { fromId: item.fromId } : {}),
      ...(item.toId ? { toId: item.toId } : {}),
      ...(item.arrowHead !== undefined ? { arrowHead: item.arrowHead } : {}),
    });
  }
  return {
    format: 'pixel-board', version: 1,
    title: candidate.title.trim() || 'Untitled board',
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    objects,
  };
}

function arrowHeadPath(from: BoardPoint, to: BoardPoint, size = 10): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 6;
  const x1 = Math.round((to.x - size * Math.cos(angle - spread)) * 10) / 10;
  const y1 = Math.round((to.y - size * Math.sin(angle - spread)) * 10) / 10;
  const x2 = Math.round((to.x - size * Math.cos(angle + spread)) * 10) / 10;
  const y2 = Math.round((to.y - size * Math.sin(angle + spread)) * 10) / 10;
  return `M ${x1} ${y1} L ${to.x} ${to.y} L ${x2} ${y2}`;
}

export function boardSvg(document: PixelBoardDocument): string {
  const shapes = document.objects.map((object) => {
    const first = object.points[0];
    if (!first) return '';
    const common = `fill="none" stroke="${object.color}" stroke-width="${object.width}" stroke-linecap="round" stroke-linejoin="round"`;
    if (object.kind === 'text') {
      const lines = (object.text ?? '').split(/\r?\n/).slice(0, 32);
      return `<text x="${first.x}" y="${first.y}" fill="${object.color}" font-family="Segoe UI, sans-serif" font-size="${Math.max(18, object.width * 5)}">${lines.map((line, index) => `<tspan x="${first.x}" dy="${index === 0 ? 0 : Math.max(18, object.width * 5) * 1.25}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    }
    if (object.kind === 'marker') return `<circle cx="${first.x}" cy="${first.y}" r="16" fill="#202020" stroke="${object.color}" stroke-width="${object.width}"/><text x="${first.x}" y="${first.y + 5}" fill="${object.color}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="14" font-weight="700">${object.step ?? 1}</text>`;
    if (object.kind === 'pen' || object.kind === 'highlighter') {
      const path = object.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      const opacity = object.kind === 'highlighter' ? ' opacity="0.34"' : '';
      return `<path d="${path}" ${common}${opacity}/>`;
    }
    if (object.kind === 'connector') {
      const [start, end] = resolveConnectorPoints(object, document.objects);
      const head = object.arrowHead === false ? '' : ` ${arrowHeadPath(start, end, Math.max(8, object.width * 3))}`;
      return `<path d="M ${start.x} ${start.y} L ${end.x} ${end.y}${head}" ${common}/>`;
    }
    const last = object.points.at(-1) ?? first;
    const x = Math.min(first.x, last.x); const y = Math.min(first.y, last.y);
    const width = Math.max(1, Math.abs(last.x - first.x)); const height = Math.max(1, Math.abs(last.y - first.y));
    if (object.kind === 'line') return `<path d="M ${first.x} ${first.y} L ${last.x} ${last.y}" ${common}/>`;
    if (object.kind === 'arrow') return `<path d="M ${first.x} ${first.y} L ${last.x} ${last.y} ${arrowHeadPath(first, last, Math.max(8, object.width * 3))}" ${common}/>`;
    if (object.kind === 'rectangle') return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${common}/>`;
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${common}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}"><rect width="100%" height="100%" fill="#171717"/>${shapes}</svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
}
