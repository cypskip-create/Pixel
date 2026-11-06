/**
 * Geometry of the floating companion surfaces.
 *
 * Shared because both processes care: the main process sizes the window and the
 * renderer lays content out to match. Keeping one table prevents the two from
 * drifting, which would show up as clipped or floating text.
 *
 * These numbers are deliberately small. Cyps is a companion that floats at the
 * top of the screen, not a dashboard and not a chat application: the largest
 * surface is 480px wide.
 */

import type { Surface } from './types';

export interface SurfaceSize {
  width: number;
  height: number;
}

export const SURFACE_SIZES: Record<Surface, SurfaceSize> = {
  hidden: { width: 96, height: 96 },
  idle: { width: 96, height: 96 },
  active: { width: 480, height: 180 },
  bubble: { width: 480, height: 460 },
  task: { width: 480, height: 300 },
};

/** Gap between the top of the work area and the idle orb. */
export const DEFAULT_OFFSET_FROM_TOP = 16;

/** The compact input bar width, referenced by the UI and by tests. */
export const INPUT_BAR_WIDTH = 460;
