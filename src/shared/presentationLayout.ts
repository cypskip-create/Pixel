import { DEFAULT_OFFSET_FROM_TOP } from './surfaces';
import type { SurfaceSize } from './surfaces';

export interface LayoutWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowBounds extends LayoutWorkArea {}

export const MIN_LAYOUT_WIDTH = 96;
export const MAX_LAYOUT_WIDTH = 520;
export const MIN_LAYOUT_HEIGHT = 96;

/** Resolve persisted display ids safely after monitor removal or reconnection. */
export function resolveAnchorDisplayId(
  selectedId: string | null,
  legacyPositionDisplayId: string | null,
  availableIds: readonly string[],
  primaryId: string,
): string {
  if (selectedId !== null && availableIds.includes(selectedId)) return selectedId;
  if (selectedId === null && legacyPositionDisplayId !== null && availableIds.includes(legacyPositionDisplayId)) {
    return legacyPositionDisplayId;
  }
  return availableIds.includes(primaryId) ? primaryId : (availableIds[0] ?? primaryId);
}

/** Bounds for the persistent island. Width changes never alter its center. */
export function anchoredTopCenterBounds(
  workArea: LayoutWorkArea,
  requestedSize: SurfaceSize,
  topOffset: number,
): WindowBounds {
  const fitted = fitPresentationSize(requestedSize, workArea);
  const width = Math.min(fitted.width, workArea.width);
  const height = Math.min(fitted.height, Math.max(1, workArea.height - 14));
  const maxY = workArea.y + workArea.height - height;
  const offset = Number.isFinite(topOffset)
    ? Math.min(Math.max(10, topOffset), 14)
    : DEFAULT_OFFSET_FROM_TOP;

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(Math.min(Math.max(workArea.y + offset, workArea.y), maxY)),
    width,
    height,
  };
}

/** Clamp renderer measurements to a compact window that fits its display. */
export function fitPresentationSize(
  requested: SurfaceSize,
  workArea: LayoutWorkArea,
): SurfaceSize {
  const availableWidth = Math.max(MIN_LAYOUT_WIDTH, Math.floor(workArea.width));
  const availableHeight = Math.max(
    MIN_LAYOUT_HEIGHT,
    Math.floor(workArea.height - DEFAULT_OFFSET_FROM_TOP),
  );
  const width = Number.isFinite(requested.width)
    ? Math.ceil(requested.width)
    : MIN_LAYOUT_WIDTH;
  const height = Number.isFinite(requested.height)
    ? Math.ceil(requested.height)
    : MIN_LAYOUT_HEIGHT;

  return {
    width: Math.min(Math.max(MIN_LAYOUT_WIDTH, width), MAX_LAYOUT_WIDTH, availableWidth),
    height: Math.min(Math.max(MIN_LAYOUT_HEIGHT, height), availableHeight),
  };
}

/** Resize about the current horizontal center and keep the top edge on-screen. */
export function resizePresentationBounds(
  current: WindowBounds,
  size: SurfaceSize,
  workArea: LayoutWorkArea,
): WindowBounds {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const centeredX = Math.round(current.x + (current.width - width) / 2);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.round(Math.min(Math.max(centeredX, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(current.y, workArea.y), maxY)),
    width,
    height,
  };
}
