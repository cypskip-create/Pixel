/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CursorBuddy } from '../src/renderer/components/CursorBuddy';
import { expressionForAssistantState, PixMascot } from '../src/renderer/components/PixMascot';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

function mount(element: React.ReactNode): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

describe('official Pix mascot', () => {
  it('uses one canonical silver shell, black display, mint fold, limbs and face at every supported size', () => {
    for (const size of [140, 96, 64, 40, 32, 22]) {
      const markup = renderToStaticMarkup(createElement(PixMascot, { size, decorative: true, animate: false }));
      expect(markup).toContain(`width="${size}"`);
      expect(markup).toContain('class="pix-shell"');
      expect(markup).toContain('class="pix-fold"');
      expect(markup).toContain('class="pix-face"');
      expect(markup).toContain('class="pix-arm"');
      expect(markup).toContain('class="pix-foot"');
      expect(markup).toContain('class="pix-eye-curve"');
    }
  });

  it('maps real assistant states to calm, distinct expressions', () => {
    expect(expressionForAssistantState('idle')).toBe('idle');
    expect(expressionForAssistantState('listening')).toBe('listening');
    expect(expressionForAssistantState('transcribing')).toBe('thinking');
    expect(expressionForAssistantState('thinking')).toBe('thinking');
    expect(expressionForAssistantState('executing')).toBe('working');
    expect(expressionForAssistantState('speaking')).toBe('speaking');
    expect(expressionForAssistantState('success')).toBe('success');
    expect(expressionForAssistantState('waiting_for_approval')).toBe('concerned');
    expect(expressionForAssistantState('error')).toBe('concerned');
    expect(expressionForAssistantState('stopped')).toBe('stopped');
  });

  it('keeps Pix separate from the pointer-shaped Cursor Buddy', () => {
    const pix = renderToStaticMarkup(createElement(PixMascot, { size: 40, decorative: true, animate: false }));
    const cursor = renderToStaticMarkup(createElement(CursorBuddy));
    expect(pix).toContain('pix-fold');
    expect(cursor).toContain('M2 2 28 18 17 20 22 30 16.5 32 12 22 5.5 29Z');
    expect(cursor).not.toContain('pix-mascot');
    expect(cursor).not.toContain('pix-fold');
  });

  it('blinks on a bounded idle schedule and cleans up the only timer', () => {
    vi.useFakeTimers();
    mount(createElement(PixMascot, { size: 40 }));
    const mascot = host?.querySelector('svg.pix-mascot');
    expect(mascot?.getAttribute('data-blink')).toBe('false');
    act(() => vi.advanceTimersByTime(3_800));
    expect(mascot?.getAttribute('data-blink')).toBe('true');
    act(() => vi.advanceTimersByTime(140));
    expect(mascot?.getAttribute('data-blink')).toBe('false');
    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not schedule idle movement when reduced motion or static-history rendering is requested', () => {
    vi.useFakeTimers();
    mount(createElement('div', null,
      createElement(PixMascot, { size: 40, reducedMotion: true }),
      createElement(PixMascot, { size: 22, animate: false }),
    ));
    expect(vi.getTimerCount()).toBe(0);
    expect(host?.querySelectorAll('svg.pix-mascot')).toHaveLength(2);
  });

  it('honors the Windows reduced-motion preference without scheduling idle blink timers', () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) });
    try {
      mount(createElement(PixMascot, { size: 40 }));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });

  it('pauses the idle scheduler when the document is hidden', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    mount(createElement(PixMascot, { size: 40 }));
    expect(vi.getTimerCount()).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
  });
});
