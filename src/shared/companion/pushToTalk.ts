/**
 * Push-to-talk session control.
 *
 * Holding a key to talk looks simple and is full of races:
 *   - the key is released while the microphone permission check is still running;
 *   - it is released while the audio session is still starting;
 *   - Windows auto-repeats key-down events while the key is held;
 *   - a new press arrives while the previous clip is still being transcribed;
 *   - the app loses focus mid-press and the key-up never arrives.
 * Getting any of these wrong leaves a microphone recording nobody asked for, or a
 * session that never ends. This module is a pure state machine so each case is
 * tested without a microphone.
 *
 * The caller performs the returned effects and feeds the outcomes back as events.
 * Nothing here touches audio hardware, and the microphone is only ever opened as
 * a response to a `start_session` effect that follows a real key press.
 */

export type PttPhase =
  /** Not recording. */
  | 'idle'
  /** Key is down; permission check / audio session start in progress. */
  | 'arming'
  /** The microphone is capturing. */
  | 'recording'
  /** Key released; waiting for the final transcript. */
  | 'finalizing';

export interface PttState {
  phase: PttPhase;
  /** Incremented per press; late callbacks from an older press are ignored. */
  session: number;
  /** True once a release arrived before recording began. */
  releasedWhileArming: boolean;
  /** Last reason a session ended without a transcript, for the UI. */
  lastIssue: PttIssue | null;
}

export type PttIssue = 'permission_denied' | 'no_speech' | 'too_short' | 'timeout' | 'device_error' | 'cancelled';

export const INITIAL_PTT: PttState = {
  phase: 'idle',
  session: 0,
  releasedWhileArming: false,
  lastIssue: null,
};

export type PttEvent =
  | { type: 'KEY_DOWN' }
  | { type: 'KEY_UP' }
  /** The permission check and audio session finished starting. */
  | { type: 'SESSION_READY'; session: number }
  | { type: 'PERMISSION_DENIED'; session: number }
  | { type: 'DEVICE_ERROR'; session: number }
  | { type: 'TRANSCRIPT'; session: number; text: string }
  /** Focus changed, the window closed or another request took over. */
  | { type: 'INTERRUPT' }
  /** The finalize or arm step took too long. */
  | { type: 'TIMEOUT'; session: number };

export type PttEffect =
  | { type: 'start_session'; session: number }
  | { type: 'stop_recording'; session: number }
  | { type: 'cancel_session'; session: number }
  | { type: 'deliver_transcript'; session: number; text: string }
  | { type: 'notify'; issue: PttIssue };

export interface PttTransition {
  state: PttState;
  effects: PttEffect[];
}

/** Clips shorter than this are treated as an accidental tap, not a request. */
export const MIN_TRANSCRIPT_CHARS = 2;

function end(state: PttState, issue: PttIssue | null, effects: PttEffect[] = []): PttTransition {
  return {
    state: { ...state, phase: 'idle', releasedWhileArming: false, lastIssue: issue },
    effects: issue ? [...effects, { type: 'notify', issue }] : effects,
  };
}

export function pttReduce(state: PttState, event: PttEvent): PttTransition {
  switch (event.type) {
    case 'KEY_DOWN': {
      // Key auto-repeat while held, or a press while still transcribing the last
      // one: ignore rather than start a second overlapping session.
      if (state.phase !== 'idle') return { state, effects: [] };
      const session = state.session + 1;
      return {
        state: { phase: 'arming', session, releasedWhileArming: false, lastIssue: null },
        effects: [{ type: 'start_session', session }],
      };
    }

    case 'KEY_UP': {
      if (state.phase === 'arming') {
        // Released before recording began. Remember it so recording is cancelled
        // the moment the session is ready, instead of recording indefinitely.
        return { state: { ...state, releasedWhileArming: true }, effects: [] };
      }
      if (state.phase === 'recording') {
        return {
          state: { ...state, phase: 'finalizing' },
          effects: [{ type: 'stop_recording', session: state.session }],
        };
      }
      return { state, effects: [] };
    }

    case 'SESSION_READY': {
      if (event.session !== state.session || state.phase !== 'arming') {
        // A late callback for a press that no longer exists: shut that session down.
        return { state, effects: [{ type: 'cancel_session', session: event.session }] };
      }
      if (state.releasedWhileArming) {
        // The user already let go. Treat as an aborted press, not a recording.
        return end(state, 'too_short', [{ type: 'cancel_session', session: state.session }]);
      }
      return { state: { ...state, phase: 'recording' }, effects: [] };
    }

    case 'PERMISSION_DENIED':
      if (event.session !== state.session || state.phase === 'idle') return { state, effects: [] };
      return end(state, 'permission_denied');

    case 'DEVICE_ERROR':
      if (event.session !== state.session || state.phase === 'idle') return { state, effects: [] };
      return end(state, 'device_error', [{ type: 'cancel_session', session: state.session }]);

    case 'TRANSCRIPT': {
      if (event.session !== state.session || state.phase !== 'finalizing') return { state, effects: [] };
      const text = event.text.trim();
      if (text.length === 0) return end(state, 'no_speech');
      if (text.length < MIN_TRANSCRIPT_CHARS) return end(state, 'too_short');
      return {
        state: { ...state, phase: 'idle', releasedWhileArming: false, lastIssue: null },
        effects: [{ type: 'deliver_transcript', session: state.session, text }],
      };
    }

    case 'INTERRUPT': {
      if (state.phase === 'idle') return { state, effects: [] };
      return end(state, 'cancelled', [{ type: 'cancel_session', session: state.session }]);
    }

    case 'TIMEOUT': {
      if (event.session !== state.session || state.phase === 'idle') return { state, effects: [] };
      return end(state, 'timeout', [{ type: 'cancel_session', session: state.session }]);
    }
  }
}