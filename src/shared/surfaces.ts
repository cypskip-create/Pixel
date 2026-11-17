/**
 * Geometry of the floating companion surfaces.
 *
 * Shared because both processes care: the main process supplies safe fallback
 * sizes while the renderer reports the measured visible panel stack. Keeping
 * one table prevents the native shell and renderer from drifting apart.
 *
 * These numbers are deliberately small. Pixel is a companion that floats at the
 * top of the screen, not a dashboard and not a chat application. The measured
 * layout controller keeps the interactive width at or below 520 logical px.
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
export const DEFAULT_OFFSET_FROM_TOP = 12;

/** The compact input bar width, referenced by the UI and by tests. */
export const INPUT_BAR_WIDTH = 460;
