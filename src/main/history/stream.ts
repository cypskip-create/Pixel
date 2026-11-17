import type { ChatMessage, StreamEvent } from '../../shared/types';
import { redactTaskText } from '../tasks/schema';
import type { ConversationRecord } from './store';

export interface PendingConversationStream {
  conversationId: string;
  content: string;
}

/** Accumulate only user-facing text and commit one assistant outcome at terminal events. */
export function recordConversationStreamEvent(
  streams: Map<string, PendingConversationStream>,
  event: StreamEvent,
  getConversation: (id: string) => ConversationRecord | null,
  appendMessage: (record: ConversationRecord, message: ChatMessage) => void,
): void {
  const pending = streams.get(event.requestId);
  if (!pending) return;

  if (event.type === 'text') {
    pending.content += event.delta;
    return;
  }

  if (event.type !== 'done' && event.type !== 'aborted' && event.type !== 'error') return;
  streams.delete(event.requestId);

  const record = getConversation(pending.conversationId);
  if (!record) return;

  const message: ChatMessage = {
    id: `${event.requestId}_assistant`,
    role: 'assistant',
    content: redactTaskText(pending.content),
    createdAt: Date.now(),
    ...(event.type === 'aborted' ? { aborted: true } : {}),
    ...(event.type === 'error' ? { error: redactTaskText(event.message).slice(0, 1_000) } : {}),
  };
  appendMessage(record, message);
}
