import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import mark from '../src/shared/pixelMark.json';
import { PixelMark } from '../src/renderer/components/PixelMark';
import {
  CURSOR_ICON_HOTSPOT,
  CURSOR_ICON_VIEWBOX_SIZE,
  CURSOR_VISIBLE_SIZE,
  CURSOR_WINDOW_HOTSPOT,
  CURSOR_WINDOW_SIZE,
} from '../src/shared/companion/cursorFollow';

const rendererRoot = join(process.cwd(), 'src', 'renderer');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

function expandHex(hex: string): string[] {
  if (hex.length === 3 || hex.length === 4) {
    const expanded = [...hex].map((channel) => channel + channel);
    return expanded.slice(0, 3);
  }
  return [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
}

describe('monochrome Pixel design', () => {
  const files = sourceFiles(rendererRoot);
  const allRendererSource = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const css = readFileSync(join(rendererRoot, 'index.css'), 'utf8');

  it('defines the agreed semantic dark palette and a grayscale light theme', () => {
    for (const [token, value] of [
      ['--color-app-bg', '#0D0D0D'],
      ['--color-sidebar', '#141414'],
      ['--color-surface', '#1B1B1B'],
      ['--color-surface-raised', '#222222'],
      ['--color-hover', '#292929'],
      ['--color-selected', '#303030'],
      ['--color-border', '#333333'],
      ['--color-ink', '#F4F4F4'],
      ['--color-ink-soft', '#B8B8B8'],
      ['--color-ink-dim', '#888888'],
      ['--color-icon', '#D4D4D4'],
    ]) {
      expect(css).toContain(`${token}: ${value}`);
    }
    expect(css).toContain('.theme-light');
    expect(css).toContain('--color-brand-foreground: var(--color-icon)');
  });

  it('contains no chromatic utility classes or literal color values in renderer code', () => {
    expect(allRendererSource).not.toMatch(/(?:sky|blue|cyan|teal|emerald|green|amber|yellow|rose|red|orange|violet|purple|indigo)-\d{2,3}/i);

    for (const match of allRendererSource.matchAll(/#([\da-f]{3,8})\b/gi)) {
      const channels = expandHex(match[1] ?? '');
      expect(channels[0]?.toLowerCase()).toBe(channels[1]?.toLowerCase());
      expect(channels[1]?.toLowerCase()).toBe(channels[2]?.toLowerCase());
    }
    for (const match of allRendererSource.matchAll(/rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/gi)) {
      expect(match[1]).toBe(match[2]);
      expect(match[2]).toBe(match[3]);
    }
  });

  it('uses opaque neutral surfaces without frosted-glass materials or decorative gradients', () => {
    expect(css).toContain('background: var(--color-surface);');
    expect(css).not.toMatch(/backdrop-filter|backdrop-blur|Acrylic|Mica|gradient\(/i);
    expect(allRendererSource).not.toMatch(/--color-glass|color-popover-glass|\bglass-raised\b|\bglass\b/i);
  });

  it('renders the approved master P geometry in a monochrome variant', () => {
    const component = readFileSync(join(rendererRoot, 'components', 'PixelMark.tsx'), 'utf8');
    expect(mark.viewBox).toEqual([0, 0, 262, 324]);
    expect(mark.shapes.length).toBeGreaterThan(0);
    expect(component).toContain('monochrome = true');
    expect(component).toContain('mark.shapes');
    expect(component).toContain('MONOCHROME_PALETTE');
    expect(component).toContain('width="262" height="324"');
    const rendered = renderToStaticMarkup(createElement(PixelMark, { size: 24 }));
    expect(rendered).toContain('fill="var(--color-brand-foreground)"');
    expect(rendered).toContain('fill="var(--color-ink-soft)"');
  });

  it('keeps the cursor character small and aligns native geometry to the SVG tip', () => {
    const cursor = readFileSync(join(rendererRoot, 'components', 'CursorBuddy.tsx'), 'utf8');
    expect(CURSOR_VISIBLE_SIZE).toBe(28);
    expect(CURSOR_WINDOW_SIZE).toBe(36);
    expect(CURSOR_ICON_VIEWBOX_SIZE).toBe(32);
    expect(CURSOR_WINDOW_HOTSPOT.x).toBeCloseTo(4 + CURSOR_ICON_HOTSPOT.x * CURSOR_VISIBLE_SIZE / CURSOR_ICON_VIEWBOX_SIZE, 8);
    expect(CURSOR_WINDOW_HOTSPOT.y).toBeCloseTo(4 + CURSOR_ICON_HOTSPOT.y * CURSOR_VISIBLE_SIZE / CURSOR_ICON_VIEWBOX_SIZE, 8);
    expect(cursor).toContain('width="28"');
    expect(cursor).toContain('height="28"');
    expect(cursor).toContain('viewBox="0 0 32 32"');
    expect(cursor).not.toMatch(/#(?:02f3fe|73f9fd)/i);
  });
});
