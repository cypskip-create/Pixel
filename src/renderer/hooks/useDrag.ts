import { useCallback, useEffect, useRef, useState } from 'react';
import { useBridge } from '@/hooks/useBridge';

/** Pointer travel (px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

interface DragState {
  dragging: boolean;
  /** Live fractional offset from the grab origin, in screen pixels. */
  offset: { x: number; y: number } | null;
}

/**
 * Manual window dragging.
 *
 * CSS `-webkit-app-region: drag` hands the gesture to the OS, which means the
 * web layer never learns the final coordinates and cannot reconcile them with
 * `settings.companion.position`. Doing it in JS keeps one source of truth:
 * we capture the pointer, translate the window ourselves, and persist exactly
 * once on release.
 *
 * The initial window position is read lazily on the first move so a pointerdown
 * never costs an IPC round trip.
 */
export function useDrag() {
  const bridge = useBridge();
  const [state, setState] = useState<DragState>({ dragging: false, offset: null });

  const origin = useRef<{ pointerX: number; pointerY: number; winX: number; winY: number } | null>(
    null,
  );
  const armed = useRef<{ pointerX: number; pointerY: number } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const persist = useCallback(
    (x: number, y: number) => {
      if (bridge.kind !== 'ready') return;
      const api = bridge.bridge.window;
      if (!api || typeof api.setPosition !== 'function') return;
      void api.setPosition(Math.round(x), Math.round(y)).catch(() => {
        /* A rejected position write must never break the drag gesture. */
      });
    },
    [bridge],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Only the primary button, and never from an interactive child.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, [data-no-drag]')) return;

      armed.current = { pointerX: event.clientX, pointerY: event.clientY };
    },
    [],
  );

  useEffect(() => {
    if (bridge.kind !== 'ready') return undefined;
    const api = bridge.bridge.window;
    if (!api || typeof api.getPosition !== 'function') return undefined;

    const onPointerMove = (event: PointerEvent): void => {
      const start = armed.current;
      if (!start) return;

      // Promote the press to a drag only past the threshold.
      if (!origin.current) {
        const dx = event.clientX - start.pointerX;
        const dy = event.clientY - start.pointerY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

        armed.current = null;
        void (async () => {
          try {
            const position = await api.getPosition();
            if (!alive.current) return;
            origin.current = {
              pointerX: start.pointerX,
              pointerY: start.pointerY,
              winX: position.x,
              winY: position.y,
            };
            setState({ dragging: true, offset: null });
          } catch {
            origin.current = null;
          }
        })();
        return;
      }

      const from = origin.current;
      const dx = event.clientX - from.pointerX;
      const dy = event.clientY - from.pointerY;
      setState({ dragging: true, offset: { x: dx, y: dy } });
    };

    const finish = (): void => {
      armed.current = null;
      const from = origin.current;
      origin.current = null;
      if (!from) return;

      setState((current) => {
        if (current.offset !== null) {
          persist(from.winX + current.offset.x, from.winY + current.offset.y);
        }
        return { dragging: false, offset: null };
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [bridge, persist]);

  return {
    dragging: state.dragging,
    offset: state.offset,
    /** Attach to the element that acts as the drag handle. */
    onPointerDown,
  };
}
