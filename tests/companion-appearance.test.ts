import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('floating companion appearance', () => {
  it('uses opaque neutral surfaces and removes all system and CSS backdrop materials', () => {
    const css = read('src/renderer/index.css');
    const app = read('src/renderer/App.tsx');
    const windows = read('src/main/window.ts');
    const mainWindow = windows.slice(windows.indexOf('createMainWindow()'), windows.indexOf('createSettingsWindow()'));

    expect(css).toContain('--color-app-bg: #0C0B0A');
    expect(css).toContain('--color-sidebar: #11100F');
    expect(css).toContain('--color-surface: #1B1816');
    expect(css).toContain('--color-surface-raised: #211D1A');
    expect(css).toContain('@utility pixel-surface');
    expect(css).toContain('background: var(--color-surface);');
    expect(css).not.toContain('--color-glass');
    expect(css).not.toContain('gradient(');
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('data-pixel-glass');
    expect(app).not.toContain('glass');
    expect(mainWindow).toContain('transparent: true');
    expect(mainWindow).toContain("backgroundMaterial: 'none'");
    expect(windows).not.toContain("backgroundMaterial: 'acrylic'");
    expect(windows).not.toContain("backgroundMaterial: 'mica'");
    expect(windows.match(/backgroundMaterial: 'none'/g)).toHaveLength(3);
    expect(windows).toContain("backgroundColor: '#1b1b1b'");
    expect(windows).toContain("backgroundColor: '#0d0d0d'");
  });
});
