/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsciiSharkBackground } from '../src/renderer/components/AsciiSharkBackground';
import { mirrorAsciiLine, PixelSharkEngine, SHARK_ART_LEFT } from '../src/renderer/lib/asciiSharks';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createMockCanvasContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 960,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 960,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

function mount(element: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

describe('ASCII Shark ambient background', () => {
  it('mirrors ASCII shark lines symmetrically for left-swimming sharks', () => {
    expect(mirrorAsciiLine('/::\\')).toBe('/::\\');
    expect(mirrorAsciiLine('(/)')).toBe('(\\)');
    expect(SHARK_ART_LEFT.length).toBeGreaterThanOrEqual(9);
  });

  it('renders in empty chat mode and transitions smoothly to active background mode without remounting', () => {
    const rendered = mount(<AsciiSharkBackground mode="empty" reducedMotion={false} />);
    const container = rendered.querySelector('.ascii-shark-bg');
    const canvas = rendered.querySelector('canvas');
    expect(container).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(container?.getAttribute('data-shark-mode')).toBe('empty');
    expect(container?.getAttribute('aria-hidden')).toBe('true');

    // Transition to active conversation mode keeps the same canvas instance alive
    act(() => root?.render(<AsciiSharkBackground mode="active" reducedMotion={false} />));
    expect(rendered.querySelector('canvas')).toBe(canvas);
    expect(container?.getAttribute('data-shark-mode')).toBe('active');
  });

  it('stays frozen in static mode when reducedMotion is enabled and never starts a rAF loop', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const canvas = document.createElement('canvas');
    const engine = new PixelSharkEngine(canvas, { mode: 'empty', reducedMotion: true });
    expect(engine.getStateSnapshot().frozen).toBe(true);
    expect(engine.getStateSnapshot().paused).toBe(true);
    expect(rafSpy).not.toHaveBeenCalled();
    engine.destroy();
  });

  it('pauses animation when document becomes hidden and cleans up on destroy', () => {
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const canvas = document.createElement('canvas');
    const engine = new PixelSharkEngine(canvas, { mode: 'active', reducedMotion: false });
    expect(engine.getStateSnapshot().paused).toBe(false);
    expect(engine.getStateSnapshot().visibleInActiveCount).toBeLessThan(engine.getStateSnapshot().sharkCount);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.getStateSnapshot().paused).toBe(true);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.getStateSnapshot().paused).toBe(false);

    engine.destroy();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
