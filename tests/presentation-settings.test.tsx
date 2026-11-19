/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import type { VoiceModelInfo, VoiceModelProgress } from '../src/shared/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  window.cypsShell = undefined;
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

describe('local voice model settings', () => {
  it('shows readiness, downloads the selected model, and persists the Kokoro choice', async () => {
    let models: VoiceModelInfo[] = [
      { id: 'base.en', label: 'Base English · balanced', kind: 'stt', sizeBytes: 152_000_000, downloaded: false, valid: false, license: 'MIT', source: 'test' },
      { id: 'kokoro-v1.0-int8', label: 'Kokoro English', kind: 'tts', sizeBytes: 143_000_000, downloaded: false, valid: false, license: 'Apache-2.0', source: 'test' },
    ];
    let progressHandler: ((progress: VoiceModelProgress | null) => void) | null = null;
    const download = vi.fn(async (id: VoiceModelInfo['id']) => {
      models = models.map((model) => model.id === id ? { ...model, downloaded: true, valid: true } : model);
      return { ok: true };
    });
    const shell = {
      voiceCapability: async () => ({ speechToText: false, textToSpeech: false }),
      voiceModelsList: async () => models,
      voiceVoicesList: async () => ['Microsoft David'],
      voiceModelDownload: download,
      voiceModelCancelDownload: async () => true,
      voiceModelRemove: async () => ({ ok: true }),
      onVoiceModelsProgress: (handler: (progress: VoiceModelProgress | null) => void) => { progressHandler = handler; return () => { progressHandler = null; }; },
    } as unknown as NonNullable<Window['cypsShell']>;
    window.cypsShell = shell;
    const onPatch = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(SettingsPanel, {
        settings: structuredClone(DEFAULT_SETTINGS),
        displays: [],
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
      await Promise.resolve();
    });
    expect(progressHandler).toBeTypeOf('function');
    expect(host.textContent).toContain('not downloaded');

    const downloadButton = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Download model');
    expect(downloadButton).toBeDefined();
    await act(async () => {
      downloadButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(download).toHaveBeenCalledWith('base.en');
    expect(host.textContent).toContain('Downloaded; actual load and inference are confirmed by Voice Test.');

    const engine = host.querySelector<HTMLSelectElement>('[aria-label="Speech output engine"]');
    expect(engine).not.toBeNull();
    await act(async () => {
      if (!engine) throw new Error('Speech output engine selector is missing.');
      engine.value = 'kokoro';
      engine.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPatch).toHaveBeenCalledWith({ voice: { ttsEngine: 'kokoro', ttsVoice: null } });
  });

  it('reports an unavailable native voice bridge instead of starting an implicit test', async () => {
    window.cypsShell = {
      voiceCapability: async () => ({ speechToText: false, textToSpeech: false, reason: 'Unavailable in test.' }),
    } as unknown as NonNullable<Window['cypsShell']>;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(SettingsPanel, {
        settings: structuredClone(DEFAULT_SETTINGS),
        displays: [],
        onPatch: vi.fn(),
        onRequestMode: vi.fn(),
        onClose: vi.fn(),
        hasApiKey: false,
        onSaveApiKey: async () => ({ ok: true }),
        onRemoveApiKey: async () => ({ ok: true }),
        onTestConnection: async () => ({ ok: true }),
        error: null,
        saving: false,
      }));
      await Promise.resolve();
    });
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Test recognition');
    await act(async () => { button?.click(); await Promise.resolve(); });
    expect(host.textContent).toContain('The local voice test is unavailable in this Pixel build.');
  });
});
