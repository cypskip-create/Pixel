import { describe, expect, it } from 'vitest';
import {
  anchoredTopCenterBounds,
  fitPresentationSize,
  resolveAnchorDisplayId,
  resizePresentationBounds,
} from '../src/shared/presentationLayout';

describe('measured native presentation layout', () => {
  it.each([
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ])('keeps a measured popover within a $width×$height work area', (size) => {
    const workArea = { x: 0, y: 0, ...size };
    const fitted = fitPresentationSize({ width: 480, height: 340 }, workArea);
    const bounds = resizePresentationBounds(
      { x: 635, y: 12, width: 96, height: 96 },
      fitted,
      workArea,
    );

    expect(bounds.width).toBe(480);
    expect(bounds.height).toBe(340);
    expect(bounds.x).toBe(443);
    expect(bounds.y).toBe(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it('caps tall panels to the work area and retains negative monitor coordinates', () => {
    const workArea = { x: -1920, y: -180, width: 1920, height: 1080 };
    const fitted = fitPresentationSize({ width: 900, height: 2000 }, workArea);
    const bounds = resizePresentationBounds(
      { x: -1200, y: -164, width: 480, height: 180 },
      fitted,
      workArea,
    );

    expect(fitted).toEqual({ width: 520, height: 1068 });
    expect(bounds.x).toBe(-1220);
    expect(bounds.y).toBe(-168);
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  });

  it('keeps the same horizontal center while the bar grows and shrinks', () => {
    const workArea = { x: 0, y: 0, width: 1366, height: 768 };
    const start = { x: 635, y: 12, width: 96, height: 96 };
    const expanded = resizePresentationBounds(
      start,
      fitPresentationSize({ width: 480, height: 260 }, workArea),
      workArea,
    );
    const collapsed = resizePresentationBounds(expanded, { width: 96, height: 96 }, workArea);

    expect(expanded.x + expanded.width / 2).toBe(start.x + start.width / 2);
    expect(collapsed.x + collapsed.width / 2).toBe(start.x + start.width / 2);
  });

  it('ignores non-finite renderer measurements and stays within compact limits', () => {
    expect(fitPresentationSize(
      { width: Number.NaN, height: Number.POSITIVE_INFINITY },
      { x: 0, y: 0, width: 1366, height: 768 },
    )).toEqual({ width: 96, height: 96 });
  });

  it('anchors at the selected display work-area top center across size changes', () => {
    const workArea = { x: -1920, y: -80, width: 1920, height: 1040 };
    const idle = anchoredTopCenterBounds(workArea, { width: 96, height: 96 }, 12);
    const expanded = anchoredTopCenterBounds(workArea, { width: 480, height: 420 }, 12);
    const collapsed = anchoredTopCenterBounds(workArea, { width: 96, height: 96 }, 12);

    expect(idle).toEqual({ x: -1008, y: -68, width: 96, height: 96 });
    expect(expanded.x + expanded.width / 2).toBe(idle.x + idle.width / 2);
    expect(collapsed).toEqual(idle);
    expect(expanded.y).toBe(workArea.y + 12);
  });

  it('clamps the top offset and fits on short or negative-coordinate displays', () => {
    const workArea = { x: 1920, y: -300, width: 1280, height: 130 };
    expect(anchoredTopCenterBounds(workArea, { width: 480, height: 400 }, 64)).toEqual({
      x: 2320,
      y: -286,
      width: 480,
      height: 116,
    });
  });

  it('keeps a valid selected display and safely falls back after monitor removal', () => {
    expect(resolveAnchorDisplayId('display-2', 'display-1', ['display-1', 'display-2'], 'display-1'))
      .toBe('display-2');
    expect(resolveAnchorDisplayId('removed', 'display-2', ['display-1', 'display-2'], 'display-1'))
      .toBe('display-1');
    expect(resolveAnchorDisplayId(null, 'display-2', ['display-1', 'display-2'], 'display-1'))
      .toBe('display-2');
  });
});
