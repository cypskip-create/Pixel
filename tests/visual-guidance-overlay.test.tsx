/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CypsBridge, VisualGuidanceSnapshot } from '../src/shared/types';
import { BridgeContext } from '../src/renderer/hooks/useBridge';
import type { BridgeStatus } from '../src/renderer/lib/bridge';
import { VisualGuidanceOverlay } from '../src/renderer/components/VisualGuidanceOverlay';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function setup() {
  let update: ((snapshot: VisualGuidanceSnapshot) => void) | null = null;
  const unsubscribe = vi.fn();
  const bridge = {
    screen: {
      onGuidanceUpdate: (handler: (snapshot: VisualGuidanceSnapshot) => void) => {
        update = handler;
        return unsubscribe;
      },
    },
  } as unknown as CypsBridge;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <BridgeContext.Provider value={{ kind: 'ready', bridge } as BridgeStatus}>
      <VisualGuidanceOverlay />
    </BridgeContext.Provider>,
  ));
  return { getUpdate: () => update, unsubscribe };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('visual guidance overlay', () => {
  it('renders rectangle, circle, arrow, numbered text, and remains pointer-transparent', () => {
    const { getUpdate } = setup();
    const snapshot: VisualGuidanceSnapshot = {
      visible: true,
      bounds: { x: 0, y: 0, width: 500, height: 300 },
      annotations: [
        { id: 'r', shape: 'rectangle', bounds: { x: 20, y: 40, width: 90, height: 32 }, label: 'Settings' },
        { id: 'c', shape: 'circle', bounds: { x: 150, y: 80, width: 48, height: 48 } },
        { id: 'a', shape: 'arrow', bounds: { x: 260, y: 100, width: 60, height: 32 }, step: 2 },
      ],
    };
    act(() => getUpdate()?.(snapshot));
    expect(host?.querySelector('rect[rx=\"4\"]')).not.toBeNull();
    expect(host?.querySelector('ellipse')).not.toBeNull();
    expect(host?.querySelector('path')).not.toBeNull();
    expect(host?.textContent).toContain('Settings');
    expect(host?.textContent).toContain('Step 2');
    expect(host?.querySelector('svg')?.className.baseVal).toContain('pointer-events-none');
  });

  it('unsubscribes when the passive overlay closes', () => {
    const { unsubscribe } = setup();
    act(() => root?.unmount());
    root = null;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
