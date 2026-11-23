/**
 * Multi-session chat hook backing independent split panes and background tabs.
 *
 * Subscribes once to `bridge.chat.onEvent` and routes every frame strictly to
 * its owning `SessionSlice` via `applyStreamEventToSlices`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatRequest, ImageAttachment, Mode, StreamEvent } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';
import { localId } from '@/lib/format';
import {
  applyStreamEventToSlices,
  beginSessionTurn,
  bindSessionRequest,
  createInitialSessionStore,
  getSessionSlice,
  hydrateSessionSlice,
  type SessionSlice,
  type SessionStoreState,
} from '@/lib/sessionSlices';

export function useSessionManager() {
  const bridge = useBridge();
  const [store, setStore] = useState<SessionStoreState>(() => createInitialSessionStore());
  const pendingBuffer = useRef<StreamEvent[]>([]);

  useEffect(() => {
    if (bridge.kind !== 'ready') return;
    return bridge.bridge.chat.onStream((event) => {
      setStore((prev) => {
        const applied = applyStreamEventToSlices(prev, event);
        if (!applied.matched) {
          pendingBuffer.current = [...pendingBuffer.current.slice(-63), event];
          return prev;
        }
        return applied.state;
      });
    });
  }, [bridge]);

  const getSlice = useCallback(
    (sessionKey: string): SessionSlice => getSessionSlice(store, sessionKey),
    [store],
  );

  const hydrateConversation = useCallback(
    async (sessionKey: string, conversationId: string): Promise<void> => {
      if (bridge.kind !== 'ready') return;
      try {
        const record = await bridge.bridge.history.open(conversationId);
        if (record) {
          setStore((prev) => hydrateSessionSlice(prev, sessionKey, record));
        }
      } catch {
        // Non-fatal: caller can retry or select another conversation.
      }
    },
    [bridge],
  );

  const sendInSession = useCallback(
    async (
      sessionKey: string,
      input: {
        text: string;
        images?: ImageAttachment[];
        mode: Mode;
        conversationId?: string | null;
        model?: string | null;
        provider?: string | null;
      },
    ): Promise<void> => {
      if (bridge.kind !== 'ready') return;
      const trimmed = input.text.trim();
      if (!trimmed && !(input.images?.length)) return;

      const userMessage = {
        id: localId('user'),
        role: 'user' as const,
        content: trimmed,
        createdAt: Date.now(),
        ...(input.images?.length ? { images: input.images } : {}),
      };

      setStore((prev) =>
        beginSessionTurn(prev, sessionKey, {
          userMessage,
          conversationId: input.conversationId,
          model: input.model,
          provider: input.provider,
        }),
      );

      const req: ChatRequest = {
        text: trimmed,
        images: input.images ?? [],
        mode: input.mode,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      };

      try {
        const res = await bridge.bridge.chat.send(req);
        setStore((prev) => {
          let next = bindSessionRequest(prev, sessionKey, res.requestId, input.conversationId);
          // Replay any buffered events for this requestId that arrived before chat.send resolved.
          const remaining: StreamEvent[] = [];
          for (const evt of pendingBuffer.current) {
            if (evt.requestId === res.requestId) {
              next = applyStreamEventToSlices(next, evt).state;
            } else {
              remaining.push(evt);
            }
          }
          pendingBuffer.current = remaining;
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not send message.';
        setStore((prev) => {
          const slice = getSessionSlice(prev, sessionKey);
          return {
            ...prev,
            slices: {
              ...prev.slices,
              [sessionKey]: { ...slice, streaming: false, error: msg },
            },
          };
        });
      }
    },
    [bridge],
  );

  const stopSession = useCallback(
    (sessionKey: string): void => {
      if (bridge.kind !== 'ready') return;
      const slice = getSessionSlice(store, sessionKey);
      if (slice.requestId) {
        void bridge.bridge.chat.cancel(slice.requestId);
      }
    },
    [bridge, store],
  );

  return {
    store,
    getSlice,
    hydrateConversation,
    sendInSession,
    stopSession,
  };
}
