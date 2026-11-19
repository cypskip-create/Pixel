import { clamp, clampPoint, rectBottom, rectRight, type Point, type Rect, type Size } from './geometry';

/**
 * Spring-driven cursor following.
 *
 * The follower is stepped with the exact closed-form solution of a damped spring
 * rather than by integrating, so it is stable for any frame time (a dropped frame
 * cannot make it explode) and behaves identically at 30 and 144 Hz.
 *
 * It also reports when it has settled. The caller stops its timer at that point
 * and restarts it on the next mouse movement, so an idle companion costs no CPU.
 */

export interface FollowConfig {
  /** Time, in seconds, for the companion to cover most of the distance. Lower = snappier. */
  responseSeconds: number;
  /** 1 = no overshoot. Below 1 gives a small, natural spring-back. */
  dampingRatio: number;
  /** Multiplier from the user's "follow speed" setting. 1 = default. */
  speed: number;
}

export const DEFAULT_FOLLOW_CONFIG: FollowConfig = {
  responseSeconds: 0.14,
  dampingRatio: 1,
  speed: 1,
};

export const CURSOR_WINDOW_SIZE = 36;
export const CURSOR_VISIBLE_SIZE = 28;
export const CURSOR_ICON_VIEWBOX_SIZE = 32;
export const CURSOR_ICON_HOTSPOT = { x: 2, y: 2 } as const;
export const CURSOR_WINDOW_PADDING = (CURSOR_WINDOW_SIZE - CURSOR_VISIBLE_SIZE) / 2;
export const CURSOR_WINDOW_HOTSPOT = {
  x: CURSOR_WINDOW_PADDING + (CURSOR_ICON_HOTSPOT.x / CURSOR_ICON_VIEWBOX_SIZE) * CURSOR_VISIBLE_SIZE,
  y: CURSOR_WINDOW_PADDING + (CURSOR_ICON_HOTSPOT.y / CURSOR_ICON_VIEWBOX_SIZE) * CURSOR_VISIBLE_SIZE,
} as const;
export const MAX_CURSOR_GAP_DIPS = 12;
export const MAX_FOLLOW_LAG_DIPS = 12;
export const CURSOR_DISCONTINUITY_DIPS = 160;
export const CURSOR_RESUME_SNAP_MS = 500;
export const CURSOR_EDGE_HYSTERESIS_DIPS = 8;

export interface FollowState {
  position: Point;
  velocity: Point;
}

export const SETTLE_DISTANCE_PX = 0.25;
export const SETTLE_SPEED_PX_PER_S = 2;
/** Longest single step honoured; a long stall is treated as a pause, not a leap. */
const MAX_STEP_SECONDS = 0.1;

export function createFollower(position: Point): FollowState {
  return { position: { ...position }, velocity: { x: 0, y: 0 } };
}

/** Advance one axis by dt seconds toward target. */
function stepAxis(
  x: number,
  v: number,
  target: number,
  dt: number,
  omega: number,
  zeta: number,
): [number, number] {
  const u0 = x - target;
  if (zeta >= 1) {
    const decay = Math.exp(-omega * dt);
    const c = v + omega * u0;
    return [target + (u0 + c * dt) * decay, (v - omega * c * dt) * decay];
  }
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * dt);
  const cos = Math.cos(omegaD * dt);
  const sin = Math.sin(omegaD * dt);
  const a = (v + zeta * omega * u0) / omegaD;
  const b = (zeta * omega * v + omega * omega * u0) / omegaD;
  return [target + decay * (u0 * cos + a * sin), decay * (v * cos - b * sin)];
}

export function stepFollower(
  state: FollowState,
  target: Point,
  dtSeconds: number,
  config: FollowConfig = DEFAULT_FOLLOW_CONFIG,
): FollowState {
  const dt = clamp(dtSeconds, 0, MAX_STEP_SECONDS);
  if (dt === 0) return state;
  const response = Math.max(0.02, config.responseSeconds / Math.max(0.05, config.speed));
  const omega = (2 * Math.PI) / response;
  const zeta = clamp(config.dampingRatio, 0.05, 1);
  const [px, vx] = stepAxis(state.position.x, state.velocity.x, target.x, dt, omega, zeta);
  const [py, vy] = stepAxis(state.position.y, state.velocity.y, target.y, dt, omega, zeta);
  return { position: { x: px, y: py }, velocity: { x: vx, y: vy } };
}

/** Keep the native-window anchor no more than 12 DIP from its expected point. */
export function stepFollowerBounded(
  state: FollowState,
  target: Point,
  dtSeconds: number,
  config: FollowConfig = DEFAULT_FOLLOW_CONFIG,
  maxLag = MAX_FOLLOW_LAG_DIPS,
): FollowState {
  const next = stepFollower(state, target, dtSeconds, { ...config, dampingRatio: 1 });
  const dx = next.position.x - target.x;
  const dy = next.position.y - target.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= maxLag || distance === 0) return next;
  const scale = maxLag / distance;
  return {
    position: { x: target.x + dx * scale, y: target.y + dy * scale },
    velocity: { x: 0, y: 0 },
  };
}

export function shouldSnapCursorFollower(input: {
  cursor: Point;
  previousCursor: Point | null;
  elapsedMs: number;
  displayChanged: boolean;
}): boolean {
  if (input.previousCursor === null || input.displayChanged || input.elapsedMs >= CURSOR_RESUME_SNAP_MS) return true;
  return Math.hypot(input.cursor.x - input.previousCursor.x, input.cursor.y - input.previousCursor.y) >= CURSOR_DISCONTINUITY_DIPS;
}

/** True once the follower is close enough and slow enough to stop animating. */
export function isSettled(state: FollowState, target: Point): boolean {
  return (
    Math.hypot(state.position.x - target.x, state.position.y - target.y) < SETTLE_DISTANCE_PX &&
    Math.hypot(state.velocity.x, state.velocity.y) < SETTLE_SPEED_PX_PER_S
  );
}

/** Snap to the target exactly, used when the follower settles. */
export function settle(target: Point): FollowState {
  return createFollower(target);
}

export interface CursorOrientation {
  /** Mirror the pointer horizontally so its hotspot remains nearest the cursor. */
  flipX: boolean;
  /** Mirror the pointer vertically so its hotspot remains nearest the cursor. */
  flipY: boolean;
}

export interface CursorPlacement extends CursorOrientation {
  position: Point;
}

export interface PlaceOptions {
  /** Small pointer-to-character gap in global DIP; its magnitude is capped at 12. */
  offset: Point;
  /** Companion size, so it is kept fully on screen. */
  size: Size;
  /** Gap kept to the display edge. */
  margin: number;
  /** Location of the visible cursor tip relative to the native window's top-left. */
  hotspot: Point;
  /** Avoid side flipping when the pointer crosses a display edge threshold. */
  hysteresis: number;
}

export const DEFAULT_PLACE_OPTIONS: PlaceOptions = {
  offset: { x: 8, y: 8 },
  size: { width: CURSOR_WINDOW_SIZE, height: CURSOR_WINDOW_SIZE },
  margin: 2,
  hotspot: CURSOR_WINDOW_HOTSPOT,
  hysteresis: CURSOR_EDGE_HYSTERESIS_DIPS,
};

/**
 * Place the cursor character by its actual visible SVG tip, not by its native
 * window corner. The window and pointer stay in Electron's global DIP space.
 */
export function placeCursorCompanion(
  cursor: Point,
  area: Rect,
  options: PlaceOptions = DEFAULT_PLACE_OPTIONS,
  previous?: CursorOrientation,
): CursorPlacement {
  const { offset, size, margin, hotspot } = options;
  const gapScale = Math.min(1, MAX_CURSOR_GAP_DIPS / Math.max(0.001, Math.hypot(offset.x, offset.y)));
  const gap = { x: offset.x * gapScale, y: offset.y * gapScale };
  const normalX = cursor.x + Math.abs(gap.x) - hotspot.x;
  const flippedX = cursor.x - Math.abs(gap.x) - (size.width - hotspot.x);
  const normalY = cursor.y + Math.abs(gap.y) - hotspot.y;
  const flippedY = cursor.y - Math.abs(gap.y) - (size.height - hotspot.y);
  const flipX = chooseFlip(
    normalX,
    flippedX,
    area.x,
    rectRight(area),
    size.width,
    margin,
    options.hysteresis,
    previous?.flipX,
    gap.x < 0,
  );
  const flipY = chooseFlip(
    normalY,
    flippedY,
    area.y,
    rectBottom(area),
    size.height,
    margin,
    options.hysteresis,
    previous?.flipY,
    gap.y < 0,
  );
  const inner: Rect = {
    x: area.x + margin,
    y: area.y + margin,
    width: area.width - 2 * margin - size.width,
    height: area.height - 2 * margin - size.height,
  };
  const clamped = clampPoint({ x: flipX ? flippedX : normalX, y: flipY ? flippedY : normalY }, inner, 0);
  return { position: clamped, flipX, flipY };
}

/** Backwards-compatible position-only helper for geometry callers. */
export function companionTarget(cursor: Point, area: Rect, options: PlaceOptions = DEFAULT_PLACE_OPTIONS): Point {
  return placeCursorCompanion(cursor, area, options).position;
}

function chooseFlip(
  normal: number,
  flipped: number,
  areaStart: number,
  areaEnd: number,
  size: number,
  margin: number,
  hysteresis: number,
  previous: boolean | undefined,
  preferredFlip: boolean,
): boolean {
  const fits = (position: number, extraMargin = 0): boolean =>
    position >= areaStart + margin + extraMargin && position + size <= areaEnd - margin - extraMargin;

  if (previous === true) return fits(normal, hysteresis) ? false : true;
  if (previous === false) return fits(normal) ? false : true;
  if (preferredFlip && fits(flipped)) return true;
  if (!preferredFlip && fits(normal)) return false;
  if (fits(normal)) return false;
  if (fits(flipped)) return true;
  return preferredFlip;
}

export function shouldShowCursorCompanion(input: {
  enabled: boolean;
  settingsOpen: boolean;
  workspaceFocused: boolean;
  sessionLocked: boolean;
}): boolean {
  // Cursor Buddy is its own desktop overlay; the focused Pixel Workspace is a
  // valid place to show it. Settings remains hidden so its native preview is
  // never confused with the real click-through desktop window.
  return input.enabled && !input.settingsOpen && !input.sessionLocked;
}

export type BubbleSide = 'right' | 'left' | 'above' | 'below';

export interface BubblePlacement {
  position: Point;
  side: BubbleSide;
}

/**
 * Place a speech bubble beside the companion on whichever side it fits,
 * preferring right, then below, left, above. If nothing fits fully, the side
 * with the most room is used and the bubble is clamped on screen.
 */
export function placeBubble(
  companion: Rect,
  bubble: Size,
  area: Rect,
  gap = 10,
  margin = 8,
): BubblePlacement {
  const candidates: Array<{ side: BubbleSide; position: Point }> = [
    { side: 'right', position: { x: rectRight(companion) + gap, y: companion.y } },
    { side: 'below', position: { x: companion.x, y: rectBottom(companion) + gap } },
    { side: 'left', position: { x: companion.x - gap - bubble.width, y: companion.y } },
    { side: 'above', position: { x: companion.x, y: companion.y - gap - bubble.height } },
  ];

  const fits = (p: Point): boolean =>
    p.x >= area.x + margin &&
    p.y >= area.y + margin &&
    p.x + bubble.width <= rectRight(area) - margin &&
    p.y + bubble.height <= rectBottom(area) - margin;

  const exact = candidates.find((c) => fits(c.position));
  if (exact) return exact;

  // Nothing fits: take the side with the least overflow and pull it on screen.
  const overflow = (p: Point): number =>
    Math.max(0, area.x + margin - p.x) +
    Math.max(0, area.y + margin - p.y) +
    Math.max(0, p.x + bubble.width - (rectRight(area) - margin)) +
    Math.max(0, p.y + bubble.height - (rectBottom(area) - margin));
  const best = candidates.reduce((a, b) => (overflow(b.position) < overflow(a.position) ? b : a));
  return {
    side: best.side,
    position: {
      x: clamp(best.position.x, area.x + margin, rectRight(area) - margin - bubble.width),
      y: clamp(best.position.y, area.y + margin, rectBottom(area) - margin - bubble.height),
    },
  };
}
