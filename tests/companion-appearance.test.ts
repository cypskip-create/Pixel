import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('floating companion appearance', () => {
  it('restores dark surfaces and removes all system and CSS backdrop materials', () => {
    const css = read('src/renderer/index.css');
    const app = read('src/renderer/App.tsx');
    const windows = read('src/main/window.ts');
    const mainWindow = windows.slice(windows.indexOf('createMainWindow()'), windows.indexOf('createSettingsWindow()'));

    expect(css).toContain('--color-glass: rgb(13 17 28 / 0.88)');
    expect(css).toContain('--color-glass-raised: rgb(22 28 43 / 0.95)');
    expect(css).toContain('--color-glass-border: rgb(255 255 255 / 0.1)');
    expect(css).toContain('--color-glass-border-strong: rgb(255 255 255 / 0.18)');
    expect(css).toContain('0 18px 44px -12px rgb(0 0 0 / 0.6)');
    expect(css).toContain('0 26px 60px -16px rgb(0 0 0 / 0.7)');
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toContain('data-pixel-glass');
    expect(app).not.toContain('pixel-glass');
    expect(mainWindow).toContain('transparent: true');
    expect(mainWindow).toContain("backgroundMaterial: 'none'");
    expect(windows).not.toContain("backgroundMaterial: 'acrylic'");
    expect(windows).not.toContain("backgroundMaterial: 'mica'");
    expect(windows.match(/backgroundMaterial: 'none'/g)).toHaveLength(2);
  });
});
