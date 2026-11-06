import type { Surface } from '@shared/types';

/**
 * The surface state machine.
 *
 * Declared as an explicit table rather than scattered booleans, so the allowed
 * transitions are reviewable in one place. `hidden` is driven by the native
 * shell (the window is not even visible), which is why it can only be entered
 * from `idle` and always returns to `idle`.
 */
export const TRANSITIONS: Record<Surface, readonly Surface[]> = {
  hidden: ['idle'],
  idle: ['hidden', 'active'],
  // `active` is the compact input bar. It may reveal the permission card or a
  // long-running task, but a permission prompt never appears over `hidden`.
  active: ['idle', 'bubble', 'task'],
  // `bubble` shows a streaming/streamed answer.
  bubble: ['idle', 'active'],
  // `task` shows the progress rail.
  task: ['idle', 'active'],
};

export function canTransition(from: Surface, to: Surface): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Priority resolver.
 *
 * Several things may want the surface at once (a permission prompt arrives
 * while an answer is streaming). Rather than fight over it, each condition has
 * a rank and the highest wins. Idle is the floor.
 */
export function resolveSurface(input: {
  windowHidden: boolean;
  hasPermission: boolean;
  hasActiveTask: boolean;
  bubbleVisible: boolean;
  inputOpen: boolean;
}): Surface {
  if (input.windowHidden) return 'hidden';
  if (input.hasPermission) return 'active';
  if (input.hasActiveTask) return 'task';
  if (input.bubbleVisible) return 'bubble';
  if (input.inputOpen) return 'active';
  return 'idle';
}
