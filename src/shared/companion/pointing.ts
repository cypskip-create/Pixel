import {
  fromWindowRelative,
  mapImagePointToGlobal,
  toWindowRelative,
  type Point,
  type Rect,
  type Size,
} from './geometry';

/**
 * Visual pointing: where Pixel says a control is, how sure it is, and how the
 * companion flies there.
 *
 * Pointing never clicks. A PointTarget only says "look here"; any action on the
 * target still goes through the normal tool and approval path.
 */

/** How a target was found, which decides how far to trust it. */
export type TargetSource = 'ui_automation' | 'vision' | 'manual';

export type TargetConfidence =
  /** Read from the accessibility tree: an element with a real bounding box. */
  | 'verified'
  /** Estimated from pixels by a model. Never presented as certain. */
  | 'unverified';

export interface PointTarget {
  /** Global DIP position of the point to indicate (the element's centre). */
  point: Point;
  /** The element's rectangle when known; lets the highlight match its size. */
  bounds?: Rect;
  label: string;
  source: TargetSource;
  confidence: TargetConfidence;
  /** The window the target lives in, so guidance can follow it if it moves. */
  windowRect?: Rect;
  /** Target position as a fraction of its window, captured when it was found. */
  windowRelative?: Point;
}

export function confidenceFor(source: TargetSource): TargetConfidence {
  // Only a native accessibility hit counts as verified. A model's coordinates
  // are a guess until something independent confirms them.
  return source === 'ui_automation' ? 'verified' : 'unverified';
}

export function makeTarget(input: {
  point: Point;
  label: string;
  source: TargetSource;
  bounds?: Rect;
  windowRect?: Rect;
}): PointTarget {
  return {
    point: input.point,
    label: input.label.trim().slice(0, 60),
    source: input.source,
    confidence: confidenceFor(input.source),
    ...(input.bounds ? { bounds: input.bounds } : {}),
    ...(input.windowRect
      ? { windowRect: input.windowRect, windowRelative: toWindowRelative(input.point, input.windowRect) }
      : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Vision output -> targets
 * ------------------------------------------------------------------ */

export type VisionParse =
  | { kind: 'none' }
  | { kind: 'single'; target: PointTarget }
  | { kind: 'ambiguous'; candidates: PointTarget[] }
  | { kind: 'invalid'; reason: string };

/** Largest number of candidates ever shown to the user. */
export const MAX_CANDIDATES = 4;

/**
 * Turn a vision model's JSON answer into targets.
 *
 * Expected shape: `{"targets":[{"x":123,"y":45,"label":"Save"}]}` where x/y are
 * pixels in the image that was sent. `region` is the global DIP rectangle that
 * image covered (a display or a window), which is how crop offset, monitor origin
 * and DPI are all accounted for. Anything malformed or out of bounds is refused
 * instead of being repaired into a plausible-looking wrong location.
 */
export function parseVisionTargets(raw: string, image: Size, region: Rect, windowRect?: Rect): VisionParse {
  const jsonText = extractJson(raw);
  if (jsonText === null) return { kind: 'invalid', reason: 'The model did not return JSON.' };

  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { kind: 'invalid', reason: 'The model returned malformed JSON.' };
  }

  const list = (data as { targets?: unknown }).targets;
  if (!Array.isArray(list)) return { kind: 'invalid', reason: 'The answer had no "targets" list.' };
  if (list.length === 0) return { kind: 'none' };

  const targets: PointTarget[] = [];
  for (const item of list.slice(0, MAX_CANDIDATES)) {
    const entry = item as { x?: unknown; y?: unknown; label?: unknown };
    if (typeof entry.x !== 'number' || typeof entry.y !== 'number') continue;
    const mapped = mapImagePointToGlobal({ x: entry.x, y: entry.y }, image, region);
    if (!mapped) continue;
    targets.push(
      makeTarget({
        point: mapped.point,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : 'this',
        source: 'vision',
        windowRect,
      }),
    );
  }

  if (targets.length === 0) {
    return { kind: 'invalid', reason: 'None of the coordinates fell inside the screenshot.' };
  }
  return targets.length === 1
    ? { kind: 'single', target: targets[0]! }
    : { kind: 'ambiguous', candidates: targets };
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

/* ------------------------------------------------------------------ *
 * Keeping a target honest while the user works
 * ------------------------------------------------------------------ */

export type TargetStatus =
  | { status: 'present'; target: PointTarget }
  | { status: 'moved'; target: PointTarget }
  | { status: 'gone' };

/** What a re-probe of the target found. */
export interface TargetProbe {
  /** The window's rectangle now, or null if the window no longer exists. */
  windowRect: Rect | null;
  /** The element's rectangle now (UI Automation), or null when it is gone. */
  elementBounds?: Rect | null;
  /** Whether the window is minimised or hidden. */
  windowVisible?: boolean;
}

const MOVE_EPSILON_PX = 2;

/**
 * Decide whether guidance should continue, follow a moved target, or stop.
 *
 * - The window disappeared, is hidden, or the element vanished: `gone`, and the
 *   caller must stop pointing rather than keep indicating an empty spot.
 * - A verified element reports new bounds: use them directly.
 * - Otherwise, if the window moved or was resized, keep the same relative
 *   position inside it.
 */
export function reconcileTarget(target: PointTarget, probe: TargetProbe): TargetStatus {
  if (probe.windowRect === null || probe.windowVisible === false) return { status: 'gone' };

  if (target.confidence === 'verified' && probe.elementBounds !== undefined) {
    if (probe.elementBounds === null) return { status: 'gone' };
    const centre = {
      x: probe.elementBounds.x + probe.elementBounds.width / 2,
      y: probe.elementBounds.y + probe.elementBounds.height / 2,
    };
    const moved = Math.hypot(centre.x - target.point.x, centre.y - target.point.y) > MOVE_EPSILON_PX;
    const next: PointTarget = { ...target, point: centre, bounds: probe.elementBounds, windowRect: probe.windowRect };
    return { status: moved ? 'moved' : 'present', target: next };
  }

  if (target.windowRect && target.windowRelative) {
    const point = fromWindowRelative(target.windowRelative, probe.windowRect);
    const moved = Math.hypot(point.x - target.point.x, point.y - target.point.y) > MOVE_EPSILON_PX;
    return {
      status: moved ? 'moved' : 'present',
      target: { ...target, point, windowRect: probe.windowRect },
    };
  }

  return { status: 'present', target };
}

/* ------------------------------------------------------------------ *
 * Flight path
 * ------------------------------------------------------------------ */

export interface FlightPlan {
  start: Point;
  control: Point;
  end: Point;
  durationSeconds: number;
}

const FLIGHT_MIN_SECONDS = 0.45;
const FLIGHT_MAX_SECONDS = 1.2;
const FLIGHT_PX_PER_SECOND = 1100;
const FLIGHT_ARC_FRACTION = 0.18;
const FLIGHT_ARC_MAX_PX = 90;

/** Plan a curved flight: longer hops take longer, and arc a little upward. */
export function planFlight(start: Point, end: Point): FlightPlan {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const arc = Math.min(distance * FLIGHT_ARC_FRACTION, FLIGHT_ARC_MAX_PX);
  return {
    start,
    end,
    control: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - arc },
    durationSeconds: Math.min(
      Math.max(distance / FLIGHT_PX_PER_SECOND, FLIGHT_MIN_SECONDS),
      FLIGHT_MAX_SECONDS,
    ),
  };
}

/** Smooth start and finish (smootherstep) so the flight eases in and out. */
export function ease(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

/** Position along the flight at elapsed seconds. Hits `end` exactly at the finish. */
export function flightPosition(plan: FlightPlan, elapsedSeconds: number): Point {
  const t = ease(elapsedSeconds / plan.durationSeconds);
  const u = 1 - t;
  return {
    x: u * u * plan.start.x + 2 * u * t * plan.control.x + t * t * plan.end.x,
    y: u * u * plan.start.y + 2 * u * t * plan.control.y + t * t * plan.end.y,
  };
}

/** Heading in radians at a point on the flight, for rotating the companion. */
export function flightHeading(plan: FlightPlan, elapsedSeconds: number): number {
  const t = ease(elapsedSeconds / plan.durationSeconds);
  const u = 1 - t;
  const dx = 2 * u * (plan.control.x - plan.start.x) + 2 * t * (plan.end.x - plan.control.x);
  const dy = 2 * u * (plan.control.y - plan.start.y) + 2 * t * (plan.end.y - plan.control.y);
  return Math.atan2(dy, dx);
}

/** Park the companion beside the target instead of on top of it. */
export function restingPointBeside(target: PointTarget, area: Rect, offset: Point = { x: 14, y: 18 }): Point {
  const x = Math.min(Math.max(target.point.x + offset.x, area.x + 16), area.x + area.width - 16);
  const y = Math.min(Math.max(target.point.y + offset.y, area.y + 16), area.y + area.height - 16);
  return { x, y };
}