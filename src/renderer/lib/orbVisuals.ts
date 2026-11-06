import type { AssistantState } from '@shared/types';

/**
 * Per-state visual programme.
 *
 * Every state differs along at least three axes so that colour blindness,
 * monochrome displays and small sizes cannot collapse two states together:
 *
 *   tone    - hue (redundant signal, never the only one)
 *   shape   - the silhouette drawn inside the orb
 *   motion  - the animation applied (suppressed under reduced motion)
 *   label   - the accessible name announced to screen readers
 *
 * Marks are drawn on a 24x24 viewBox.
 */
export type OrbMark =
  | { kind: 'circle'; r: number }
  | { kind: 'ring'; r: number; width: number }
  | { kind: 'path'; d: string; width: number }
  | { kind: 'bars'; widths: number[] };

export interface OrbVisual {
  /** Accessible name, also used as the tooltip. */
  label: string;
  /** One-line human description shown in menus. */
  blurb: string;
  /** CSS colour for the orb's core glow. */
  tone: string;
  /** Silhouette family: drives the inner mark. */
  shape: 'core' | 'ring' | 'diamond' | 'wave' | 'gear' | 'check' | 'cross' | 'pause';
  /** CSS animation class from index.css ('' = static). */
  motion: string;
  /** Whether this state represents ongoing background work. */
  busy: boolean;
  /** Inner mark geometry. */
  mark: OrbMark;
}

export const ORB_VISUALS: Record<AssistantState, OrbVisual> = {
  idle: {
    label: 'Idle',
    blurb: 'Waiting for you. Nothing is running.',
    tone: 'var(--color-state-idle)',
    shape: 'core',
    motion: 'orb-breathe',
    busy: false,
    mark: { kind: 'circle', r: 5.5 },
  },
  listening: {
    label: 'Listening',
    blurb: 'Picking up your voice right now.',
    tone: 'var(--color-state-listening)',
    shape: 'ring',
    motion: 'orb-pulse',
    busy: true,
    mark: { kind: 'ring', r: 7.5, width: 2.4 },
  },
  thinking: {
    label: 'Thinking',
    blurb: 'Reasoning about your request.',
    tone: 'var(--color-state-thinking)',
    shape: 'diamond',
    motion: 'orb-spin',
    busy: true,
    mark: { kind: 'path', d: 'M12 3.2 20.8 12 12 20.8 3.2 12Z', width: 2.2 },
  },
  speaking: {
    label: 'Speaking',
    blurb: 'Answering - the response is streaming in.',
    tone: 'var(--color-state-speaking)',
    shape: 'wave',
    motion: 'orb-sheen',
    busy: true,
    mark: { kind: 'bars', widths: [1.9, 3.4, 2.4] },
  },
  working: {
    label: 'Working',
    blurb: 'Running steps on your computer.',
    tone: 'var(--color-state-working)',
    shape: 'gear',
    motion: 'orb-spin',
    busy: true,
    mark: {
      kind: 'path',
      d: 'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8ZM12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8M18.6 18.6l-1.8-1.8M7.2 7.2 5.4 5.4',
      width: 2,
    },
  },
  success: {
    label: 'Done',
    blurb: 'Finished successfully.',
    tone: 'var(--color-state-success)',
    shape: 'check',
    motion: '',
    busy: false,
    mark: { kind: 'path', d: 'M5 12.8L9.6 17.4L19 8', width: 2.6 },
  },
  error: {
    label: 'Error',
    blurb: 'Something went wrong.',
    tone: 'var(--color-state-error)',
    shape: 'cross',
    motion: 'orb-jitter',
    busy: false,
    mark: { kind: 'path', d: 'M7 7L17 17M17 7L7 17', width: 2.6 },
  },
  paused: {
    label: 'Paused',
    blurb: 'Stopped. Pixel will not act until you resume.',
    tone: 'var(--color-state-paused)',
    shape: 'pause',
    motion: '',
    busy: false,
    mark: { kind: 'bars', widths: [2.2, 2.2] },
  },
};

export function orbVisual(state: AssistantState): OrbVisual {
  return ORB_VISUALS[state];
}
