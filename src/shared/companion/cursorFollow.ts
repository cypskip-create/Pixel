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
  responseSeconds: 0.22,
  dampingRatio: 0.78,
  speed: 1,
};

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

export interface PlaceOptions {
  /** Offset from the cursor to the companion's top-left, in DIP. */
  offset: Point;
  /** Companion size, so it is kept fully on screen. */
  size: Size;
  /** Gap kept to the display edge. */
  margin: number;
}

export const DEFAULT_PLACE_OPTIONS: PlaceOptions = {
  offset: { x: 22, y: 20 },
  size: { width: 36, height: 36 },
  margin: 8,
};

/**
 * Where the companion's top-left should rest for a given cursor position.
 *
 * It sits at the configured offset, but flips to the other side of the cursor
 * when that would push it past the right or bottom edge, so it never covers the
 * pointer or hangs off-screen. The result is always clamped into `area`.
 */
export function companionTarget(cursor: Point, area: Rect, options: PlaceOptions = DEFAULT_PLACE_OPTIONS): Point {
  const { offset, size, margin } = options;
  let x = cursor.x + offset.x;
  let y = cursor.y + offset.y;

  if (x + size.width > rectRight(area) - margin) x = cursor.x - offset.x - size.width;
  if (y + size.height > rectBottom(area) - margin) y = cursor.y - offset.y - size.height;

  const inner: Rect = {
    x: area.x + margin,
    y: area.y + margin,
    width: Math.max(0, area.width - 2 * margin - size.width),
    height: Math.max(0, area.height - 2 * margin - size.height),
  };
  const clamped = clampPoint({ x, y }, inner, 0);
  return clamped;
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