/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoicePlaybackState } from '../src/renderer/hooks/useVoicePlaybackState';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let reportPlayback: ((active: boolean) => void) | null = null;
let resolveInitial: ((active: boolean) => void) | null = null;

function PlaybackState(): React.JSX.Element {
  const active = useVoicePlaybackState();
  return <output>{active ? 'speaking' : 'idle'}</output>;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  reportPlayback = null;
  resolveInitial = null;
  delete window.cypsShell;
});

describe('shared voice playback state', () => {
  it('uses live playback events over a stale initial-state query', async () => {
    const shell = {
      onVoicePlaybackState: vi.fn((handler: (active: boolean) => void) => {
        reportPlayback = handler;
        return () => { reportPlayback = null; };
      }),
      voicePlaybackActive: vi.fn(() => new Promise<boolean>((resolve) => { resolveInitial = resolve; })),
    } as unknown as NonNullable<Window['cypsShell']>;
    window.cypsShell = shell;

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<PlaybackState />));
    act(() => reportPlayback?.(true));
    await act(async () => { resolveInitial?.(false); await Promise.resolve(); });

    expect(host.textContent).toBe('speaking');
  });
});
