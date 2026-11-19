/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePixPlay } from '../src/renderer/components/WorkspacePixPlay';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(state: 'idle' | 'listening', reducedMotion = false): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(WorkspacePixPlay, { state, reducedMotion })));
}

describe('Workspace Pix play lane', () => {
  it('plays briefly inside its lane while idle and cancels immediately on assistant activity', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mount('idle');
    const lane = host?.querySelector('.workspace-pix-play');
    expect(lane?.getAttribute('data-playing')).toBe('false');
    act(() => vi.advanceTimersByTime(24_000));
    expect(lane?.getAttribute('data-playing')).toBe('true');
    expect(lane?.querySelector('.workspace-pix-ball')).not.toBeNull();
    act(() => root?.render(createElement(WorkspacePixPlay, { state: 'listening', reducedMotion: false })));
    expect(lane?.getAttribute('data-playing')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not schedule play when reduced motion is enabled', () => {
    vi.useFakeTimers();
    mount('idle', true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(host?.querySelector('.workspace-pix-play')?.getAttribute('data-playing')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors the Windows reduced-motion preference', () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) });
    try {
      mount('idle');
      expect(vi.getTimerCount()).toBe(0);
      expect(host?.querySelector('.workspace-pix-play')?.getAttribute('data-playing')).toBe('false');
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });
});
