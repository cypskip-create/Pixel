import { useEffect, type RefObject } from 'react';
import type { Surface } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';

const REPORT_DELAY_MS = 120;
const SIZE_EPSILON = 3;

/**
 * Measures the visible companion stack and sends its bounds through the narrow
 * preload API. Native code clamps the result to the selected display's work area.
 */
export function usePresentationLayout(
  rootRef: RefObject<HTMLElement | null>,
  surface: Surface,
): void {
  const bridge = useBridge();

  useEffect(() => {
    if (bridge.kind !== 'ready' || surface === 'hidden') return;
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;

    let timer: number | null = null;
    let frame: number | null = null;
    let previous: { width: number; height: number } | null = null;
    const observed = new Set<Element>();
    const resizeObserver = new ResizeObserver(schedule);

    const observePanels = (): void => {
      for (const panel of root.querySelectorAll('[data-layout-panel]')) {
        if (observed.has(panel)) continue;
        observed.add(panel);
        resizeObserver.observe(panel);
      }
    };

    const report = (): void => {
      timer = null;
      frame = null;
      const width = Math.max(96, Math.ceil(root.scrollWidth));
      const height = Math.max(96, Math.ceil(root.scrollHeight));
      if (
        previous &&
        Math.abs(previous.width - width) <= SIZE_EPSILON &&
        Math.abs(previous.height - height) <= SIZE_EPSILON
      ) {
        return;
      }
      previous = { width, height };
      void bridge.bridge.window.setLayout(surface, { width, height }).catch(() => undefined);
    };

    function schedule(): void {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      timer = window.setTimeout(() => {
        frame = window.requestAnimationFrame(report);
      }, REPORT_DELAY_MS);
    }

    observePanels();
    resizeObserver.observe(root);
    const mutationObserver = new MutationObserver(() => {
      observePanels();
      schedule();
    });
    mutationObserver.observe(root, { childList: true, subtree: true });
    schedule();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (frame !== null) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [bridge, rootRef, surface]);
}
