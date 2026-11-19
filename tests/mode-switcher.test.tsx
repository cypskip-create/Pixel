/** @vitest-environment jsdom */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputBar } from '../src/renderer/components/InputBar';
import type { ImageAttachment, Mode } from '../src/shared/types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function renderInputBar(): { onRequestMode: ReturnType<typeof vi.fn>; host: HTMLDivElement } {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onRequestMode = vi.fn<(mode: Mode) => void>();
  const Harness = (): React.JSX.Element => {
    const [modeMenuOpen, setModeMenuOpen] = useState(false);
    const emptyImages: ImageAttachment[] = [];
    return (
      <InputBar
        mode="guide"
        state="idle"
        draft=""
        onDraftChange={vi.fn()}
        onSubmit={vi.fn()}
        onStop={vi.fn()}
        onCollapse={vi.fn()}
        onAttachScreenshot={vi.fn()}
        onAttachFile={vi.fn()}
        onToggleListening={vi.fn()}
        listening={false}
        attachments={emptyImages}
        onRemoveAttachment={vi.fn()}
        onRequestMode={(mode) => {
          onRequestMode(mode);
          setModeMenuOpen(false);
        }}
        modeMenuOpen={modeMenuOpen}
        onToggleModeMenu={() => setModeMenuOpen((open) => !open)}
        onCloseModeMenu={() => setModeMenuOpen(false)}
        busy={false}
        disabled={false}
      />
    );
  };
  act(() => root?.render(<Harness />));
  const modeButton = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  act(() => modeButton?.click());
  return { onRequestMode, host };
}

function cleanup(): void {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

afterEach(cleanup);

describe('operating mode popover', () => {
  it('renders one accessible menu with all three operating modes', () => {
    const { host: rendered } = renderInputBar();

    expect(rendered.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(rendered.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    const selected = rendered.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    expect(selected?.className).toContain('ring-[var(--color-accent)]');
    expect(selected?.querySelector('span')?.className).toContain('border-[var(--color-accent)]');
    expect(rendered.textContent).toContain('Guide');
    expect(rendered.textContent).toContain('Hybrid');
    expect(rendered.textContent).toContain('Agent');
  });

  it('calls the mode request callback when a mode is selected', () => {
    const { onRequestMode, host: rendered } = renderInputBar();
    const agent = rendered.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="false"]');

    act(() => agent?.click());

    expect(onRequestMode).toHaveBeenCalledWith('hybrid');
  });

  it('supports arrow-key navigation through the operating modes', () => {
    const { host: rendered } = renderInputBar();
    const guide = rendered.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    const hybrid = rendered.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="false"]');

    act(() => {
      guide?.focus();
      guide?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(document.activeElement).toBe(hybrid);
  });

  it('dismisses on Escape and returns focus to the mode button', async () => {
    const { host: rendered } = renderInputBar();
    const modeButton = rendered.querySelector<HTMLButtonElement>('[aria-controls="pixel-mode-menu"]');
    expect(modeButton).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });

    expect(rendered.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(modeButton);
  });

  it('dismisses when the user clicks outside the menu', () => {
    const { host: rendered } = renderInputBar();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    expect(rendered.querySelector('[role="menu"]')).toBeNull();
  });
});
