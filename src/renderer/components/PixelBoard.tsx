import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, Download, Eraser, FilePlus2, FileUp,
  Grid3x3, Hand, Highlighter, Link2, ListOrdered, MousePointer2, Redo2, Save,
  Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  BOARD_DRAFT_KEY, BOARD_GRID_SIZE, BOARD_HEIGHT, BOARD_WIDTH,
  boardSvg, buildAlignmentOperations, createBoard, getObjectBounds,
  objectIntersectsRect, resolveConnectorPoints, snapPointToGrid,
  validateBoardDocument, wrapBoardText,
  type BoardAlignment, type BoardObject, type BoardOperation, type BoardPoint,
  type BoardSnapshot, type BoardTool, type PixelBoardDocument,
} from '@shared/drawingBoard';

const TOOL_ITEMS: Array<{ id: BoardTool; label: string; icon: typeof MousePointer2 }> = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'pen', label: 'Pen', icon: Hand },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { id: 'line', label: 'Line', icon: Hand },
  { id: 'arrow', label: 'Arrow', icon: Hand },
  { id: 'connector', label: 'Connector', icon: Link2 },
  { id: 'rectangle', label: 'Rectangle', icon: Hand },
  { id: 'circle', label: 'Circle', icon: Hand },
  { id: 'text', label: 'Text', icon: Hand },
  { id: 'marker', label: 'Step marker', icon: ListOrdered },
  { id: 'eraser', label: 'Erase', icon: Eraser },
];

function boardApi() {
  const bridge = window.cyps;
  if (!bridge?.board) throw new Error('The trusted Pixel Board bridge is unavailable.');
  return bridge.board;
}

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

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function PixelBoard({ emergencyStopped = false }: { emergencyStopped?: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>({ document: createBoard(), revision: 0, canUndo: false, canRedo: false });
  const document = snapshot.document;
  const [tool, setTool] = useState<BoardTool>('pen');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapGrid, setSnapGrid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [titleDraft, setTitleDraft] = useState('Untitled board');
  const [notice, setNotice] = useState('Loading the main-process Board document…');
  const [ready, setReady] = useState(false);
  const [previewObjects, setPreviewObjects] = useState<BoardObject[]>([]);
  const [marquee, setMarquee] = useState<{ start: BoardPoint; end: BoardPoint } | null>(null);
  const [color, setColor] = useState('#4299F5');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [drawing, setDrawing] = useState(false);
  const snapshotRef = useRef(snapshot);
  const editingTitle = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clipboardRef = useRef<BoardObject[]>([]);
  const currentObject = useRef<BoardObject | null>(null);
  const movingGroup = useRef<{ start: BoardPoint; originals: BoardObject[] } | null>(null);
  const marqueeStart = useRef<BoardPoint | null>(null);
  const svg = useMemo(() => boardSvg(document), [document]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0]! : null;

  useEffect(() => {
    let alive = true;
    const accept = (next: BoardSnapshot): void => {
      if (!alive || next.revision < snapshotRef.current.revision) return;
      snapshotRef.current = next;
      setSnapshot(next);
      if (!editingTitle.current) setTitleDraft(next.document.title);
    };
    const unsubscribe = boardApi().onChanged(accept);
    void boardApi().getState().then(async (current) => {
      if (!alive) return;
      accept(current);
      const legacy = loadDraft();
      if (current.revision === 0 && hasBoardContent(legacy)) {
        const migrated = await boardApi().importLegacyDraft(legacy);
        accept(migrated);
        setNotice('Recovered the existing local Board draft into the main-process document.');
      } else {
        setNotice('Board draft is saved locally in this Pixel profile. Use Save to export an editable .pixelboard file.');
      }
      setReady(true);
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Pixel could not load the Board document.');
      setReady(true);
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const acceptSnapshot = (next: BoardSnapshot): void => {
    if (next.revision < snapshotRef.current.revision) return;
    snapshotRef.current = next;
    setSnapshot(next);
    if (!editingTitle.current) setTitleDraft(next.document.title);
  };

  const enqueue = (operation: () => Promise<void>): void => {
    queueRef.current = queueRef.current.then(operation).catch(async (error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Pixel could not update the Board.');
      try { acceptSnapshot(await boardApi().getState()); } catch { /* the error stays visible */ }
    });
  };

  const commit = (operations: BoardOperation[]): void => {
    if (emergencyStopped || !ready || operations.length === 0) return;
    enqueue(async () => {
      const next = await boardApi().apply(operations, snapshotRef.current.revision);
      acceptSnapshot(next);
      setNotice(`Updated the main-process Board · revision ${next.revision}.`);
    });
  };

  const pointAt = (event: React.PointerEvent<SVGSVGElement>, applySnap = false): BoardPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const raw: BoardPoint = {
      x: Math.max(0, Math.min(BOARD_WIDTH, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * BOARD_WIDTH)),
      y: Math.max(0, Math.min(BOARD_HEIGHT, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * BOARD_HEIGHT)),
    };
    return applySnap && snapGrid ? snapPointToGrid(raw, BOARD_GRID_SIZE) : raw;
  };

  const findObjectAt = (point: BoardPoint, excludeId?: string): BoardObject | undefined => {
    for (let i = document.objects.length - 1; i >= 0; i -= 1) {
      const candidate = document.objects[i]!;
      if (candidate.id === excludeId || candidate.kind === 'connector') continue;
      const b = getObjectBounds(candidate);
      if (point.x >= b.minX - 6 && point.x <= b.maxX + 6 && point.y >= b.minY - 6 && point.y <= b.maxY + 6) {
        return candidate;
      }
    }
    return undefined;
  };

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (emergencyStopped || !ready) return;
    const isFreehand = tool === 'pen' || tool === 'highlighter';
    const point = pointAt(event, !isFreehand);
    if (tool === 'select') {
      const target = (event.target as Element).closest('[data-board-object]');
      const id = target?.getAttribute('data-board-object') ?? null;
      if (id) {
        let nextSelected: string[];
        if (event.shiftKey) {
          nextSelected = selectedSet.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
          setSelectedIds(nextSelected);
          return;
        }
        nextSelected = selectedSet.has(id) ? selectedIds : [id];
        setSelectedIds(nextSelected);
        const originals = document.objects.filter((item) => nextSelected.includes(item.id));
        if (originals.length > 0) {
          event.currentTarget.setPointerCapture(event.pointerId);
          movingGroup.current = { start: point, originals };
        }
      } else {
        if (!event.shiftKey) setSelectedIds([]);
        event.currentTarget.setPointerCapture(event.pointerId);
        marqueeStart.current = point;
        setMarquee({ start: point, end: point });
      }
      return;
    }
    if (tool === 'eraser') {
      const target = (event.target as Element).closest('[data-board-object]');
      const id = target?.getAttribute('data-board-object');
      if (id) {
        commit([{ type: 'delete', id }]);
        setSelectedIds((prev) => prev.filter((item) => item !== id));
      }
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text to place on the board:', '');
      if (!text?.trim()) return;
      commit([{ type: 'add', object: { id: crypto.randomUUID(), kind: 'text', points: [point], text: wrapBoardText(text.trim().slice(0, 2_000)), color, width: strokeWidth } }]);
      setTool('select');
      return;
    }
    if (tool === 'marker') {
      const step = document.objects.filter((item) => item.kind === 'marker').length + 1;
      if (step > 99) { setNotice('This board reached its 99-step-marker limit.'); return; }
      commit([{ type: 'add', object: { id: crypto.randomUUID(), kind: 'marker', points: [point], step, color, width: strokeWidth } }]);
      setTool('select');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'connector') {
      const source = findObjectAt(point);
      const startPoint = source ? { x: getObjectBounds(source).cx, y: getObjectBounds(source).cy } : point;
      currentObject.current = {
        id: crypto.randomUUID(),
        kind: 'connector',
        points: [startPoint, point],
        color,
        width: strokeWidth,
        ...(source ? { fromId: source.id } : {}),
        arrowHead: true,
      };
      setDrawing(true);
      return;
    }
    currentObject.current = { id: crypto.randomUUID(), kind: tool, points: [point], color, width: strokeWidth };
    setDrawing(true);
  };

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const moving = movingGroup.current;
    if (moving) {
      const point = pointAt(event, true);
      const dx = point.x - moving.start.x;
      const dy = point.y - moving.start.y;
      const moved = moving.originals.map((original) => ({
        ...original,
        points: original.points.map((item) => ({
          x: Math.max(0, Math.min(BOARD_WIDTH, item.x + dx)),
          y: Math.max(0, Math.min(BOARD_HEIGHT, item.y + dy)),
        })),
      }));
      setPreviewObjects(moved);
      return;
    }
    if (marqueeStart.current) {
      setMarquee({ start: marqueeStart.current, end: pointAt(event, false) });
      return;
    }
    const current = currentObject.current;
    if (!drawing || !current) return;
    const isFreehand = current.kind === 'pen' || current.kind === 'highlighter';
    const point = pointAt(event, !isFreehand);
    if (current.kind === 'connector') {
      const target = findObjectAt(point, current.fromId);
      const endPoint = target ? { x: getObjectBounds(target).cx, y: getObjectBounds(target).cy } : point;
      current.toId = target?.id;
      current.points = [current.points[0] ?? point, endPoint];
      setPreviewObjects([{ ...current }]);
      return;
    }
    current.points = isFreehand
      ? current.points.length < 4_000 ? [...current.points, point] : [...current.points.slice(0, 3_999), point]
      : [current.points[0] ?? point, point];
    setPreviewObjects([{ ...current, points: current.points }]);
  };

  const pointerUp = (): void => {
    const moving = movingGroup.current;
    if (moving) {
      movingGroup.current = null;
      const moved = previewObjects;
      setPreviewObjects([]);
      if (moved.length === moving.originals.length) {
        const ops: BoardOperation[] = [];
        for (let i = 0; i < moved.length; i += 1) {
          const originalFirst = moving.originals[i]?.points[0];
          const movedFirst = moved[i]?.points[0];
          if (originalFirst && movedFirst) {
            const dx = movedFirst.x - originalFirst.x;
            const dy = movedFirst.y - originalFirst.y;
            if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
              ops.push({ type: 'move', id: moving.originals[i]!.id, dx, dy });
            }
          }
        }
        if (ops.length > 0) commit(ops);
      }
      return;
    }
    if (marqueeStart.current && marquee) {
      const rect = {
        minX: Math.min(marquee.start.x, marquee.end.x),
        minY: Math.min(marquee.start.y, marquee.end.y),
        maxX: Math.max(marquee.start.x, marquee.end.x),
        maxY: Math.max(marquee.start.y, marquee.end.y),
      };
      marqueeStart.current = null;
      setMarquee(null);
      if (rect.maxX - rect.minX > 4 || rect.maxY - rect.minY > 4) {
        const hits = document.objects.filter((obj) => objectIntersectsRect(obj, rect)).map((obj) => obj.id);
        setSelectedIds(hits);
      }
      return;
    }
    const current = currentObject.current;
    if (!current) return;
    currentObject.current = null;
    setPreviewObjects([]);
    setDrawing(false);
    if (document.objects.length >= 500) { setNotice('This board reached its 500-object limit.'); return; }
    if (current.kind === 'connector') {
      const [start, end] = resolveConnectorPoints(current, document.objects);
      current.points = [start, end];
    }
    commit([{ type: 'add', object: current }]);
  };

  const undo = (): void => {
    if (!ready || !snapshotRef.current.canUndo) return;
    enqueue(async () => { acceptSnapshot(await boardApi().undo()); setSelectedIds([]); });
  };
  const redo = (): void => {
    if (!ready || !snapshotRef.current.canRedo) return;
    enqueue(async () => { acceptSnapshot(await boardApi().redo()); setSelectedIds([]); });
  };
  const removeSelected = (): void => {
    if (selectedIds.length === 0) return;
    commit(selectedIds.map((id) => ({ type: 'delete', id })));
    setSelectedIds([]);
  };
  const alignSelected = (alignment: BoardAlignment): void => {
    const ops = buildAlignmentOperations(document.objects, selectedIds, alignment);
    if (ops.length > 0) commit(ops);
  };
  const nudgeSelected = (dx: number, dy: number): void => {
    if (selectedIds.length === 0) return;
    commit(selectedIds.map((id) => ({ type: 'move', id, dx, dy })));
  };
  const copySelected = (): void => {
    if (selectedIds.length === 0) return;
    clipboardRef.current = document.objects
      .filter((obj) => selectedSet.has(obj.id))
      .map((obj) => ({ ...obj, points: obj.points.map((p) => ({ ...p })) }));
    setNotice(`Copied ${clipboardRef.current.length} board object(s).`);
  };
  const pasteClipboard = (): void => {
    if (clipboardRef.current.length === 0) return;
    const idMap = new Map<string, string>();
    for (const obj of clipboardRef.current) idMap.set(obj.id, crypto.randomUUID());
    const pasted: BoardObject[] = clipboardRef.current.map((obj) => ({
      ...obj,
      id: idMap.get(obj.id)!,
      points: obj.points.map((p) => ({
        x: Math.max(0, Math.min(BOARD_WIDTH, p.x + BOARD_GRID_SIZE)),
        y: Math.max(0, Math.min(BOARD_HEIGHT, p.y + BOARD_GRID_SIZE)),
      })),
      ...(obj.fromId && idMap.has(obj.fromId) ? { fromId: idMap.get(obj.fromId) } : { fromId: undefined }),
      ...(obj.toId && idMap.has(obj.toId) ? { toId: idMap.get(obj.toId) } : { toId: undefined }),
    }));
    commit(pasted.map((object) => ({ type: 'add', object })));
    setSelectedIds(pasted.map((o) => o.id));
  };
  const editSelectedText = (): void => {
    const item = document.objects.find((candidate) => candidate.id === singleSelectedId && candidate.kind === 'text');
    if (!item) return;
    const text = window.prompt('Edit board text:', item.text ?? '');
    if (text === null) return;
    commit([{ type: 'update', id: item.id, patch: { text: text.slice(0, 2_000) } }]);
  };

  const download = (name: string, data: Blob): void => {
    const url = URL.createObjectURL(data);
    const link = window.document.createElement('a');
    link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  const saveBoard = (): void => enqueue(async () => {
    const result = await boardApi().save('pixelboard');
    setNotice(result.cancelled ? 'Save cancelled.' : result.ok ? `Saved and verified ${result.path ?? 'Pixel Board document'}.` : result.error ?? 'Pixel could not save the Board.');
  });
  const exportSvg = (): void => enqueue(async () => {
    const result = await boardApi().save('svg');
    setNotice(result.cancelled ? 'SVG export cancelled.' : result.ok ? `Exported and verified ${result.path ?? 'SVG file'}.` : result.error ?? 'Pixel could not export the Board.');
  });
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
  const openBoard = (): void => enqueue(async () => {
    const result = await boardApi().open();
    if (result.snapshot) { acceptSnapshot(result.snapshot); setSelectedIds([]); setNotice(`Opened ${result.snapshot.document.title}.`); }
    else setNotice(result.cancelled ? 'Open cancelled.' : result.error ?? 'Pixel could not open the Board.');
  });
  const newBoard = (): void => {
    if (emergencyStopped || !ready) return;
    if (hasBoardContent(document) && !window.confirm('Replace the current board and local draft? Export it first if you want to keep a separate copy.')) return;
    enqueue(async () => { acceptSnapshot(await boardApi().create('Untitled board', true, snapshotRef.current.revision)); setSelectedIds([]); });
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (isEditableElement(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (mod && key === 'y') {
        event.preventDefault(); redo();
      } else if (mod && key === 'a') {
        event.preventDefault();
        setTool('select');
        setSelectedIds(document.objects.map((o) => o.id));
      } else if (mod && key === 'c') {
        if (selectedIds.length > 0) { event.preventDefault(); copySelected(); }
      } else if (mod && key === 'x') {
        if (selectedIds.length > 0) { event.preventDefault(); copySelected(); removeSelected(); }
      } else if (mod && key === 'v') {
        if (clipboardRef.current.length > 0) { event.preventDefault(); pasteClipboard(); }
      } else if (event.key === 'Escape') {
        setSelectedIds([]);
        setTool('select');
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedIds.length > 0) { event.preventDefault(); removeSelected(); }
      } else if (selectedIds.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const delta = event.shiftKey ? BOARD_GRID_SIZE : 4;
        const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
        const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
        nudgeSelected(dx, dy);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [document, snapshot.canRedo, snapshot.canUndo, selectedIds, emergencyStopped, ready]);

  const previewMap = useMemo(() => new Map(previewObjects.map((o) => [o.id, o])), [previewObjects]);
  const renderedObjects = useMemo(
    () => document.objects.map((obj) => previewMap.get(obj.id) ?? obj),
    [document.objects, previewMap],
  );
  const newPreviewOnly = useMemo(
    () => previewObjects.filter((obj) => !document.objects.some((existing) => existing.id === obj.id)),
    [document.objects, previewObjects],
  );

  return (
    <section className="workspace-page pixel-board-page" aria-label="Pixel board">
      <header className="workspace-page-heading">
        <div>
          <h1>Pixel Board</h1>
          <p>One editable Board shared by your Workspace and Pixel’s agent. Shift-click or drag to multi-select; drag Connector between shapes to link them.</p>
        </div>
        <input
          aria-label="Board title"
          value={titleDraft}
          maxLength={120}
          disabled={!ready || emergencyStopped}
          onFocus={() => { editingTitle.current = true; }}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => { editingTitle.current = false; if (titleDraft !== document.title) commit([{ type: 'setTitle', title: titleDraft }]); else setTitleDraft(document.title); }}
        />
      </header>
      {emergencyStopped ? <p className="pixel-board-stop" role="alert">Emergency stop is active. Drawing is paused until it is cleared.</p> : null}
      <div className="pixel-board-toolbar" role="toolbar" aria-label="Board tools">
        {TOOL_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={tool === id} title={label} disabled={emergencyStopped || !ready} onClick={() => setTool(id)} className={tool === id ? 'is-active' : ''}>
            <Icon size={15} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
        <label title="Stroke color">Color <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label title="Stroke width">Width <input type="range" min="1" max="20" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
        <button type="button" aria-pressed={snapGrid} onClick={() => setSnapGrid((v) => !v)} title="Toggle 20px grid snapping" className={snapGrid ? 'is-active' : ''}><Grid3x3 size={15} />Snap</button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('left')} title="Align left"><AlignStartVertical size={15} /></button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('center-x')} title="Align center horizontally"><AlignCenterVertical size={15} /></button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('right')} title="Align right"><AlignEndVertical size={15} /></button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('top')} title="Align top"><AlignStartHorizontal size={15} /></button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('center-y')} title="Align middle vertically"><AlignCenterHorizontal size={15} /></button>
        <button type="button" disabled={selectedIds.length < 2} onClick={() => alignSelected('bottom')} title="Align bottom"><AlignEndHorizontal size={15} /></button>
        <button type="button" disabled={!snapshot.canUndo || !ready} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={15} />Undo</button>
        <button type="button" disabled={!snapshot.canRedo || !ready} onClick={redo} title="Redo (Ctrl+Y)"><Redo2 size={15} />Redo</button>
        <button type="button" disabled={!document.objects.some((item) => item.id === singleSelectedId && item.kind === 'text')} onClick={editSelectedText} title="Edit selected text"><Hand size={15} />Edit text</button>
        <button type="button" disabled={selectedIds.length === 0} onClick={removeSelected} title="Delete selected (Del)"><X size={15} />Remove</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.75, Math.round((z - 0.25) * 100) / 100))} title="Zoom out"><ZoomOut size={15} /></button>
        <button type="button" onClick={() => setZoom(1)} title="Reset zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100))} title="Zoom in"><ZoomIn size={15} /></button>
        <span className="pixel-board-toolbar-spacer" />
        <button type="button" onClick={newBoard} disabled={emergencyStopped || !ready}><FilePlus2 size={15} />New</button>
        <button type="button" onClick={saveBoard}><Save size={15} />Save</button>
        <button type="button" onClick={openBoard} disabled={!ready}><FileUp size={15} />Open</button>
        <button type="button" onClick={exportSvg}><Download size={15} />SVG</button>
        <button type="button" onClick={() => void exportPng()}><Download size={15} />PNG</button>
      </div>
      <div className="pixel-board-canvas-wrap">
        <svg
          ref={svgRef}
          className={`pixel-board-canvas ${emergencyStopped ? 'is-disabled' : ''}`}
          style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top left' } : undefined}
          viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
          preserveAspectRatio="none"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          role="application"
          aria-label="Editable drawing canvas"
        >
          <defs>
            <pattern id="pixel-board-grid" width={BOARD_GRID_SIZE} height={BOARD_GRID_SIZE} patternUnits="userSpaceOnUse">
              <path d={`M ${BOARD_GRID_SIZE} 0 L 0 0 0 ${BOARD_GRID_SIZE}`} fill="none" stroke="#25282e" strokeWidth="0.75" />
            </pattern>
          </defs>
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#1d1d1d" />
          {snapGrid ? <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#pixel-board-grid)" pointerEvents="none" /> : null}
          {renderedObjects.map((object) => (
            <BoardShape key={object.id} object={object} allObjects={renderedObjects} selected={selectedSet.has(object.id)} />
          ))}
          {newPreviewOnly.map((object) => (
            <BoardShape key={object.id} object={object} allObjects={renderedObjects} selected={false} />
          ))}
          {marquee ? (
            <rect
              x={Math.min(marquee.start.x, marquee.end.x)}
              y={Math.min(marquee.start.y, marquee.end.y)}
              width={Math.abs(marquee.end.x - marquee.start.x)}
              height={Math.abs(marquee.end.y - marquee.start.y)}
              fill="#4299F5"
              fillOpacity="0.12"
              stroke="#4299F5"
              strokeDasharray="4 3"
              strokeWidth="1.25"
              pointerEvents="none"
            />
          ) : null}
        </svg>
      </div>
      <p className="pixel-board-status" role="status">
        {notice}
        {selectedIds.length === 1 ? ' · 1 object selected (Arrows to nudge, Ctrl+C/V to duplicate, Del to remove).' : selectedIds.length > 1 ? ` · ${selectedIds.length} objects selected (use Align controls, Arrows to nudge, or Del to remove).` : ''}
      </p>
    </section>
  );
}

function arrowHeadPoints(from: BoardPoint, to: BoardPoint, size: number): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 6;
  const x1 = to.x - size * Math.cos(angle - spread);
  const y1 = to.y - size * Math.sin(angle - spread);
  const x2 = to.x - size * Math.cos(angle + spread);
  const y2 = to.y - size * Math.sin(angle + spread);
  return `M ${x1} ${y1} L ${to.x} ${to.y} L ${x2} ${y2}`;
}

function BoardShape({
  object,
  allObjects,
  selected,
}: {
  object: BoardObject;
  allObjects: readonly BoardObject[];
  selected: boolean;
}): React.JSX.Element | null {
  const first = object.points[0];
  if (!first) return null;
  const last = object.points.at(-1) ?? first;
  const common = { fill: 'none', stroke: object.color, strokeWidth: object.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const [connStart, connEnd] = object.kind === 'connector' ? resolveConnectorPoints(object, allObjects) : [first, last];
  const bounds = object.kind === 'connector'
    ? {
        minX: Math.min(connStart.x, connEnd.x),
        minY: Math.min(connStart.y, connEnd.y),
        maxX: Math.max(connStart.x, connEnd.x),
        maxY: Math.max(connStart.y, connEnd.y),
      }
    : getObjectBounds(object);

  return (
    <g data-board-object={object.id} opacity={object.kind === 'highlighter' ? 0.34 : 1}>
      {object.kind === 'text' ? (
        <text x={first.x} y={first.y} fill={object.color} fontFamily="Segoe UI, sans-serif" fontSize={Math.max(18, object.width * 5)}>
          {(object.text ?? '').split(/\r?\n/).slice(0, 32).map((line, index) => (
            <tspan key={`${object.id}-${index}`} x={first.x} dy={index === 0 ? 0 : Math.max(18, object.width * 5) * 1.25}>{line}</tspan>
          ))}
        </text>
      ) : object.kind === 'marker' ? (
        <g>
          <circle cx={first.x} cy={first.y} r="16" fill="#202020" stroke={object.color} strokeWidth={object.width} />
          <text x={first.x} y={first.y + 5} fill={object.color} textAnchor="middle" fontFamily="Segoe UI, sans-serif" fontSize="14" fontWeight="700">{object.step ?? 1}</text>
        </g>
      ) : object.kind === 'pen' || object.kind === 'highlighter' ? (
        <polyline points={object.points.map((point) => `${point.x},${point.y}`).join(' ')} {...common} />
      ) : object.kind === 'line' ? (
        <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} {...common} />
      ) : object.kind === 'arrow' ? (
        <g {...common}>
          <line x1={first.x} y1={first.y} x2={last.x} y2={last.y} />
          <path d={arrowHeadPoints(first, last, Math.max(8, object.width * 3))} />
        </g>
      ) : object.kind === 'connector' ? (
        <g {...common}>
          <line x1={connStart.x} y1={connStart.y} x2={connEnd.x} y2={connEnd.y} />
          {object.arrowHead === false ? null : <path d={arrowHeadPoints(connStart, connEnd, Math.max(8, object.width * 3))} />}
        </g>
      ) : object.kind === 'rectangle' ? (
        <rect x={Math.min(first.x, last.x)} y={Math.min(first.y, last.y)} width={Math.max(1, Math.abs(last.x - first.x))} height={Math.max(1, Math.abs(last.y - first.y))} {...common} />
      ) : (
        <ellipse cx={(first.x + last.x) / 2} cy={(first.y + last.y) / 2} rx={Math.max(1, Math.abs(last.x - first.x) / 2)} ry={Math.max(1, Math.abs(last.y - first.y) / 2)} {...common} />
      )}
      {selected ? (
        <rect
          x={bounds.minX - 6}
          y={bounds.minY - 6}
          width={Math.max(12, bounds.maxX - bounds.minX + 12)}
          height={Math.max(12, bounds.maxY - bounds.minY + 12)}
          fill="none"
          stroke="#4299F5"
          strokeDasharray="4 4"
          strokeWidth="1.5"
          pointerEvents="none"
        />
      ) : null}
    </g>
  );
}
