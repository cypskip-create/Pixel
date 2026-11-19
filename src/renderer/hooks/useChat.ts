import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRequest, ConversationRecordView, ImageAttachment, Mode, StreamEvent } from '@shared/types';
import { localId } from '@/lib/format';
import { useBridge } from '@/hooks/useBridge';

export interface ChatState {
  /** Canonical request id from the shell, once accepted. */
  requestId: string | null;
  content: string;
  reasoning: string;
  streaming: boolean;
  error: string | null;
  /** Model name reported by the shell. */
  model: string | null;
  conversationId: string | null;
  messages: ChatMessage[];
  persistence: 'persistent' | 'session';
  historyLoading: boolean;
  showTranscript: boolean;
}

const EMPTY: ChatState = {
  requestId: null,
  content: '',
  reasoning: '',
  streaming: false,
  error: null,
  model: null,
  conversationId: null,
  messages: [],
  persistence: 'persistent',
  historyLoading: false,
  showTranscript: false,
};

interface Outgoing {
  text: string;
  images: ImageAttachment[];
  mode: Mode;
}

/**
 * Owns one conversation turn at a time against the native bridge.
 *
 * Stream events are matched by `requestId`. Because `chat.send` resolves with
 * the id *after* the first frames may already have arrived, events for an
 * unknown id are held in a small buffer and replayed once the id is known.
 */
export function useChat(persistHistory = true) {
  const bridge = useBridge();
  const [state, setState] = useState<ChatState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeId = useRef<string | null>(null);
  const pendingEvents = useRef<StreamEvent[]>([]);
  const alive = useRef(true);
  const settle = useRef<((result: { ok: boolean; reason?: string }) => void) | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    let cancelled = false;
    setState((previous) => ({ ...previous, historyLoading: true }));
    void (async () => {
      try {
        const history = bridge.bridge.history;
        let record: ConversationRecordView | null;
        if (typeof history.getActive === 'function') {
          record = await history.getActive();
        } else {
          const recent = await history.list({ limit: 1 });
          record = recent[0] ? await history.open(recent[0].id) : null;
        }
        record ??= await history.create();
        if (cancelled || !alive.current) return;
        setState(fromRecord(record, record.messages.length > 0));
      } catch {
        if (cancelled || !alive.current) return;
        setState((previous) => ({
          ...previous,
          historyLoading: false,
          error: 'Chat history could not be loaded. Start a new chat or reopen Pixel.',
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [bridge]);

  useEffect(() => {
    if (bridge.kind !== 'ready' || typeof bridge.bridge.history.onActiveChanged !== 'function') return;
    return bridge.bridge.history.onActiveChanged((record) => {
      if (!alive.current) return;
      if (!record) {
        if (!stateRef.current.streaming) {
          activeId.current = null;
          setState((previous) => ({ ...EMPTY, historyLoading: false, persistence: previous.persistence }));
        }
        return;
      }
      setState((previous) => {
        if (previous.conversationId === record.id && previous.streaming) {
          return { ...previous, messages: record.messages, persistence: record.persistence };
        }
        activeId.current = null;
        pendingEvents.current = [];
        return fromRecord(record, record.messages.length > 0);
      });
    });
  }, [bridge]);

  /**
   * Applies one stream event. Kept as a plain function (not a hook) so the
   * reducer logic below stays readable and testable by shape.
   */
  const applyEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'started':
        setState((prev) => ({ ...prev, model: event.model }));
        break;
      case 'reasoning':
        setState((prev) => ({
          ...prev,
          reasoning: prev.reasoning + event.delta,
        }));
        break;
      case 'text':
        setState((prev) => ({
          ...prev,
          content: prev.content + event.delta,
        }));
        break;
      case 'tool_calls':
        // Tool calls are surfaced by the task rail and the permission card.
        break;
      case 'usage':
        break;
      case 'done':
        setState((prev) => ({
          ...prev,
          streaming: false,
          ...(event.persistence ? { persistence: event.persistence } : {}),
          messages: prev.content.length > 0
            ? [...prev.messages, transcriptAssistant(event.requestId, prev.content)]
            : prev.messages,
        }));
        activeId.current = null;
        settle.current?.({ ok: true });
        settle.current = null;
        break;
      case 'aborted':
        setState((prev) => ({
          ...prev,
          streaming: false,
          ...(event.persistence ? { persistence: event.persistence } : {}),
          error: event.hadContent ? null : 'Stopped.',
          messages: [...prev.messages, transcriptAssistant(event.requestId, prev.content, { aborted: true })],
        }));
        activeId.current = null;
        settle.current?.({ ok: false, reason: 'aborted' });
        settle.current = null;
        break;
      case 'error':
        setState((prev) => ({
          ...prev,
          streaming: false,
          ...(event.persistence ? { persistence: event.persistence } : {}),
          error: describeStreamError(event.message, event.code),
          messages: [...prev.messages, transcriptAssistant(event.requestId, prev.content, { error: describeStreamError(event.message, event.code) })],
        }));
        activeId.current = null;
        settle.current?.({ ok: false, reason: event.message });
        settle.current = null;
        break;
      default:
        break;
    }
  }, []);

  // Subscribe once per bridge.
  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    const api = bridge.bridge.chat;
    if (!api || typeof api.onStream !== 'function') return;

    const unsubscribe = api.onStream((event: StreamEvent) => {
      if (!alive.current || event === null || typeof event !== 'object') return;

      if (typeof event.conversationId === 'string') {
        const current = stateRef.current;
        if (event.conversationId !== current.conversationId) return;
        if (activeId.current === null) {
          if (event.type !== 'started') return;
          activeId.current = event.requestId;
          setState((previous) => ({ ...previous, requestId: event.requestId, streaming: true }));
          applyEvent(event);
          return;
        }
        if (event.requestId === activeId.current) applyEvent(event);
        return;
      }

      if (activeId.current === null) {
        // Frames can beat the send() promise. Buffer the newest few.
        pendingEvents.current.push(event);
        if (pendingEvents.current.length > 32) pendingEvents.current.shift();
        return;
      }
      if (event.requestId !== activeId.current) return;
      applyEvent(event);
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [bridge, applyEvent]);

  const send = useCallback(
    async (outgoing: Outgoing): Promise<boolean> => {
      if (bridge.kind !== 'ready') {
        setState((previous) => ({ ...previous, error: `${bridge.reason} Your message was not sent.` }));
        return false;
      }
      if (state.historyLoading || state.conversationId === null) {
        setState((previous) => ({ ...previous, error: 'Pixel is still restoring the selected conversation.' }));
        return false;
      }
      const api = bridge.bridge.chat;
      if (!api || typeof api.send !== 'function') {
        setState({ ...EMPTY, error: 'Chat is unavailable in this build.' });
        return false;
      }

      activeId.current = null;
      pendingEvents.current = [];
      const userMessage: ChatMessage = {
        id: localId('user'),
        role: 'user',
        content: outgoing.text.trim() || (outgoing.images.length ? '[Image attached; image data is not retained in chat history.]' : ''),
        createdAt: Date.now(),
      };
      setState((previous) => ({
        ...previous,
        requestId: null,
        content: '',
        reasoning: '',
        streaming: true,
        persistence: persistHistory ? previous.persistence : 'session',
        error: null,
        model: null,
        messages: [...previous.messages, userMessage],
        showTranscript: true,
      }));

      const request: ChatRequest = {
        text: outgoing.text,
        mode: outgoing.mode,
        conversationId: state.conversationId,
        ...(outgoing.images.length > 0 ? { images: outgoing.images } : {}),
      };

      try {
        const reply = await api.send(request);
        if (!alive.current) return false;
        const id = typeof reply?.requestId === 'string' ? reply.requestId : localId('req');
        activeId.current = id;
        setState((prev) => ({
          ...prev,
          requestId: id,
          ...(reply?.persistence ? { persistence: reply.persistence } : {}),
        }));

        // Replay anything that arrived before the id was known.
        const buffered = pendingEvents.current;
        pendingEvents.current = [];
        for (const event of buffered) {
          if (event.requestId === id) applyEvent(event);
        }
        return true;
      } catch (cause) {
        if (!alive.current) return false;
        activeId.current = null;
        const error = `Could not reach Pixel: ${cause instanceof Error ? cause.message : 'unknown error'}`;
        setState((previous) => ({
          ...previous,
          streaming: false,
          error,
          messages: [...previous.messages, transcriptAssistant(localId('failed'), '', { error })],
        }));
        return false;
      }
    },
    [bridge, applyEvent, persistHistory, state],
  );

  const stop = useCallback(() => {
    const id = activeId.current;
    if (bridge.kind !== 'ready' || id === null) {
      setState((prev) => ({ ...prev, streaming: false }));
      return;
    }
    const api = bridge.bridge.chat;
    if (!api || typeof api.cancel !== 'function') {
      setState((prev) => ({ ...prev, streaming: false }));
      return;
    }
    void (async () => {
      try {
        await api.cancel(id);
      } catch {
        if (!alive.current) return;
        setState((prev) => ({
          ...prev,
          streaming: false,
          error: 'Could not stop the response cleanly.',
        }));
      }
    })();
  }, [bridge]);

  const reset = useCallback(() => {
    activeId.current = null;
    pendingEvents.current = [];
    setState((previous) => ({
      ...previous,
      requestId: null,
      content: '',
      reasoning: '',
      streaming: false,
      error: null,
      model: null,
      showTranscript: false,
    }));
  }, []);

  const openConversation = useCallback(async (conversationId: string): Promise<boolean> => {
    if (bridge.kind !== 'ready' || state.streaming) return false;
    setState((previous) => ({ ...previous, historyLoading: true, error: null }));
    try {
      const record = await bridge.bridge.history.open(conversationId);
      if (!record || !alive.current) {
        setState((previous) => ({ ...previous, historyLoading: false, error: 'That conversation is unavailable.' }));
        return false;
      }
      activeId.current = null;
      pendingEvents.current = [];
      setState(fromRecord(record, true));
      return true;
    } catch {
      setState((previous) => ({ ...previous, historyLoading: false, error: 'Finish or cancel the active task before switching conversations.' }));
      return false;
    }
  }, [bridge, state.streaming]);

  const newConversation = useCallback(async (): Promise<boolean> => {
    if (bridge.kind !== 'ready' || state.streaming) return false;
    setState((previous) => ({ ...previous, historyLoading: true, error: null }));
    try {
      const record = await bridge.bridge.history.create();
      if (!alive.current) return false;
      activeId.current = null;
      pendingEvents.current = [];
      setState(fromRecord(record, false));
      return true;
    } catch {
      setState((previous) => ({ ...previous, historyLoading: false, error: 'Finish or cancel the active task before starting a new chat.' }));
      return false;
    }
  }, [bridge, state.streaming]);

  const revealTranscript = useCallback(async () => {
    if (bridge.kind !== 'ready') {
      setState((previous) => ({ ...previous, showTranscript: previous.messages.length > 0 }));
      return;
    }
    const id = state.conversationId;
    if (!id) return;
    try {
      const record = await bridge.bridge.history.open(id);
      if (!alive.current || !record) return;
      setState((previous) => previous.streaming ? previous : {
        ...previous,
        messages: record.messages,
        persistence: record.persistence,
        showTranscript: record.messages.length > 0,
      });
    } catch {
      setState((previous) => ({ ...previous, showTranscript: previous.messages.length > 0 }));
    }
  }, [bridge, state.conversationId]);

  return { ...state, send, stop, reset, openConversation, newConversation, revealTranscript };
}

function fromRecord(record: ConversationRecordView, showTranscript: boolean): ChatState {
  return {
    ...EMPTY,
    conversationId: record.id,
    messages: record.messages,
    persistence: record.persistence,
    historyLoading: false,
    showTranscript,
  };
}

function transcriptAssistant(
  requestId: string,
  content: string,
  flags: { aborted?: boolean; error?: string } = {},
): ChatMessage {
  return {
    id: `${requestId}_assistant`,
    role: 'assistant',
    content,
    createdAt: Date.now(),
    ...(flags.aborted ? { aborted: true } : {}),
    ...(flags.error ? { error: flags.error } : {}),
  };
}

function describeStreamError(message: string, code: string): string {
  switch (code) {
    case 'NO_API_KEY':
      return 'No DeepSeek API key is configured yet. Add one in settings.';
    case 'UNAUTHORIZED':
      return 'DeepSeek rejected the API key. Check it in settings.';
    case 'INSUFFICIENT_BALANCE':
      return 'Your DeepSeek account has no remaining balance.';
    case 'RATE_LIMITED':
      return 'Too many requests. Pixel will wait a moment - try again shortly.';
    case 'TIMEOUT':
      return 'The request timed out. Try again, or ask something smaller.';
    case 'NETWORK':
      return 'No network connection to DeepSeek.';
    case 'MODEL_CAPABILITY':
      return 'The selected model cannot do this. Try a different model.';
    default:
      return message;
  }
}
