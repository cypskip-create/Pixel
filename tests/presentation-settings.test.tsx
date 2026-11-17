/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';
import { DEFAULT_SETTINGS } from '../src/shared/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('pinned and cursor companion preferences', () => {
  it('shows the pinned bar, selects a display, and toggles the independent cursor companion', () => {
    const onPatch = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    act(() => {
      root?.render(createElement(SettingsPanel, {
        settings: structuredClone(DEFAULT_SETTINGS),
        displays: [
          { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1, label: 'Main', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
          { id: 'display-2', width: 2560, height: 1440, scaleFactor: 1.25, label: 'Side', bounds: { x: -2560, y: 0, width: 2560, height: 1440 } },
        ],
        onPatch,
        onRequestMode: vi.fn(),
        onClose: vi.fn(),
        hasApiKey: false,
        onSaveApiKey: async () => ({ ok: true }),
        onRemoveApiKey: async () => ({ ok: true }),
        onTestConnection: async () => ({ ok: true }),
        error: null,
        saving: false,
      }));
    });

    expect(host.textContent).toContain('Pinned top bar');
    expect(host.textContent).toContain('Always on');

    const displaySelect = host.querySelector<HTMLSelectElement>('[aria-label="Move Pixel to display"]');
    expect(displaySelect).not.toBeNull();
    act(() => {
      if (!displaySelect) throw new Error('Display selector is missing.');
      displaySelect.value = 'display-2';
      displaySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPatch).toHaveBeenCalledWith({ companion: { monitorId: 'display-2' } });

    const cursorToggle = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.closest('label')?.textContent?.includes('Show cursor companion'));
    expect(cursorToggle).not.toBeNull();
    act(() => {
      if (!cursorToggle) throw new Error('Cursor companion toggle is missing.');
      cursorToggle.click();
    });
    expect(onPatch).toHaveBeenCalledWith({ companion: { cursorCompanionEnabled: true } });

    const searchProvider = host.querySelector<HTMLSelectElement>('[aria-label="Default search engine"]');
    expect(searchProvider).not.toBeNull();
    act(() => {
      if (!searchProvider) throw new Error('Default search engine selector is missing.');
      searchProvider.value = 'duckduckgo';
      searchProvider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPatch).toHaveBeenCalledWith({ browserSearchProvider: 'duckduckgo' });
  });
});
