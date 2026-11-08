/**
 * Multi-monitor and DPI geometry for the companion and screen guidance.
 *
 * All rectangles and points here are in Electron's global DIP space: the virtual
 * desktop in device-independent pixels, where a display to the left of or above
 * the primary one has NEGATIVE coordinates. Nothing here assumes the primary
 * display sits at (0, 0) or that every display shares one scale factor.
 *
 * Mixed DPI is handled by never converting through physical pixels across
 * displays. An image captured from one display covers exactly one DIP rectangle,
 * so a point in the image maps to the display by *proportion*, which is correct
 * whatever that display's scale factor is.
 *
 * Pure TypeScript with no Electron imports, so it is unit-testable anywhere.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Point, Size {}

export interface DisplayInfo {
  id: number;
  /** Full display rectangle, global DIP. */
  bounds: Rect;
  /** Area not covered by the taskbar, global DIP. */
  workArea: Rect;
  scaleFactor: number;
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}
export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectContains(r: Rect, p: Point): boolean {
  // Half-open on the far edges so adjacent displays never both claim a point.
  return p.x >= r.x && p.x < rectRight(r) && p.y >= r.y && p.y < rectBottom(r);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

/** The display a point lies on, or null when it is off every display. */
export function displayContaining(displays: readonly DisplayInfo[], p: Point): DisplayInfo | null {
  return displays.find((d) => rectContains(d.bounds, p)) ?? null;
}

/** The display closest to a point, for points that fell into a gap or off-screen. */
export function nearestDisplay(displays: readonly DisplayInfo[], p: Point): DisplayInfo | null {
  let best: DisplayInfo | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const d of displays) {
    const dx = p.x - clamp(p.x, d.bounds.x, rectRight(d.bounds) - 1);
    const dy = p.y - clamp(p.y, d.bounds.y, rectBottom(d.bounds) - 1);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = d;
    }
  }
  return best;
}

/** Keep a point inside a rectangle with a margin on every side. */
export function clampPoint(p: Point, area: Rect, margin = 0): Point {
  return {
    x: clamp(p.x, area.x + margin, rectRight(area) - margin),
    y: clamp(p.y, area.y + margin, rectBottom(area) - margin),
  };
}

/** Keep a whole rectangle (a window) inside an area. */
export function clampRect(r: Rect, area: Rect): Rect {
  return {
    width: r.width,
    height: r.height,
    x: clamp(r.x, area.x, rectRight(area) - r.width),
    y: clamp(r.y, area.y, rectBottom(area) - r.height),
  };
}

/**
 * Make sure a remembered window position is still on a connected display.
 *
 * A saved position goes stale when a monitor is unplugged or rearranged, which
 * leaves the window "open" but invisible. If the window overlaps no display by at
 * least `minVisible` pixels in each direction it is moved to the top centre of the
 * nearest display's work area; otherwise it is only nudged fully on-screen.
 */
export function ensureVisible(
  rect: Rect,
  displays: readonly DisplayInfo[],
  options: { minVisible?: number; fallbackTopOffset?: number } = {},
): { rect: Rect; moved: boolean } {
  const minVisible = options.minVisible ?? 40;
  const topOffset = options.fallbackTopOffset ?? 24;
  if (displays.length === 0) return { rect, moved: false };

  const visibleOn = (d: DisplayInfo): boolean => {
    const w = Math.min(rectRight(rect), rectRight(d.workArea)) - Math.max(rect.x, d.workArea.x);
    const h = Math.min(rectBottom(rect), rectBottom(d.workArea)) - Math.max(rect.y, d.workArea.y);
    return w >= minVisible && h >= minVisible;
  };

  const host = displays.find(visibleOn);
  if (host) {
    const clamped = clampRect(rect, host.workArea);
    return { rect: clamped, moved: clamped.x !== rect.x || clamped.y !== rect.y };
  }

  const nearest = nearestDisplay(displays, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })!;
  const area = nearest.workArea;
  return {
    rect: {
      width: rect.width,
      height: rect.height,
      x: Math.round(area.x + (area.width - rect.width) / 2),
      y: area.y + topOffset,
    },
    moved: true,
  };
}

/** Largest long edge allowed for a model-bound screenshot. */
export const DEFAULT_MAX_CAPTURE_EDGE = 1568;

/**
 * Pick the size of the image sent to a model: the captured size, scaled down to
 * fit `maxLongEdge` with the aspect ratio preserved exactly. Aspect must not be
 * distorted or x/y coordinates the model reports will drift.
 */
export function fitCaptureSize(physical: Size, maxLongEdge = DEFAULT_MAX_CAPTURE_EDGE): Size {
  const longEdge = Math.max(physical.width, physical.height);
  if (longEdge <= maxLongEdge) return { width: physical.width, height: physical.height };
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(physical.width * scale)),
    height: Math.max(1, Math.round(physical.height * scale)),
  };
}

export interface MappedPoint {
  /** Global DIP position. */
  point: Point;
  /** True when the model's coordinate fell outside the image and was pulled in. */
  clamped: boolean;
}

/**
 * Convert a coordinate in a screenshot's pixel space to a global DIP point.
 *
 * `region` is the global DIP rectangle the image covers: a display's bounds for
 * a screen capture, or a window's bounds for an active-window capture (which is
 * how crop offsets are accounted for). The mapping is proportional, so it is
 * independent of the display's DPI scale and of any downscaling applied before
 * the image was sent.
 *
 * Returns null for non-finite input or a degenerate image, and for coordinates
 * further than `tolerance` pixels outside the image (a likely hallucination),
 * rather than quietly pointing at the nearest edge.
 */
export function mapImagePointToGlobal(
  imagePoint: Point,
  image: Size,
  region: Rect,
  tolerance = 8,
): MappedPoint | null {
  if (![imagePoint.x, imagePoint.y, image.width, image.height].every(Number.isFinite)) return null;
  if (image.width <= 0 || image.height <= 0 || region.width <= 0 || region.height <= 0) return null;

  const outside =
    imagePoint.x < -tolerance ||
    imagePoint.y < -tolerance ||
    imagePoint.x > image.width + tolerance ||
    imagePoint.y > image.height + tolerance;
  if (outside) return null;

  const cx = clamp(imagePoint.x, 0, image.width);
  const cy = clamp(imagePoint.y, 0, image.height);
  return {
    point: {
      x: region.x + (cx / image.width) * region.width,
      y: region.y + (cy / image.height) * region.height,
    },
    clamped: cx !== imagePoint.x || cy !== imagePoint.y,
  };
}

/** Inverse of mapImagePointToGlobal, for drawing a global point on a capture. */
export function mapGlobalToImagePoint(globalPoint: Point, image: Size, region: Rect): Point | null {
  if (region.width <= 0 || region.height <= 0) return null;
  return {
    x: ((globalPoint.x - region.x) / region.width) * image.width,
    y: ((globalPoint.y - region.y) / region.height) * image.height,
  };
}

/** Express a global DIP point relative to a window, so a target can follow it. */
export function toWindowRelative(p: Point, windowRect: Rect): Point {
  return { x: (p.x - windowRect.x) / windowRect.width, y: (p.y - windowRect.y) / windowRect.height };
}

export function fromWindowRelative(rel: Point, windowRect: Rect): Point {
  return { x: windowRect.x + rel.x * windowRect.width, y: windowRect.y + rel.y * windowRect.height };
}