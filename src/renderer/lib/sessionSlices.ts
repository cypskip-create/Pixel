/**
 * Per-session conversation state slices (Hermes `session-view.tsx` pattern).
 *
 * Each conversation tab or split pane reads strictly from its own `SessionSlice`
 * keyed by `sessionKey`. Incoming `StreamEvent`s route strictly by `requestId`
 * (or `conversationId`), making it structurally impossible for a background
 * stream or Pane A to overwrite Pane B's visible messages or busy state.
 */

import type {
  ChatMessage,
  ConversationRecordView,
  CypsErrorCode,
  StreamEvent,
} from '@shared/types';

export interface SessionSlice {
  sessionKey: string;
  conversationId: string | null;
  requestId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  content: string;
  reasoning: string;
  model: string | null;
  provider: string | null;
  error: string | null;
  persistence: 'persistent' | 'session';
  historyLoading: boolean;
}

export interface SessionStoreState {
  slices: Record<string, SessionSlice>;
  requestToSession: Record<string, string>;
  conversationToSession: Record<string, string>;
}

export function createEmptySlice(
  sessionKey: string,
  conversationId: string | null = null,
): SessionSlice {
  return {
    sessionKey,
    conversationId,
    requestId: null,
    messages: [],
    streaming: false,
    content: '',
    reasoning: '',
    model: null,
    provider: null,
    error: null,
    persistence: 'persistent',
    historyLoading: false,
  };
}

export function createInitialSessionStore(): SessionStoreState {
  return {
    slices: {},
    requestToSession: {},
    conversationToSession: {},
  };
}

export function getSessionSlice(
  store: SessionStoreState,
  sessionKey: string,
): SessionSlice {
  return store.slices[sessionKey] ?? createEmptySlice(sessionKey);
}

export function hydrateSessionSlice(
  store: SessionStoreState,
  sessionKey: string,
  record: ConversationRecordView,
): SessionStoreState {
  const existing = store.slices[sessionKey];
  const slice: SessionSlice = {
    ...(existing ?? createEmptySlice(sessionKey, record.id)),
    conversationId: record.id,
    messages: record.messages,
    persistence: record.persistence,
    historyLoading: false,
    error: null,
  };
  return {
    ...store,
    slices: { ...store.slices, [sessionKey]: slice },
    conversationToSession: { ...store.conversationToSession, [record.id]: sessionKey },
  };
}

export function beginSessionTurn(
  store: SessionStoreState,
  sessionKey: string,
  input: {
    userMessage: ChatMessage;
    conversationId?: string | null;
    model?: string | null;
    provider?: string | null;
  },
): SessionStoreState {
  const prev = getSessionSlice(store, sessionKey);
  const convId = input.conversationId ?? prev.conversationId;
  const nextSlice: SessionSlice = {
    ...prev,
    conversationId: convId,
    streaming: true,
    content: '',
    reasoning: '',
    error: null,
    model: input.model ?? prev.model,
    provider: input.provider ?? prev.provider,
    messages: [...prev.messages, input.userMessage],
  };
  return {
    ...store,
    slices: { ...store.slices, [sessionKey]: nextSlice },
    ...(convId
      ? { conversationToSession: { ...store.conversationToSession, [convId]: sessionKey } }
      : {}),
  };
}

export function bindSessionRequest(
  store: SessionStoreState,
  sessionKey: string,
  requestId: string,
  conversationId?: string | null,
): SessionStoreState {
  const prev = getSessionSlice(store, sessionKey);
  const convId = conversationId ?? prev.conversationId;
  const nextSlice: SessionSlice = {
    ...prev,
    requestId,
    conversationId: convId,
  };
  return {
    ...store,
    slices: { ...store.slices, [sessionKey]: nextSlice },
    requestToSession: { ...store.requestToSession, [requestId]: sessionKey },
    ...(convId
      ? { conversationToSession: { ...store.conversationToSession, [convId]: sessionKey } }
      : {}),
  };
}

function makeAssistantMessage(
  requestId: string,
  content: string,
  extra: { aborted?: boolean; error?: string } = {},
): ChatMessage {
  return {
    id: `assistant_${requestId}_${Date.now().toString(36)}`,
    role: 'assistant',
    content,
    createdAt: Date.now(),
    ...(extra.aborted ? { aborted: true } : {}),
    ...(extra.error ? { error: extra.error } : {}),
  };
}

function formatError(message: string, code?: CypsErrorCode): string {
  if (code === 'NO_API_KEY') return 'Add an API key in Settings before sending messages.';
  return message || 'The request failed.';
}

/**
 * Route a single `StreamEvent` strictly to its owning session slice.
 * Never mutates any other session slice.
 */
export function applyStreamEventToSlices(
  store: SessionStoreState,
  event: StreamEvent,
): { state: SessionStoreState; matched: boolean } {
  const sessionKey =
    store.requestToSession[event.requestId] ??
    (event.conversationId ? store.conversationToSession[event.conversationId] : undefined);

  if (!sessionKey) {
    return { state: store, matched: false };
  }

  const prev = getSessionSlice(store, sessionKey);
  let next: SessionSlice = prev;
  let clearRequest = false;

  switch (event.type) {
    case 'started':
      next = {
        ...prev,
        streaming: true,
        model: event.model,
        conversationId: event.conversationId ?? prev.conversationId,
      };
      break;
    case 'reasoning':
      next = {
        ...prev,
        reasoning: prev.reasoning + event.delta,
      };
      break;
    case 'text':
      next = {
        ...prev,
        content: prev.content + event.delta,
      };
      break;
    case 'tool_calls':
    case 'usage':
      return { state: store, matched: true };
    case 'done':
      clearRequest = true;
      next = {
        ...prev,
        streaming: false,
        requestId: null,
        ...(event.persistence ? { persistence: event.persistence } : {}),
        messages:
          prev.content.length > 0
            ? [...prev.messages, makeAssistantMessage(event.requestId, prev.content)]
            : prev.messages,
        content: '',
        reasoning: '',
      };
      break;
    case 'aborted':
      clearRequest = true;
      next = {
        ...prev,
        streaming: false,
        requestId: null,
        ...(event.persistence ? { persistence: event.persistence } : {}),
        error: event.hadContent ? null : 'Stopped.',
        messages: [
          ...prev.messages,
          makeAssistantMessage(event.requestId, prev.content, { aborted: true }),
        ],
        content: '',
        reasoning: '',
      };
      break;
    case 'error': {
      clearRequest = true;
      const errText = formatError(event.message, event.code);
      next = {
        ...prev,
        streaming: false,
        requestId: null,
        ...(event.persistence ? { persistence: event.persistence } : {}),
        error: errText,
        messages: [
          ...prev.messages,
          makeAssistantMessage(event.requestId, prev.content, { error: errText }),
        ],
        content: '',
        reasoning: '',
      };
      break;
    }
  }

  const nextReqMap = { ...store.requestToSession };
  if (clearRequest) {
    delete nextReqMap[event.requestId];
  }

  return {
    matched: true,
    state: {
      ...store,
      slices: { ...store.slices, [sessionKey]: next },
      requestToSession: nextReqMap,
    },
  };
}
