import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eraser, FilePlus2, FileUp, Hand, Highlighter, ListOrdered, MousePointer2, Redo2, Save, Undo2, X } from 'lucide-react';
import {
  BOARD_DRAFT_KEY, BOARD_HEIGHT, BOARD_WIDTH, boardSvg, createBoard,
  validateBoardDocument, type BoardObject, type BoardPoint, type BoardTool, type PixelBoardDocument,
} from '@shared/drawingBoard';

const TOOL_ITEMS: Array<{ id: BoardTool; label: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'pen', label: 'Pen', icon: Hand },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { id: 'line', label: 'Line', icon: Hand },
  { id: 'arrow', label: 'Arrow', icon: Hand },
  { id: 'rectangle', label: 'Rectangle', icon: Hand },
  { id: 'circle', label: 'Circle', icon: Hand },
  { id: 'text', label: 'Text', icon: Hand },
  { id: 'marker', label: 'Step marker', icon: ListOrdered },
  { id: 'eraser', label: 'Erase', icon: Eraser },
];

function loadDraft(): PixelBoardDocument {
  try {
    const raw = localStorage.getItem(BOARD_DRAFT_KEY);
    const parsed = raw ? validateBoardDocument(JSON.parse(raw)) : null;
    if (parsed) return parsed;
  } catch { /* A damaged or unavailable draft starts with a clean board. */ }
  return createBoard();
}

function safeName(title: string): string {
  return (title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'pixel-board');
}

function hasBoardContent(document: PixelBoardDocument): boolean {
  return document.objects.length > 0 || document.title.trim() !== 'Untitled board';
}

export function PixelBoard({ emergencyStopped = false }: { emergencyStopped?: boolean }): React.JSX.Element {
  const [document, setDocument] = useState<PixelBoardDocument>(loadDraft);
  const [tool, setTool] = useState<BoardTool>('pen');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('Draft saves locally in this Pixel profile.');
  const [history, setHistory] = useState<PixelBoardDocument[]>([]);
  const [future, setFuture] = useState<PixelBoardDocument[]>([]);
  const [previewObject, setPreviewObject] = useState<BoardObject | null>(null);
  const [color, setColor] = useState('#4299F5');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [drawing, setDrawing] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const currentObject = useRef<BoardObject | null>(null);
  const movingObject = useRef<{ id: string; start: BoardPoint; original: BoardObject } | null>(null);
  const svg = useMemo(() => boardSvg(document), [document]);

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_DRAFT_KEY, JSON.stringify({ ...document, updatedAt: Date.now() }));
      setNotice('Draft saved locally. Use Save to export an editable .pixelboard file.');
    } catch {
      setNotice('Local draft storage is unavailable. Export your board to keep it.');
    }
  }, [document]);

  const commit = (nextObjects: BoardObject[]): void => {
    setHistory((items) => [...items.slice(-39), document]);
    setFuture([]);
    setDocument((current) => ({ ...current, objects: nextObjects, updatedAt: Date.now() }));
  };

  const pointAt = (event: React.PointerEvent<SVGSVGElement>): BoardPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(BOARD_WIDTH, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * BOARD_WIDTH)),
      y: Math.max(0, Math.min(BOARD_HEIGHT, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * BOARD_HEIGHT)),
    };
  };

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (emergencyStopped) return;
    const point = pointAt(event);
    if (tool === 'select') {
      const target = (event.target as Element).closest('[data-board-object]');
      const id = target?.getAttribute('data-board-object') ?? null;
      setSelected(id);
      const original = document.objects.find((item) => item.id === id);
      if (id && original) {
        event.currentTarget.setPointerCapture(event.pointerId);
        movingObject.current = { id, start: point, original };
      }
      return;
    }
    if (tool === 'eraser') {
      const target = (event.target as Element).closest('[data-board-object]');
      const id = target?.getAttribute('data-board-object');
      if (id) commit(document.objects.filter((item) => item.id !== id));
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text to place on the board:', '');
      if (!text?.trim()) return;
      commit([...document.objects, { id: crypto.randomUUID(), kind: 'text', points: [point], text: text.trim().slice(0, 2_000), color, width: strokeWidth }]);
      setTool('select');
      return;
    }
    if (tool === 'marker') {
      const step = document.objects.filter((item) => item.kind === 'marker').length + 1;
      if (step > 99) { setNotice('This board reached its 99-step-marker limit.'); return; }
      commit([...document.objects, { id: crypto.randomUUID(), kind: 'marker', points: [point], step, color, width: strokeWidth }]);
      setTool('select');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    currentObject.current = { id: crypto.randomUUID(), kind: tool, points: [point], color, width: strokeWidth };
    setDrawing(true);
  };

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const moving = movingObject.current;
    if (moving) {
      const point = pointAt(event);
      const dx = point.x - moving.start.x;
      const dy = point.y - moving.start.y;
      const moved = { ...moving.original, points: moving.original.points.map((item) => ({
        x: Math.max(0, Math.min(BOARD_WIDTH, item.x + dx)),
        y: Math.max(0, Math.min(BOARD_HEIGHT, item.y + dy)),
      })) };
      setPreviewObject(moved);
      return;
    }
    const current = currentObject.current;
    if (!drawing || !current) return;
    const point = pointAt(event);
    current.points = current.kind === 'pen' || current.kind === 'highlighter'
      ? current.points.length < 4_000 ? [...current.points, point] : [...current.points.slice(0, 3_999), point]
      : [current.points[0] ?? point, point];
    setPreviewObject({ ...current, points: current.points });
  };

  const pointerUp = (): void => {
    const moving = movingObject.current;
    if (moving) {
      movingObject.current = null;
      const moved = previewObject;
      setPreviewObject(null);
      if (moved) commit(document.objects.map((item) => item.id === moving.id ? moved : item));
      return;
    }
    const current = currentObject.current;
    if (!current) return;
    currentObject.current = null;
    setPreviewObject(null);
    setDrawing(false);
    if (document.objects.length >= 500) { setNotice('This board reached its 500-object limit.'); return; }
    commit([...document.objects, current]);
  };

  const undo = (): void => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [...items, document]);
    setHistory((items) => items.slice(0, -1));
    setDocument(previous);
    setSelected(null);
  };
  const redo = (): void => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((items) => [...items, document]);
    setFuture((items) => items.slice(0, -1));
    setDocument(next);
    setSelected(null);
  };
  const removeSelected = (): void => {
    if (!selected) return;
    commit(document.objects.filter((item) => item.id !== selected));
    setSelected(null);
  };
  const editSelectedText = (): void => {
    const item = document.objects.find((candidate) => candidate.id === selected && candidate.kind === 'text');
    if (!item) return;
    const text = window.prompt('Edit board text:', item.text ?? '');
    if (text === null) return;
    commit(document.objects.map((candidate) => candidate.id === item.id ? { ...candidate, text: text.slice(0, 2_000) } : candidate));
  };

  const download = (name: string, data: Blob): void => {
    const url = URL.createObjectURL(data);
    const link = window.document.createElement('a');
    link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  const saveBoard = (): void => download(`${safeName(document.title)}.pixelboard`, new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  const exportSvg = (): void => download(`${safeName(document.title)}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
  const exportPng = async (): Promise<void> => {
    const image = new Image();
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.src = encoded;
    try {
      await image.decode();
      const canvas = window.document.createElement('canvas');
      canvas.width = BOARD_WIDTH; canvas.height = BOARD_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas export is unavailable.');
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => blob ? download(`${safeName(document.title)}.png`, blob) : setNotice('Pixel could not export a PNG.'), 'image/png');
    } catch { setNotice('Pixel could not export a PNG image.'); }
  };
  const openBoard = async (file?: File): Promise<void> => {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Board files are limited to 2 MB.');
      const loaded = validateBoardDocument(JSON.parse(await file.text()));
      if (!loaded) throw new Error('This file is not a valid Pixel board.');
      if (hasBoardContent(document) && !window.confirm('Replace the current board and local draft? Export it first if you want to keep a separate copy.')) return;
      setHistory((items) => [...items.slice(-39), document]); setFuture([]); setDocument(loaded); setSelected(null);
      setNotice(`Opened ${loaded.title}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Pixel could not open that board.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const newBoard = (): void => {
    if (hasBoardContent(document) && !window.confirm('Replace the current board and local draft? Export it first if you want to keep a separate copy.')) return;
    setHistory((items) => [...items.slice(-39), document]); setFuture([]); setDocument(createBoard()); setSelected(null);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected) { event.preventDefault(); removeSelected(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [document, future, history, selected]);

  return (
    <section className="workspace-page pixel-board-page" aria-label="Pixel board">
      <header className="workspace-page-heading"><div><h1>Pixel Board</h1><p>Make an editable note or diagram. This board is inside Pixel and does not draw over other Windows apps.</p></div><input aria-label="Board title" value={document.title} maxLength={120} onChange={(event) => setDocument((current) => ({ ...current, title: event.target.value }))} /></header>
      {emergencyStopped ? <p className="pixel-board-stop" role="alert">Emergency stop is active. Drawing is paused until it is cleared.</p> : null}
      <div className="pixel-board-toolbar" role="toolbar" aria-label="Board tools">
        {TOOL_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={tool === id} title={label} disabled={emergencyStopped} onClick={() => setTool(id)} className={tool === id ? 'is-active' : ''}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}
        <label title="Stroke color">Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label title="Stroke width">Width <input type="range" min="1" max="20" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
        <button type="button" disabled={!history.length} onClick={undo} title="Undo"><Undo2 size={15} />Undo</button>
        <button type="button" disabled={!future.length} onClick={redo} title="Redo"><Redo2 size={15} />Redo</button>
        <button type="button" disabled={!document.objects.some((item) => item.id === selected && item.kind === 'text')} onClick={editSelectedText} title="Edit selected text"><Hand size={15} />Edit text</button>
        <button type="button" disabled={!selected} onClick={removeSelected} title="Delete selected object"><X size={15} />Remove</button>
        <span className="pixel-board-toolbar-spacer" />
        <button type="button" onClick={newBoard}><FilePlus2 size={15} />New</button>
        <button type="button" onClick={saveBoard}><Save size={15} />Save</button>
        <button type="button" onClick={() => fileRef.current?.click()}><FileUp size={15} />Open</button>
        <button type="button" onClick={exportSvg}><Download size={15} />SVG</button>
        <button type="button" onClick={() => void exportPng()}><Download size={15} />PNG</button>
        <input ref={fileRef} type="file" accept=".pixelboard,application/json" className="sr-only" onChange={(event) => void openBoard(event.target.files?.[0])} />
      </div>
      <div className="pixel-board-canvas-wrap">
        <svg ref={svgRef} className={`pixel-board-canvas ${emergencyStopped ? 'is-disabled' : ''}`} viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} role="application" aria-label="Editable drawing canvas">
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#1d1d1d" />
          {document.objects.map((object) => <BoardShape key={object.id} object={object} selected={object.id === selected} />)}
          {previewObject ? <BoardShape object={previewObject} selected={false} /> : null}
        </svg>
      </div>
      <p className="pixel-board-status" role="status">{notice}{selected ? ' · One object selected; press Remove or Delete.' : ''}</p>
    </section>
  );
}

function BoardShape({ object, selected }: { object: BoardObject; selected: boolean }): React.JSX.Element | null {
  const first = object.points[0];
  if (!first) return null;
  const last = object.points.at(-1) ?? first;
  const common = { fill: 'none', stroke: object.color, strokeWidth: object.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const xs = object.points.map((point) => point.x); const ys = object.points.map((point) => point.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys); const maxX = Math.max(...xs); const maxY = Math.max(...ys);
  return <g data-board-object={object.id} opacity={object.kind === 'highlighter' ? .34 : 1}>
    {object.kind === 'text' ? <text x={first.x} y={first.y} fill={object.color} fontFamily="Segoe UI, sans-serif" fontSize={Math.max(18, object.width * 5)}>{object.text}</text>
      : object.kind === 'marker' ? <g><circle cx={first.x} cy={first.y} r="16" fill="#202020" stroke={object.color} strokeWidth={object.width} /><text x={first.x} y={first.y + 5} fill={object.color} textAnchor="middle" fontFamily="Segoe UI, sans-serif" fontSize="14" fontWeight="700">{object.step ?? 1}</text></g>
        : object.kind === 'pen' || object.kind === 'highlighter' ? <polyline points={object.points.map((point) => `${point.x},${point.y}`).join(' ')} {...common} />
          : object.kind === 'line' ? <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} {...common} />
            : object.kind === 'arrow' ? <g {...common}><line x1={first.x} y1={first.y} x2={last.x} y2={last.y} /><path d={`M ${last.x} ${last.y} l -8 -4 M ${last.x} ${last.y} l -4 8`} /></g>
              : object.kind === 'rectangle' ? <rect x={Math.min(first.x, last.x)} y={Math.min(first.y, last.y)} width={Math.max(1, Math.abs(last.x - first.x))} height={Math.max(1, Math.abs(last.y - first.y))} {...common} />
                : <ellipse cx={(first.x + last.x) / 2} cy={(first.y + last.y) / 2} rx={Math.max(1, Math.abs(last.x - first.x) / 2)} ry={Math.max(1, Math.abs(last.y - first.y) / 2)} {...common} />}
    {selected ? <rect x={minX - 6} y={minY - 6} width={Math.max(12, maxX - minX + 12)} height={Math.max(12, maxY - minY + 12)} fill="none" stroke="#4299F5" strokeDasharray="4 4" strokeWidth="1.5" pointerEvents="none" /> : null}
  </g>;
}
