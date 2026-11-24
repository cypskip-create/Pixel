// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ScreenDrawingOverlay } from '../src/renderer/components/ScreenDrawingOverlay';
import { PythonAgentBridge } from '../src/main/services/pythonAgentBridge';
import type { ScreenDrawingSceneSnapshot } from '../src/shared/types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('Phase 9: Python-first screen drawing & transparent overlay', () => {
  it('round-trips drawing primitives, undo/redo, coordinate mapping, and emergency stop through PythonAgentBridge', async () => {
    const bridge = new PythonAgentBridge();
    try {
      const added = await bridge.drawingAdd({
        kind: 'freehand',
        points: [
          { x: 100, y: 100 },
          { x: 160, y: 140 },
          { x: 240, y: 110 },
        ],
        strokeWidth: 4,
        label: 'Circle this',
        durationMs: 15_000,
      });
      expect(added.visible).toBe(true);
      expect(added.annotations).toHaveLength(1);
      expect(added.annotations[0].kind).toBe('freehand');
      expect(added.annotations[0].svgPath).toContain('C ');

      const withArrow = await bridge.drawingAdd({
        kind: 'arrow',
        start: { x: 50, y: 50 },
        end: { x: 300, y: 200 },
        curved: true,
        step: 1,
        label: 'Click Save',
      });
      expect(withArrow.annotations).toHaveLength(2);
      expect(withArrow.canUndo).toBe(true);

      const undone = await bridge.drawingUndo();
      expect(undone.annotations).toHaveLength(1);
      expect(undone.canRedo).toBe(true);

      const redone = await bridge.drawingRedo();
      expect(redone.annotations).toHaveLength(2);

      const mapped = await bridge.drawingMapCoord({
        x: 683,
        y: 384,
        sourceWidth: 1366,
        sourceHeight: 768,
        displayX: 0,
        displayY: 0,
        displayWidth: 1920,
        displayHeight: 1080,
      });
      expect(mapped.x).toBeCloseTo(960, 0);
      expect(mapped.y).toBeCloseTo(540, 0);
      expect(mapped.computerUseResolution).toEqual({ width: 1366, height: 768 });

      const stopped = await bridge.drawingEmergencyStop();
      expect(stopped.visible).toBe(false);
      expect(stopped.interactive).toBe(false);
      expect(stopped.annotations).toHaveLength(0);
    } finally {
      await bridge.dispose();
    }
  });

  it('renders all 7 SVG primitives, spotlight mask, and interactive toolbar with Escape exit', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onClear = vi.fn();
    const onExitInteractive = vi.fn();

    const snapshot: ScreenDrawingSceneSnapshot = {
      visible: true,
      interactive: true,
      generation: 7,
      canUndo: true,
      canRedo: true,
      updatedAt: Date.now(),
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      annotations: [
        { id: '1', kind: 'freehand', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, svgPath: 'M 10 10 C 20 20, 30 10, 40 20' },
        { id: '2', kind: 'arrow', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, start: { x: 20, y: 20 }, end: { x: 180, y: 100 }, svgPath: 'M 20 20 Q 100 10, 180 100', label: 'Submit', step: 1 },
        { id: '3', kind: 'box', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: true, pinned: true, bounds: { x: 100, y: 100, width: 120, height: 50 }, label: 'Button' },
        { id: '4', kind: 'circle', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, bounds: { x: 300, y: 120, width: 60, height: 60 } },
        { id: '5', kind: 'callout', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, anchor: { x: 500, y: 200 }, label: 'Look here' },
        { id: '6', kind: 'spotlight', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, bounds: { x: 40, y: 40, width: 220, height: 140 }, dimOpacity: 0.5 },
        { id: '7', kind: 'pointer_flight', createdAt: 1, expiresAt: null, strokeWidth: 3, opacity: 1, dashed: false, pinned: true, start: { x: 10, y: 10 }, end: { x: 600, y: 350 }, svgPath: 'M 10 10 Q 305 130, 600 350', label: 'Target' },
      ],
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ScreenDrawingOverlay
          snapshotOverride={snapshot}
          onUndo={onUndo}
          onRedo={onRedo}
          onClear={onClear}
          onExitInteractive={onExitInteractive}
        />,
      );
    });

    expect(container.querySelector('[data-testid="drawing-spotlight-dim"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-freehand"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-arrow"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-box"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-circle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-callout"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-spotlight"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="drawing-node-pointer_flight"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="screen-drawing-toolbar"]')).toBeTruthy();

    const buttons = [...container.querySelectorAll('button')];
    const clickButton = (label: string) => {
      const btn = buttons.find((b) => b.textContent === label);
      expect(btn).toBeTruthy();
      act(() => { btn?.click(); });
    };

    clickButton('Undo');
    clickButton('Redo');
    clickButton('Clear');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onExitInteractive).toHaveBeenCalledTimes(1);

    act(() => { root.unmount(); });
    container.remove();
  });
});
