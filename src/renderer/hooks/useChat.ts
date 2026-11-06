import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatRequest, ImageAttachment, Mode, StreamEvent } from '@shared/types';
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
}

const EMPTY: ChatState = {
  requestId: null,
  content: '',
  reasoning: '',
  streaming: false,
  error: null,
  model: null,
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
export function useChat() {
  const bridge = useBridge();
  const [state, setState] = useState<ChatState>(EMPTY);

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
        setState((prev) => ({ ...prev, streaming: false }));
        settle.current?.({ ok: true });
        settle.current = null;
        break;
      case 'aborted':
        setState((prev) => ({
          ...prev,
          streaming: false,
          error: event.hadContent ? null : 'Stopped.',
        }));
        settle.current?.({ ok: false, reason: 'aborted' });
        settle.current = null;
        break;
      case 'error':
        setState((prev) => ({
          ...prev,
          streaming: false,
          error: describeStreamError(event.message, event.code),
        }));
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
        setState({
          ...EMPTY,
          error: `${bridge.reason} Your message was not sent.`,
        });
        return false;
      }
      const api = bridge.bridge.chat;
      if (!api || typeof api.send !== 'function') {
        setState({ ...EMPTY, error: 'Chat is unavailable in this build.' });
        return false;
      }

      activeId.current = null;
      pendingEvents.current = [];
      setState({ ...EMPTY, streaming: true });

      const request: ChatRequest = {
        text: outgoing.text,
        mode: outgoing.mode,
        ...(outgoing.images.length > 0 ? { images: outgoing.images } : {}),
      };

      try {
        const reply = await api.send(request);
        if (!alive.current) return false;
        const id = typeof reply?.requestId === 'string' ? reply.requestId : localId('req');
        activeId.current = id;
        setState((prev) => ({ ...prev, requestId: id }));

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
        setState({
          ...EMPTY,
          error: `Could not reach Cyps: ${cause instanceof Error ? cause.message : 'unknown error'}`,
        });
        return false;
      }
    },
    [bridge, applyEvent],
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
    setState(EMPTY);
  }, []);

  return { ...state, send, stop, reset };
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
      return 'Too many requests. Cyps will wait a moment - try again shortly.';
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