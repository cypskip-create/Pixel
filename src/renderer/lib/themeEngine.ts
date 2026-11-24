import { DEFAULT_THEME_ID, getThemePreset, PIXEL_THEME_PRESETS, type PixelThemePreset } from '@shared/themes';

const THEME_STORAGE_KEY = 'pixel.appearance.theme-id.v1';

export { PIXEL_THEME_PRESETS, type PixelThemePreset };

export function loadSavedThemeId(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyThemePreset(themeId: string): PixelThemePreset {
  const preset = getThemePreset(themeId);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.pixelTheme = preset.id;
    root.classList.toggle('theme-light', preset.mode === 'light');
    root.classList.toggle('theme-dark', preset.mode !== 'light');

    // Sync ALL root tokens used across index.css & workspace-design-system.css
    root.style.setProperty('--color-app-bg', preset.tokens.canvas);
    root.style.setProperty('--color-canvas', preset.tokens.canvas);
    root.style.setProperty('--color-sidebar', preset.tokens.surface);
    root.style.setProperty('--color-surface', preset.tokens.surface);
    root.style.setProperty('--color-surface-raised', preset.tokens.surfaceRaised);
    root.style.setProperty('--color-surface-hover', preset.tokens.surfaceHover);
    root.style.setProperty('--color-hover', preset.tokens.surfaceHover);
    root.style.setProperty('--color-selected', preset.tokens.surfaceHover);
    root.style.setProperty('--color-border', preset.tokens.border);
    root.style.setProperty('--color-border-strong', preset.tokens.borderStrong);
    root.style.setProperty('--color-ink', preset.tokens.ink);
    root.style.setProperty('--color-ink-soft', preset.tokens.inkMuted);
    root.style.setProperty('--color-ink-muted', preset.tokens.inkMuted);
    root.style.setProperty('--color-ink-dim', preset.tokens.inkDim);
    root.style.setProperty('--color-accent', preset.tokens.accent);
    root.style.setProperty('--color-accent-hover', preset.tokens.accentHover);
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preset.id);
    } catch {
      // Ignore storage failures in sandboxed contexts
    }
  }
  return preset;
}
