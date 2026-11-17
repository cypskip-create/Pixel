/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChat } from '../src/renderer/hooks/useChat';
import { BridgeContext } from '../src/renderer/hooks/useBridge';
import type { ChatRequest, CypsBridge, ConversationRecordView, ConversationSummary, StreamEvent } from '../src/shared/types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function conversation(id: string, content: string): ConversationRecordView {
  const summary: ConversationSummary = {
    id, title: id, createdAt: 1, updatedAt: 2, preview: content, persistence: 'persistent',
  };
  return {
    ...summary,
    messages: content ? [{ id: `${id}_old`, role: 'user', content, createdAt: 1 }] : [],
  };
}

function setup() {
  let streamHandler: ((event: StreamEvent) => void) | null = null;
  let requestIndex = 0;
  const history = {
    list: vi.fn(async () => [{ id: 'latest', title: 'latest', createdAt: 1, updatedAt: 2, preview: 'Earlier context', persistence: 'persistent' } as ConversationSummary]),
    open: vi.fn(async (id: string) => id === 'missing' ? null : conversation(id, id === 'latest' ? 'Earlier context' : 'Older context')),
    create: vi.fn(async () => conversation('new', '')),
    rename: vi.fn(async () => null),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
  };
  const chat = {
    send: vi.fn(async (_request: ChatRequest): Promise<{ requestId: string; persistence: 'persistent' | 'session' }> => {
      requestIndex += 1;
      const requestId = `request-${requestIndex}`;
      streamHandler?.({ type: 'text', requestId, delta: 'New answer' });
      streamHandler?.({ type: 'done', requestId, finishReason: 'stop', persistence: 'session' });
      return { requestId, persistence: 'session' as const };
    }),
    cancel: vi.fn(async () => undefined),
    onStream: vi.fn((handler: (event: StreamEvent) => void) => {
      streamHandler = handler;
      return () => { streamHandler = null; };
    }),
  };
  const bridge = { history, chat } as unknown as CypsBridge;
  let current: ReturnType<typeof useChat> | null = null;
  function Harness(): React.JSX.Element {
    current = useChat(false);
    return <div>{current.messages.map((message) => message.content).join('|')}</div>;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <BridgeContext.Provider value={{ kind: 'ready', bridge }}>
      <Harness />
    </BridgeContext.Provider>,
  ));
  return { history, chat, get current() { return current; }, get streamHandler() { return streamHandler; } };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('persistent chat lifecycle', () => {
  it('restores the latest conversation and sends only its id, not renderer history', async () => {
    const fixture = setup();
    const { chat } = fixture;
    await settle();
    expect(fixture.current?.conversationId).toBe('latest');
    expect(fixture.current?.messages[0]?.content).toBe('Earlier context');

    await act(async () => {
      await fixture.current?.send({ text: 'Continue that thread', images: [], mode: 'guide' });
    });
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'latest' }));
    expect(chat.send.mock.calls[0]?.[0]).not.toHaveProperty('history');
    expect(fixture.current?.messages.map((message) => message.content)).toEqual([
      'Earlier context', 'Continue that thread', 'New answer',
    ]);
    expect(fixture.current?.persistence).toBe('session');
  });

  it('restores another conversation and isolates New Chat from its prior messages', async () => {
    const fixture = setup();
    const { history } = fixture;
    await settle();
    let opened = false;
    await act(async () => { opened = await fixture.current?.openConversation('older') ?? false; });
    expect(opened).toBe(true);
    expect(history.open).toHaveBeenLastCalledWith('older');
    expect(fixture.current?.messages.map((message) => message.content)).toEqual(['Older context']);

    await act(async () => { await fixture.current?.newConversation(); });
    expect(fixture.current?.conversationId).toBe('new');
    expect(fixture.current?.messages).toEqual([]);
    expect(fixture.current?.showTranscript).toBe(false);
  });

  it('does not switch conversations while a stream is active', async () => {
    const fixture = setup();
    const { chat } = fixture;
    await settle();
    chat.send.mockImplementation(async () => ({ requestId: 'pending', persistence: 'persistent' }));
    await act(async () => { await fixture.current?.send({ text: 'wait', images: [], mode: 'guide' }); });
    expect(fixture.current?.streaming).toBe(true);
    let opened = true;
    await act(async () => { opened = await fixture.current?.openConversation('older') ?? false; });
    expect(opened).toBe(false);
    expect(fixture.current?.conversationId).toBe('latest');
  });

  it('retains the optimistic user message and displays send failures', async () => {
    const fixture = setup();
    const { chat } = fixture;
    await settle();
    chat.send.mockRejectedValueOnce(new Error('bridge timeout'));
    await act(async () => { await fixture.current?.send({ text: 'Keep this question', images: [], mode: 'guide' }); });
    expect(fixture.current?.messages.map((message) => message.content)).toContain('Keep this question');
    expect(fixture.current?.messages.at(-1)?.error).toContain('Could not reach Pixel');
    expect(fixture.current?.streaming).toBe(false);
  });
});
