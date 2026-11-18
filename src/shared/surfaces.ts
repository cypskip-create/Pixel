/**
 * Geometry of the floating companion surfaces.
 *
 * Shared because both processes care: the main process uses safe fallback
 * sizes and the renderer reports one fixed size per deliberate surface change.
 * Content streaming never becomes native-window geometry.
 *
 * These numbers are deliberately small. Pixel is a companion that floats at the
 * top of the screen, not a dashboard and not a chat application. The fixed
 * surface geometry keeps the interactive width at or below 520 logical px.
 */

import type { Surface } from './types';

export interface SurfaceSize {
  width: number;
  height: number;
}

export const SURFACE_SIZES: Record<Surface, SurfaceSize> = {
  hidden: { width: 144, height: 52 },
  // The visible pill is 144×38; the remaining 14px is breathing room above it.
  idle: { width: 144, height: 52 },
  active: { width: 480, height: 190 },
  bubble: { width: 480, height: 460 },
  task: { width: 480, height: 320 },
};

/** Gap between the top of the work area and the idle orb. */
export const DEFAULT_OFFSET_FROM_TOP = 12;

/** The compact input bar width, referenced by the UI and by tests. */
export const INPUT_BAR_WIDTH = 460;
