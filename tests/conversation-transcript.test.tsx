/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationTranscript } from '../src/renderer/components/ConversationTranscript';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(content: string): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <ConversationTranscript
      messages={[]}
      content={content}
      reasoning=""
      streaming
      assistantState="thinking"
      error={null}
      persistence="persistent"
      onStop={vi.fn()}
      onDismiss={vi.fn()}
    />,
  ));
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('transcript streaming scroll', () => {
  it('follows new text while pinned, then preserves the reader position after scrolling up', () => {
    const rendered = mount('first tokens');
    const scroll = rendered.querySelector<HTMLDivElement>('[class*="overflow-y-auto"]');
    expect(scroll).not.toBeNull();
    if (!scroll) return;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 });
    act(() => root?.render(
      <ConversationTranscript messages={[]} content="more tokens" reasoning="" streaming assistantState="thinking" error={null}
        persistence="persistent" onStop={vi.fn()} onDismiss={vi.fn()} />,
    ));
    expect(scroll.scrollTop).toBe(500);

    act(() => {
      scroll.scrollTop = 100;
      scroll.dispatchEvent(new Event('scroll'));
    });
    act(() => root?.render(
      <ConversationTranscript messages={[]} content="even more tokens" reasoning="" streaming assistantState="thinking" error={null}
        persistence="persistent" onStop={vi.fn()} onDismiss={vi.fn()} />,
    ));
    expect(scroll.scrollTop).toBe(100);
  });
});
