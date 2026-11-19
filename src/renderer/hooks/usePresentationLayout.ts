import { useEffect, type RefObject } from 'react';
import type { Surface } from '@shared/types';
import { SURFACE_SIZES } from '@shared/surfaces';
import { useBridge } from '@/hooks/useBridge';

/**
 * Reports one bounded geometry per deliberate surface transition.
 *
 * Content size is not native-window geometry: a streamed paragraph can change
 * every frame, so ResizeObserver/scrollHeight must never drive BrowserWindow
 * bounds. Responses and transcripts scroll inside the fixed bubble surface.
 */
export function usePresentationLayout(
  _rootRef: RefObject<HTMLElement | null>,
  surface: Surface,
): void {
  const bridge = useBridge();

  useEffect(() => {
    if (bridge.kind !== 'ready' || surface === 'hidden') return;
    void bridge.bridge.window.setLayout(surface, SURFACE_SIZES[surface]).catch(() => undefined);
  }, [bridge, surface]);
}
