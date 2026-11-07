import type { AssistantState } from './types';

/**
 * Signals from the renderer's existing conversation, task, voice, and permission
 * flows. Keeping the priority rule in one pure function prevents those systems
 * from presenting contradictory orb states.
 */
export interface CompanionStateSignals {
  stopped: boolean;
  permission: boolean;
  streaming: boolean;
  hasAnswer: boolean;
  error: boolean;
  listening: boolean;
  /** A task is planning/running in the existing TaskManager flow. */
  executing?: boolean;
  /** Local speech playback is currently in progress. */
  speaking?: boolean;
  /** Reserved for the screen-guidance flow when it is wired into the UI. */
  pointing?: boolean;
}

/** Resolve one authoritative visual state from current UI/runtime signals. */
export function deriveAssistantState(input: CompanionStateSignals): AssistantState {
  if (input.stopped) return 'stopped';
  if (input.permission) return 'waiting_for_approval';
  if (input.error) return 'error';
  if (input.pointing) return 'pointing';
  if (input.executing) return 'executing';
  if (input.listening) return 'listening';
  if (input.speaking) return 'speaking';
  if (input.streaming) return input.hasAnswer ? 'responding' : 'thinking';
  return 'idle';
}
