import { describe, expect, it } from 'vitest';
import { HistoryStore, MemoryStorage } from '../src/main/history/store';
import { recordConversationStreamEvent } from '../src/main/history/stream';
import type { ConversationRecord } from '../src/main/history/store';
import type { StreamEvent } from '../src/shared/types';

function fixture(persistence: 'persistent' | 'session' = 'persistent') {
  const storage = new MemoryStorage();
  const store = new HistoryStore(storage);
  const record: ConversationRecord = {
    id: 'conversation',
    title: 'A conversation',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    persistence,
  };
  store.save(record);
  const pending = new Map([["request", { conversationId: record.id, content: '' }]]);
  const append = (target: ConversationRecord, message: ConversationRecord['messages'][number]): void => {
    target.messages.push(message);
    store.save(target);
  };
  const dispatch = (event: StreamEvent): void => recordConversationStreamEvent(
    pending,
    event,
    (id) => id === record.id ? record : null,
    append,
  );
  return { store, storage, record, pending, dispatch };
}

describe('persistent conversation stream outcomes', () => {
  it('persists the accumulated assistant answer only at completion', () => {
    const { store, dispatch, pending } = fixture();
    dispatch({ type: 'text', requestId: 'request', delta: 'Hello ' });
    dispatch({ type: 'reasoning', requestId: 'request', delta: 'hidden reasoning' });
    dispatch({ type: 'tool_calls', requestId: 'request', toolCalls: [] });
    expect(store.load('conversation')?.messages).toEqual([]);
    dispatch({ type: 'text', requestId: 'request', delta: 'there.' });
    dispatch({ type: 'done', requestId: 'request', finishReason: 'stop' });

    expect(store.load('conversation')?.messages).toMatchObject([{ role: 'assistant', content: 'Hello there.' }]);
    expect(store.load('conversation')?.messages[0]).not.toHaveProperty('reasoning');
    expect(pending.has('request')).toBe(false);
  });

  it('records partial output when the user cancels a stream', () => {
    const { store, dispatch, pending } = fixture();
    dispatch({ type: 'text', requestId: 'request', delta: 'Partial answer' });
    dispatch({ type: 'aborted', requestId: 'request', hadContent: true });
    expect(store.load('conversation')?.messages[0]).toMatchObject({ content: 'Partial answer', aborted: true });
    expect(pending.has('request')).toBe(false);
  });

  it('records a failed outcome without exposing raw internal traces', () => {
    const { store, dispatch } = fixture();
    dispatch({ type: 'text', requestId: 'request', delta: 'Partial' });
    dispatch({ type: 'error', requestId: 'request', message: 'provider failed', code: 'NETWORK' });
    expect(store.load('conversation')?.messages[0]).toMatchObject({ content: 'Partial', error: 'provider failed' });
  });

  it('keeps history-disabled messages in session memory without writing them', () => {
    const { store, storage, record, dispatch } = fixture('session');
    record.messages.push({ id: 'user', role: 'user', content: 'temporary', createdAt: 1 });
    dispatch({ type: 'text', requestId: 'request', delta: 'temporary answer' });
    dispatch({ type: 'done', requestId: 'request', finishReason: 'stop' });
    store.save(record);

    expect(record.messages.map((message) => message.content)).toEqual(['temporary', 'temporary answer']);
    expect(storage.read('history.index')).toBeNull();
    expect(store.load('conversation')).toBeNull();
  });

  it('does not create a message for a stream whose conversation was deleted', () => {
    const { store, dispatch, pending } = fixture();
    pending.set('orphan', { conversationId: 'deleted', content: 'private' });
    dispatch({ type: 'done', requestId: 'orphan', finishReason: 'stop' });
    expect(pending.has('orphan')).toBe(false);
    expect(store.load('conversation')?.messages).toEqual([]);
  });
});
