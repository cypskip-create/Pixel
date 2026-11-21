/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { choosePixPetActivity, WorkspacePixPlay } from '../src/renderer/components/WorkspacePixPlay';

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
  it('runs one bounded idle behavior and cancels immediately on assistant activity', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mount('idle');
    const lane = host?.querySelector('.workspace-pix-play');
    expect(lane?.getAttribute('data-playing')).toBe('false');
    act(() => vi.advanceTimersByTime(24_000));
    expect(lane?.getAttribute('data-activity')).toBe('looking');
    act(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(lane?.getAttribute('data-activity')).toBe('idle');
    expect(lane?.querySelector('.workspace-pix-ball')).not.toBeNull();
    act(() => root?.render(createElement(WorkspacePixPlay, { state: 'listening', reducedMotion: false })));
    expect(lane?.getAttribute('data-playing')).toBe('false');
    expect(lane?.getAttribute('data-activity')).toBe('idle');
  });

  it('selects sleep only after prolonged inactivity and avoids repeating the same activity', () => {
    expect(choosePixPetActivity(180_000, () => 0, 'looking')).toBe('sleeping');
    expect(choosePixPetActivity(0, () => 0, 'looking')).not.toBe('looking');
    expect(choosePixPetActivity(180_000, () => 0, 'sleeping')).not.toBe('sleeping');
    expect(choosePixPetActivity(60_000, () => 0, 'sitting')).toBe('lying');
  });

  it('sleeps after real inactivity and wakes on the next interaction', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mount('idle');
    act(() => vi.advanceTimersByTime(220_000));
    const lane = host?.querySelector('.workspace-pix-play');
    expect(lane?.getAttribute('data-activity')).toBe('sleeping');
    act(() => document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(lane?.getAttribute('data-activity')).toBe('waking');
    act(() => vi.advanceTimersByTime(900));
    expect(lane?.getAttribute('data-activity')).toBe('idle');
  });

  it('does not schedule play when reduced motion is enabled', () => {
    vi.useFakeTimers();
    mount('idle', true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(host?.querySelector('.workspace-pix-play')?.getAttribute('data-playing')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows only quiet ASCII particles at rest and pauses them when the page is hidden', () => {
    mount('idle');
    const ambient = host?.querySelector('.workspace-pix-ambient');
    expect(ambient?.getAttribute('data-active')).toBe('true');
    expect(ambient?.textContent).toBe('·+·');

    const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(ambient?.getAttribute('data-active')).toBe('false');

    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
    else Reflect.deleteProperty(document, 'visibilityState');
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
