/** Pure presentation controller for the floating Pixel Island. */

export const ISLAND_TIMING = {
  hoverActivationMs: 140,
  pointerLeaveGraceMs: 950,
  idleCollapseMs: 4_500,
  responseNoticeMs: 2_200,
} as const;

export type DynamicIslandState =
  | 'COMPACT_IDLE'
  | 'HOVER_PREVIEW'
  | 'CLICK_EXPANDED'
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'BACKGROUND_WORKING'
  | 'RESPONSE_AVAILABLE'
  | 'APPROVAL_REQUIRED'
  | 'COLLAPSING';

export interface DynamicIslandContext {
  state: DynamicIslandState;
  pointerInside: boolean;
  hoverReady: boolean;
  pinned: boolean;
  hasDraft: boolean;
  recording: boolean;
  transcribing: boolean;
  workActive: boolean;
  responseAvailable: boolean;
  approvalRequired: boolean;
}

export const INITIAL_DYNAMIC_ISLAND: DynamicIslandContext = {
  state: 'COMPACT_IDLE',
  pointerInside: false,
  hoverReady: false,
  pinned: false,
  hasDraft: false,
  recording: false,
  transcribing: false,
  workActive: false,
  responseAvailable: false,
  approvalRequired: false,
};

export type DynamicIslandEvent =
  | { type: 'POINTER_ENTER' }
  | { type: 'HOVER_DELAY_ELAPSED' }
  | { type: 'POINTER_LEAVE' }
  | { type: 'LEAVE_GRACE_ELAPSED' }
  | { type: 'OPEN_CLICK' }
  | { type: 'CLOSE_CLICK' }
  | { type: 'IDLE_TIMEOUT' }
  | { type: 'RESPONSE_NOTICE_ELAPSED' }
  | { type: 'DRAFT_CHANGED'; hasDraft: boolean }
  | {
      type: 'RUNTIME_CHANGED';
      recording: boolean;
      transcribing: boolean;
      workActive: boolean;
      responseAvailable: boolean;
      approvalRequired: boolean;
    };

const ATTENTION_STATES = new Set<DynamicIslandState>([
  'RECORDING', 'TRANSCRIBING', 'BACKGROUND_WORKING', 'APPROVAL_REQUIRED',
]);

export function isDynamicIslandExpanded(state: DynamicIslandState): boolean {
  return state === 'HOVER_PREVIEW' || state === 'CLICK_EXPANDED' ||
    state === 'APPROVAL_REQUIRED' || state === 'COLLAPSING';
}

function settle(context: DynamicIslandContext): DynamicIslandContext {
  let state: DynamicIslandState;
  if (context.approvalRequired) state = 'APPROVAL_REQUIRED';
  else if (context.recording) state = 'RECORDING';
  else if (context.transcribing) state = 'TRANSCRIBING';
  else if (context.pinned) state = 'CLICK_EXPANDED';
  else if (context.pointerInside && context.hoverReady) state = 'HOVER_PREVIEW';
  else if (context.workActive) state = 'BACKGROUND_WORKING';
  else if (context.responseAvailable) state = 'RESPONSE_AVAILABLE';
  else state = 'COMPACT_IDLE';
  return { ...context, state };
}

export function reduceDynamicIsland(
  context: DynamicIslandContext,
  event: DynamicIslandEvent,
): DynamicIslandContext {
  switch (event.type) {
    case 'POINTER_ENTER':
      return settle({ ...context, pointerInside: true });
    case 'HOVER_DELAY_ELAPSED':
      return context.pointerInside && !context.pinned && !context.workActive &&
        !context.recording && !context.transcribing && !context.approvalRequired
        ? settle({ ...context, hoverReady: true })
        : context;
    case 'POINTER_LEAVE': {
      const next = { ...context, pointerInside: false, hoverReady: false };
      const settled = settle(next);
      return settled.state === 'COMPACT_IDLE' || settled.state === 'RESPONSE_AVAILABLE'
        ? { ...settled, state: 'COLLAPSING' }
        : settled;
    }
    case 'LEAVE_GRACE_ELAPSED':
      if (context.pointerInside || context.pinned || context.approvalRequired) return context;
      // Keep text recoverable by keeping the editor open if a draft exists.
      return settle({ ...context, pinned: context.hasDraft });
    case 'OPEN_CLICK':
      return settle({ ...context, pinned: true, hoverReady: false });
    case 'CLOSE_CLICK':
      // Closing only changes presentation. The caller retains the draft, chat,
      // response, task and approval state.
      return settle({ ...context, pinned: false, hoverReady: false });
    case 'IDLE_TIMEOUT':
      if (context.pointerInside || context.hasDraft || context.workActive ||
          context.recording || context.transcribing || context.approvalRequired) return context;
      return settle({ ...context, pinned: false, hoverReady: false });
    case 'RESPONSE_NOTICE_ELAPSED':
      if (context.pointerInside || context.pinned || context.workActive || context.approvalRequired) return context;
      return settle({ ...context, responseAvailable: false });
    case 'DRAFT_CHANGED':
      return settle({ ...context, hasDraft: event.hasDraft });
    case 'RUNTIME_CHANGED': {
      const next = {
        ...context,
        recording: event.recording,
        transcribing: event.transcribing,
        workActive: event.workActive,
        responseAvailable: event.responseAvailable,
        approvalRequired: event.approvalRequired,
      };
      // New background work does not keep an idle chat panel expanded.
      if (event.workActive && !event.approvalRequired) next.pinned = false;
      return settle(next);
    }
  }
}

export function hasDynamicIslandAttention(context: DynamicIslandContext): boolean {
  return ATTENTION_STATES.has(context.state);
}
