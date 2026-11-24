import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScreenDrawingAnnotation,
  ScreenDrawingPoint,
  ScreenDrawingSceneSnapshot,
} from '@shared/types';
import { useBridge } from '@/hooks/useBridge';

const EMPTY_SCENE: ScreenDrawingSceneSnapshot = {
  visible: false,
  interactive: false,
  generation: 0,
  annotations: [],
  canUndo: false,
  canRedo: false,
  updatedAt: 0,
  viewport: null,
};

type InteractiveTool = 'freehand' | 'arrow' | 'box';

export interface ScreenDrawingOverlayProps {
  /** Optional controlled scene snapshot for deterministic tests/previews. */
  snapshotOverride?: ScreenDrawingSceneSnapshot;
  onAdd?: (req: import('@shared/types').ScreenDrawingAddRequest) => void | Promise<unknown>;
  onUndo?: () => void | Promise<unknown>;
  onRedo?: () => void | Promise<unknown>;
  onClear?: () => void | Promise<unknown>;
  onExitInteractive?: () => void | Promise<unknown>;
}

/**
 * Transparent click-through (or interactive) SVG screen-drawing overlay driven by
 * Pixel's authoritative Python ScreenDrawingEngine (`drawing:*` IPC).
 */
export function ScreenDrawingOverlay(props: ScreenDrawingOverlayProps): React.JSX.Element {
  const bridgeStatus = useBridge();
  const [liveScene, setLiveScene] = useState<ScreenDrawingSceneSnapshot>(EMPTY_SCENE);
  const [tool, setTool] = useState<InteractiveTool>('freehand');
  const [draftPoints, setDraftPoints] = useState<ScreenDrawingPoint[]>([]);
  const drawingRef = useRef(false);

  const scene = props.snapshotOverride ?? liveScene;

  useEffect(() => {
    if (props.snapshotOverride || bridgeStatus.kind !== 'ready' || !bridgeStatus.bridge.drawing) return;
    let active = true;
    void bridgeStatus.bridge.drawing.snapshot()
      .then((snap) => { if (active) setLiveScene(snap); })
      .catch(() => undefined);
    const unsubscribe = bridgeStatus.bridge.drawing.onUpdate((snap) => {
      if (active) setLiveScene(snap);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridgeStatus, props.snapshotOverride]);

  const callAdd = useCallback(async (req: import('@shared/types').ScreenDrawingAddRequest) => {
    if (props.onAdd) {
      await props.onAdd(req);
      return;
    }
    if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.drawing) {
      await bridgeStatus.bridge.drawing.add(req);
    }
  }, [bridgeStatus, props]);

  const callUndo = useCallback(async () => {
    if (props.onUndo) return props.onUndo();
    if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.drawing) await bridgeStatus.bridge.drawing.undo();
  }, [bridgeStatus, props]);

  const callRedo = useCallback(async () => {
    if (props.onRedo) return props.onRedo();
    if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.drawing) await bridgeStatus.bridge.drawing.redo();
  }, [bridgeStatus, props]);

  const callClear = useCallback(async () => {
    if (props.onClear) return props.onClear();
    if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.drawing) await bridgeStatus.bridge.drawing.clear();
  }, [bridgeStatus, props]);

  const callExitInteractive = useCallback(async () => {
    if (props.onExitInteractive) return props.onExitInteractive();
    if (bridgeStatus.kind === 'ready' && bridgeStatus.bridge.drawing) await bridgeStatus.bridge.drawing.setInteractive(false);
  }, [bridgeStatus, props]);

  useEffect(() => {
    if (!scene.interactive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void callExitInteractive();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scene.interactive, callExitInteractive]);

  if (!scene.visible) return <div aria-hidden="true" />;

  const viewport = scene.viewport ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const vx = viewport.x;
  const vy = viewport.y;
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);

  const toScreenPoint = (event: React.PointerEvent<SVGSVGElement>): ScreenDrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rx = rect.width > 0 ? (event.clientX - rect.left) * (vw / rect.width) : event.clientX;
    const ry = rect.height > 0 ? (event.clientY - rect.top) * (vh / rect.height) : event.clientY;
    return { x: Math.round(vx + rx), y: Math.round(vy + ry) };
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!scene.interactive || event.button !== 0) return;
    drawingRef.current = true;
    const pt = toScreenPoint(event);
    setDraftPoints([pt]);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!scene.interactive || !drawingRef.current) return;
    const pt = toScreenPoint(event);
    setDraftPoints((prev) => (tool === 'freehand' ? [...prev, pt] : [prev[0] ?? pt, pt]));
  };

  const handlePointerUp = (): void => {
    if (!scene.interactive || !drawingRef.current) return;
    drawingRef.current = false;
    const pts = draftPoints;
    setDraftPoints([]);
    if (pts.length < 2) return;
    if (tool === 'freehand') {
      void callAdd({ kind: 'freehand', points: pts, strokeWidth: 3.5, durationMs: 30_000 });
    } else if (tool === 'arrow') {
      void callAdd({ kind: 'arrow', start: pts[0], end: pts[pts.length - 1], curved: false, durationMs: 30_000 });
    } else if (tool === 'box') {
      const a = pts[0];
      const b = pts[pts.length - 1];
      const width = Math.max(8, Math.abs(b.x - a.x));
      const height = Math.max(8, Math.abs(b.y - a.y));
      void callAdd({
        kind: 'box',
        bounds: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height },
        durationMs: 30_000,
      });
    }
  };

  const spotlight = scene.annotations.find((a) => a.kind === 'spotlight' && a.bounds);

  return (
    <div
      data-testid="screen-drawing-overlay"
      className={scene.interactive ? 'fixed inset-0 select-none' : 'pointer-events-none fixed inset-0 select-none'}
    >
      <svg
        aria-label="Pixel screen drawing overlay"
        className={scene.interactive ? 'block h-full w-full cursor-crosshair overflow-hidden' : 'pointer-events-none block h-full w-full overflow-hidden'}
        width="100%"
        height="100%"
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <defs>
          <marker
            id="pixel-draw-arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--color-accent, #4299F5)" />
          </marker>
          {spotlight?.bounds && (
            <mask id="pixel-spotlight-mask">
              <rect x={0} y={0} width={vw} height={vh} fill="#ffffff" />
              <rect
                x={spotlight.bounds.x - vx}
                y={spotlight.bounds.y - vy}
                width={spotlight.bounds.width}
                height={spotlight.bounds.height}
                rx={8}
                fill="#000000"
              />
            </mask>
          )}
        </defs>

        {spotlight?.bounds && (
          <rect
            data-testid="drawing-spotlight-dim"
            x={0}
            y={0}
            width={vw}
            height={vh}
            fill="#000000"
            fillOpacity={spotlight.dimOpacity ?? 0.45}
            mask="url(#pixel-spotlight-mask)"
          />
        )}

        {scene.annotations.map((ann) => (
          <AnnotationNode key={ann.id} annotation={ann} vx={vx} vy={vy} vw={vw} />
        ))}

        {draftPoints.length >= 2 && (
          <path
            d={draftPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x - vx} ${p.y - vy}`).join(' ')}
            fill="none"
            stroke="var(--color-accent, #4299F5)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.85}
          />
        )}
      </svg>

      {scene.interactive && (
        <div
          data-testid="screen-drawing-toolbar"
          className="fixed left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] shadow-lg"
        >
          {(['freehand', 'arrow', 'box'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTool(item)}
              className={
                tool === item
                  ? 'rounded px-2 py-1 font-medium bg-[var(--color-accent)] text-[var(--color-text-on-accent)]'
                  : 'rounded px-2 py-1 hover:bg-[var(--color-bg-hover)]'
              }
            >
              {item === 'freehand' ? 'Pen' : item === 'arrow' ? 'Arrow' : 'Box'}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--color-border-subtle)]" />
          <button
            type="button"
            disabled={!scene.canUndo}
            onClick={() => { void callUndo(); }}
            className="rounded px-2 py-1 hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!scene.canRedo}
            onClick={() => { void callRedo(); }}
            className="rounded px-2 py-1 hover:bg-[var(--color-bg-hover)] disabled:opacity-40"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => { void callClear(); }}
            className="rounded px-2 py-1 hover:bg-[var(--color-bg-hover)]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => { void callExitInteractive(); }}
            className="rounded px-2 py-1 font-medium hover:bg-[var(--color-bg-hover)]"
          >
            Done (Esc)
          </button>
        </div>
      )}
    </div>
  );
}

function AnnotationNode({
  annotation,
  vx,
  vy,
  vw,
}: {
  annotation: ScreenDrawingAnnotation;
  vx: number;
  vy: number;
  vw: number;
}): React.JSX.Element {
  const accent = 'var(--color-accent, #4299F5)';
  const strokeDasharray = annotation.dashed ? '6 4' : undefined;
  const caption = annotation.label
    ? `${annotation.step ? `Step ${annotation.step}: ` : ''}${annotation.label}`
    : annotation.step
      ? `Step ${annotation.step}`
      : '';

  const renderLabel = (x: number, y: number): React.JSX.Element | null => {
    if (!caption) return null;
    const width = Math.min(vw - 16, Math.max(54, caption.length * 7 + 18));
    const clampedX = Math.max(8, Math.min(x, vw - width - 8));
    const clampedY = Math.max(26, y);
    return (
      <g transform={`translate(${clampedX}, ${clampedY})`}>
        <rect x={0} y={-20} width={width} height={24} rx={6} fill="#141414" stroke={accent} strokeWidth={1.25} />
        <text x={9} y={-4} fill="#F4F4F4" fontFamily="Segoe UI, sans-serif" fontSize={12} fontWeight={600}>
          {caption}
        </text>
      </g>
    );
  };

  if (annotation.kind === 'freehand' && annotation.svgPath) {
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity} transform={`translate(${-vx}, ${-vy})`}>
        <path
          d={annotation.svgPath}
          fill="none"
          stroke={accent}
          strokeWidth={annotation.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={strokeDasharray}
        />
      </g>
    );
  }

  if (annotation.kind === 'arrow' && annotation.svgPath && annotation.end) {
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity}>
        <g transform={`translate(${-vx}, ${-vy})`}>
          <path
            d={annotation.svgPath}
            fill="none"
            stroke={accent}
            strokeWidth={annotation.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={strokeDasharray}
            markerEnd="url(#pixel-draw-arrowhead)"
          />
        </g>
        {renderLabel(annotation.end.x - vx + 10, annotation.end.y - vy - 8)}
      </g>
    );
  }

  if (annotation.kind === 'pointer_flight' && annotation.svgPath && annotation.end) {
    const ex = annotation.end.x - vx;
    const ey = annotation.end.y - vy;
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity}>
        <g transform={`translate(${-vx}, ${-vy})`}>
          <path
            d={annotation.svgPath}
            fill="none"
            stroke={accent}
            strokeWidth={annotation.strokeWidth}
            strokeDasharray="6 5"
            strokeLinecap="round"
            markerEnd="url(#pixel-draw-arrowhead)"
          />
        </g>
        <circle cx={ex} cy={ey} r={10} fill="none" stroke={accent} strokeWidth={2} />
        <circle cx={ex} cy={ey} r={3.5} fill={accent} />
        {renderLabel(ex + 14, ey - 8)}
      </g>
    );
  }

  if ((annotation.kind === 'box' || annotation.kind === 'spotlight') && annotation.bounds) {
    const x = annotation.bounds.x - vx;
    const y = annotation.bounds.y - vy;
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity}>
        <rect
          x={x}
          y={y}
          width={annotation.bounds.width}
          height={annotation.bounds.height}
          rx={6}
          fill="none"
          stroke={accent}
          strokeWidth={annotation.strokeWidth}
          strokeDasharray={strokeDasharray}
        />
        {renderLabel(x, y - 8)}
      </g>
    );
  }

  if (annotation.kind === 'circle' && annotation.bounds) {
    const x = annotation.bounds.x - vx;
    const y = annotation.bounds.y - vy;
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity}>
        <ellipse
          cx={x + annotation.bounds.width / 2}
          cy={y + annotation.bounds.height / 2}
          rx={annotation.bounds.width / 2}
          ry={annotation.bounds.height / 2}
          fill="none"
          stroke={accent}
          strokeWidth={annotation.strokeWidth}
          strokeDasharray={strokeDasharray}
        />
        {renderLabel(x, y - 8)}
      </g>
    );
  }

  if (annotation.kind === 'callout' && annotation.anchor) {
    const ax = annotation.anchor.x - vx;
    const ay = annotation.anchor.y - vy;
    return (
      <g data-testid={`drawing-node-${annotation.kind}`} opacity={annotation.opacity}>
        <circle cx={ax} cy={ay} r={5} fill={accent} />
        {renderLabel(ax + 12, ay - 6)}
      </g>
    );
  }

  return <g />;
}
