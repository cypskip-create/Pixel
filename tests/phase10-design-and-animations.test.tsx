// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DynamicIslandHorseCanvas } from '../src/renderer/components/DynamicIslandHorseCanvas';
import { ThinkingParticleCore } from '../src/renderer/components/ThinkingParticleCore';
import { BotCreatorPanel } from '../src/renderer/components/BotCreatorPanel';
import { InteractiveTerminalView } from '../src/renderer/components/InteractiveTerminalView';
import { PIXEL_THEME_PRESETS } from '../src/shared/themes';
import { applyThemePreset } from '../src/renderer/lib/themeEngine';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('Phase 10: Redesign, 60 FPS Animations, Theme Engine, Terminal & Bot Creator', () => {
  it('renders DynamicIslandHorseCanvas and ThinkingParticleCore cleanly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <div>
          <DynamicIslandHorseCanvas running reducedMotion width={300} height={70} />
          <ThinkingParticleCore size={52} reducedMotion label="Thinking…" />
        </div>,
      );
    });

    expect(container.querySelector('[data-testid="dynamic-island-horse-canvas"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="thinking-particle-core"]')).toBeTruthy();
    expect(container.textContent).toContain('Thinking…');

    act(() => { root.unmount(); });
    container.remove();
  });

  it('applies Dark, Light, and curated Hermes theme presets to documentElement', () => {
    expect(PIXEL_THEME_PRESETS.length).toBeGreaterThanOrEqual(12);

    const light = applyThemePreset('paper-light');
    expect(light.mode).toBe('light');
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.dataset.pixelTheme).toBe('paper-light');

    const dark = applyThemePreset('tokyo-night');
    expect(dark.mode).toBe('dark');
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    expect(document.documentElement.dataset.pixelTheme).toBe('tokyo-night');
  });

  it('renders BotCreatorPanel with default bots and launches a bot', () => {
    const onLaunchBot = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<BotCreatorPanel onLaunchBot={onLaunchBot} />);
    });

    expect(container.querySelector('[data-testid="bot-creator-panel"]')).toBeTruthy();
    expect(container.textContent).toContain('Chief of Staff Bot');
    expect(container.textContent).toContain('Computer Use');

    const runBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Run Bot in Chat'));
    expect(runBtn).toBeTruthy();
    act(() => { runBtn?.click(); });
    expect(onLaunchBot).toHaveBeenCalledTimes(1);

    act(() => { root.unmount(); });
    container.remove();
  });

  it('renders InteractiveTerminalView with direct shell command input', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<InteractiveTerminalView />);
    });

    expect(container.querySelector('[data-testid="interactive-terminal-view"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Terminal command input"]')).toBeTruthy();

    act(() => { root.unmount(); });
    container.remove();
  });
});
