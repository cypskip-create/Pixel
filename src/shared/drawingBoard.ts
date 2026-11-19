export type BoardTool = 'select' | 'pen' | 'highlighter' | 'line' | 'arrow' | 'rectangle' | 'circle' | 'text' | 'marker' | 'eraser';
export type BoardObjectKind = Exclude<BoardTool, 'select' | 'eraser'>;

export interface BoardPoint { x: number; y: number }
export interface BoardObject {
  id: string;
  kind: BoardObjectKind;
  points: BoardPoint[];
  text?: string;
  step?: number;
  color: string;
  width: number;
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
  | { type: 'update'; id: string; patch: Partial<Pick<BoardObject, 'text' | 'color' | 'width' | 'step'>> }
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

export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 650;
export const MAX_BOARD_OBJECTS = 500;
export const BOARD_DRAFT_KEY = 'pixel.workspace.board-draft.v1';

export function createBoard(title = 'Untitled board'): PixelBoardDocument {
  return { format: 'pixel-board', version: 1, title, updatedAt: Date.now(), objects: [] };
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
  for (const raw of candidate.objects) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Partial<BoardObject>;
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100 || ids.has(item.id) ||
        !['pen', 'highlighter', 'line', 'arrow', 'rectangle', 'circle', 'text', 'marker'].includes(item.kind ?? '') ||
        !Array.isArray(item.points) || item.points.length < 1 || item.points.length > 4_000 ||
        typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color) ||
        typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width < 1 || item.width > 32 ||
        (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > 2_000)) ||
        (item.step !== undefined && (!Number.isInteger(item.step) || item.step < 1 || item.step > 99))) return null;
    const points: BoardPoint[] = [];
    ids.add(item.id);
    for (const point of item.points) {
      if (!point || typeof point !== 'object' || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < 0 || point.x > BOARD_WIDTH || point.y < 0 || point.y > BOARD_HEIGHT) return null;
      points.push({ x: point.x, y: point.y });
    }
    objects.push({ id: item.id, kind: item.kind as BoardObjectKind, points, color: item.color, width: item.width, ...(item.text ? { text: item.text } : {}), ...(item.step ? { step: item.step } : {}) });
  }
  return {
    format: 'pixel-board', version: 1,
    title: candidate.title.trim() || 'Untitled board',
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    objects,
  };
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
    const last = object.points.at(-1) ?? first;
    const x = Math.min(first.x, last.x); const y = Math.min(first.y, last.y);
    const width = Math.max(1, Math.abs(last.x - first.x)); const height = Math.max(1, Math.abs(last.y - first.y));
    if (object.kind === 'line') return `<path d="M ${first.x} ${first.y} L ${last.x} ${last.y}" ${common}/>`;
    if (object.kind === 'arrow') return `<path d="M ${first.x} ${first.y} L ${last.x} ${last.y} M ${last.x} ${last.y} l -8 -4 M ${last.x} ${last.y} l -4 8" ${common}/>`;
    if (object.kind === 'rectangle') return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${common}/>`;
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${common}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}"><rect width="100%" height="100%" fill="#171717"/>${shapes}</svg>`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char);
}
