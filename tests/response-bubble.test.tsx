/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponseBubble } from '../src/renderer/components/ResponseBubble';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(spoken: boolean): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <ResponseBubble
      content="A completed answer."
      reasoning="separate details"
      streaming={false}
      error={null}
      spoken={spoken}
      onCollapse={vi.fn()}
      onStop={vi.fn()}
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

describe('response feedback', () => {
  it('does not claim speech playback before the native TTS call confirms success', () => {
    expect(render(false).textContent).not.toContain('Spoken aloud');
  });

  it('shows speech status only after playback is confirmed', () => {
    expect(render(true).textContent).toContain('Spoken aloud');
  });

  it('keeps reasoning separate and collapsed by default', () => {
    const rendered = render(false);
    const details = rendered.querySelector<HTMLButtonElement>('[aria-expanded]');
    expect(details?.getAttribute('aria-expanded')).toBe('false');
    expect(details?.textContent).toContain('Thought process');
  });
});
