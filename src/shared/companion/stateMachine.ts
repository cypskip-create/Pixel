/**
 * The single authority on what the companion is doing.
 *
 * Before this module the renderer derived the orb state from a handful of
 * independent booleans, and "waiting for approval" was drawn as "listening".
 * Everything that animates, speaks or hides the companion now reads the state
 * computed here, and everything that changes it goes through `reduce`.
 *
 * Design: the context holds small independent facts (is a request in flight? is
 * speech playing? is a tool running?). The visible state is *derived* from them
 * by `deriveAssistantState` in `../companion-state`, the one place that defines
 * the priority order, so two facts can be true at once (speech playing while a
 * pointer animation runs) without two state variables disagreeing. This module
 * adds what that function does not have: validated transitions, the side effects
 * each transition requires, and the "may the companion hide?" rules.
 * Side effects the caller must perform (cancel the request, stop speech) are
 * returned as data, which keeps this module pure and unit-testable.
 *
 * Pure TypeScript, no Electron or DOM imports, so it runs in both processes.
 */

import { deriveAssistantState } from '../companion-state';

export const COMPANION_STATES = [
  'idle',
  'listening',
  'thinking',
  'responding',
  'speaking',
  'pointing',
  'executing',
  'waiting_for_approval',
  'error',
  'stopped',
] as const;
export type CompanionState = (typeof COMPANION_STATES)[number];

export interface CompanionContext {
  /** Emergency stop is latched. Nothing but STOP_CLEARED changes anything. */
  stopped: boolean;
  /** An approval card is on screen and the agent is blocked on it. */
  approvalPending: boolean;
  /** The microphone is capturing a request. */
  listening: boolean;
  /** A request is in flight (model working or about to answer). */
  requestActive: boolean;
  /** Answer text is streaming in. */
  streaming: boolean;
  /** Number of tools currently running. */
  toolsRunning: number;
  /** Text-to-speech is playing. */
  speaking: boolean;
  /** The companion is flying to / pointing at an on-screen target. */
  pointing: boolean;
  /** Last failure, shown until dismissed or a new request starts. */
  error: string | null;
  /** Time of the last state-relevant event. Drives idle timeouts. */
  lastActivityAt: number;
}

export const INITIAL_CONTEXT: CompanionContext = {
  stopped: false,
  approvalPending: false,
  listening: false,
  requestActive: false,
  streaming: false,
  toolsRunning: 0,
  speaking: false,
  pointing: false,
  error: null,
  lastActivityAt: 0,
};

export type CompanionEvent =
  | { type: 'LISTEN_START'; at: number }
  | { type: 'LISTEN_END'; at: number; heardSpeech: boolean }
  | { type: 'SUBMIT'; at: number }
  | { type: 'STREAM_DELTA'; at: number }
  | { type: 'TOOL_START'; at: number }
  | { type: 'TOOL_END'; at: number }
  | { type: 'APPROVAL_REQUESTED'; at: number }
  | { type: 'APPROVAL_RESOLVED'; at: number }
  | { type: 'SPEECH_START'; at: number }
  | { type: 'SPEECH_END'; at: number }
  | { type: 'POINT_START'; at: number }
  | { type: 'POINT_END'; at: number }
  | { type: 'RUN_COMPLETE'; at: number }
  | { type: 'CANCELLED'; at: number }
  | { type: 'FAILED'; at: number; reason: string }
  | { type: 'DISMISS_ERROR'; at: number }
  | { type: 'EMERGENCY_STOP'; at: number }
  | { type: 'STOP_CLEARED'; at: number };

/** Work the caller must do as a result of a transition. */
export type CompanionEffect = 'cancel_request' | 'stop_speech' | 'cancel_pointing';

export interface Transition {
  context: CompanionContext;
  effects: CompanionEffect[];
  /** False when the event was refused (for tests and diagnostics). */
  accepted: boolean;
}

/**
 * Visible state. The priority order lives in `deriveAssistantState` so there is
 * exactly one definition; this adapts the machine's facts to its inputs.
 */
export function deriveCompanionState(c: CompanionContext): CompanionState {
  const state = deriveAssistantState({
    stopped: c.stopped,
    permission: c.approvalPending,
    error: c.error !== null,
    listening: c.listening,
    streaming: c.requestActive,
    hasAnswer: c.streaming,
    executing: c.toolsRunning > 0,
    speaking: c.speaking,
    pointing: c.pointing,
  });
  // deriveAssistantState can only return these ten; the three legacy orb names
  // (success, working, paused) are never produced from these signals.
  return (COMPANION_STATES as readonly string[]).includes(state) ? (state as CompanionState) : 'idle';
}

const CLEAR_REQUEST: Partial<CompanionContext> = {
  requestActive: false,
  streaming: false,
  toolsRunning: 0,
};

function touch(c: CompanionContext, at: number, patch: Partial<CompanionContext>): CompanionContext {
  return { ...c, ...patch, lastActivityAt: at };
}

function refuse(c: CompanionContext): Transition {
  return { context: c, effects: [], accepted: false };
}

/**
 * Apply one event. Never throws; an event that does not make sense in the
 * current context is refused and leaves the context unchanged.
 */
export function reduce(c: CompanionContext, event: CompanionEvent): Transition {
  // Emergency stop outranks everything and is the only thing that can end it.
  if (event.type === 'EMERGENCY_STOP') {
    return {
      context: touch(c, event.at, {
        ...CLEAR_REQUEST,
        stopped: true,
        approvalPending: false,
        listening: false,
        speaking: false,
        pointing: false,
        error: null,
      }),
      effects: ['cancel_request', 'stop_speech', 'cancel_pointing'],
      accepted: true,
    };
  }
  if (event.type === 'STOP_CLEARED') {
    return c.stopped
      ? { context: touch(c, event.at, { stopped: false }), effects: [], accepted: true }
      : refuse(c);
  }
  if (c.stopped) return refuse(c);

  switch (event.type) {
    case 'LISTEN_START': {
      // An approval must be answered first; it cannot be talked over.
      if (c.approvalPending) return refuse(c);
      // Pressing talk interrupts whatever Pixel was doing (barge-in).
      const effects: CompanionEffect[] = [];
      if (c.requestActive || c.toolsRunning > 0) effects.push('cancel_request');
      if (c.speaking) effects.push('stop_speech');
      if (c.pointing) effects.push('cancel_pointing');
      return {
        context: touch(c, event.at, {
          ...CLEAR_REQUEST,
          listening: true,
          speaking: false,
          pointing: false,
          error: null,
        }),
        effects,
        accepted: true,
      };
    }

    case 'LISTEN_END':
      if (!c.listening) return refuse(c);
      return {
        context: touch(c, event.at, {
          listening: false,
          requestActive: event.heardSpeech,
        }),
        effects: [],
        accepted: true,
      };

    case 'SUBMIT': {
      if (c.approvalPending) return refuse(c);
      const effects: CompanionEffect[] = [];
      if (c.requestActive || c.toolsRunning > 0) effects.push('cancel_request');
      if (c.speaking) effects.push('stop_speech');
      if (c.pointing) effects.push('cancel_pointing');
      return {
        context: touch(c, event.at, {
          ...CLEAR_REQUEST,
          requestActive: true,
          listening: false,
          speaking: false,
          pointing: false,
          error: null,
        }),
        effects,
        accepted: true,
      };
    }

    case 'STREAM_DELTA':
      if (!c.requestActive) return refuse(c);
      return { context: touch(c, event.at, { streaming: true }), effects: [], accepted: true };

    case 'TOOL_START':
      if (!c.requestActive) return refuse(c);
      return {
        context: touch(c, event.at, { toolsRunning: c.toolsRunning + 1 }),
        effects: [],
        accepted: true,
      };

    case 'TOOL_END':
      if (c.toolsRunning === 0) return refuse(c);
      return {
        context: touch(c, event.at, { toolsRunning: c.toolsRunning - 1 }),
        effects: [],
        accepted: true,
      };

    case 'APPROVAL_REQUESTED':
      if (!c.requestActive) return refuse(c);
      return { context: touch(c, event.at, { approvalPending: true }), effects: [], accepted: true };

    case 'APPROVAL_RESOLVED':
      if (!c.approvalPending) return refuse(c);
      return { context: touch(c, event.at, { approvalPending: false }), effects: [], accepted: true };

    case 'SPEECH_START':
      return { context: touch(c, event.at, { speaking: true }), effects: [], accepted: true };

    case 'SPEECH_END':
      return { context: touch(c, event.at, { speaking: false }), effects: [], accepted: true };

    case 'POINT_START':
      return { context: touch(c, event.at, { pointing: true }), effects: [], accepted: true };

    case 'POINT_END':
      return { context: touch(c, event.at, { pointing: false }), effects: [], accepted: true };

    case 'RUN_COMPLETE':
      return { context: touch(c, event.at, { ...CLEAR_REQUEST }), effects: [], accepted: true };

    case 'CANCELLED':
      return {
        context: touch(c, event.at, {
          ...CLEAR_REQUEST,
          approvalPending: false,
          listening: false,
          pointing: false,
        }),
        effects: ['stop_speech', 'cancel_pointing'],
        accepted: true,
      };

    case 'FAILED':
      return {
        context: touch(c, event.at, {
          ...CLEAR_REQUEST,
          approvalPending: false,
          listening: false,
          speaking: false,
          pointing: false,
          error: event.reason,
        }),
        effects: ['stop_speech', 'cancel_pointing'],
        accepted: true,
      };

    case 'DISMISS_ERROR':
      return c.error === null
        ? refuse(c)
        : { context: touch(c, event.at, { error: null }), effects: [], accepted: true };
  }
}

/**
 * May the companion disappear right now? Used by transient mode and by anything
 * that wants to hide the orb. It must never vanish mid-task, while an approval
 * is waiting, while the user is being listened to, or while speech is playing.
 */
export function canHide(c: CompanionContext): boolean {
  return (
    !c.stopped &&
    !c.approvalPending &&
    !c.listening &&
    !c.requestActive &&
    !c.streaming &&
    c.toolsRunning === 0 &&
    !c.speaking &&
    !c.pointing &&
    c.error === null
  );
}

/** Has the companion been quiet long enough to fade out? */
export function shouldAutoHide(c: CompanionContext, now: number, idleMs: number): boolean {
  return canHide(c) && now - c.lastActivityAt >= idleMs;
}

/** How a companion state is announced to assistive technology. */
export const COMPANION_ANNOUNCEMENTS: Record<CompanionState, { label: string; live: 'off' | 'polite' | 'assertive' }> = {
  idle: { label: 'Pixel is idle', live: 'off' },
  listening: { label: 'Pixel is listening', live: 'polite' },
  thinking: { label: 'Pixel is thinking', live: 'polite' },
  responding: { label: 'Pixel is answering', live: 'off' },
  speaking: { label: 'Pixel is speaking', live: 'off' },
  pointing: { label: 'Pixel is pointing at something on your screen', live: 'polite' },
  executing: { label: 'Pixel is working on your computer', live: 'polite' },
  waiting_for_approval: { label: 'Pixel needs your approval', live: 'assertive' },
  error: { label: 'Pixel ran into a problem', live: 'assertive' },
  stopped: { label: 'Pixel is stopped', live: 'assertive' },
};