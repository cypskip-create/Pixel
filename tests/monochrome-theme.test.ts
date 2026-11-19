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

describe('charcoal Pixel design system', () => {
  const files = sourceFiles(rendererRoot);
  const allRendererSource = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const css = readFileSync(join(rendererRoot, 'index.css'), 'utf8');

  it('defines charcoal surfaces, blue interactive accents, and independent Pix/status colors', () => {
    for (const [token, value] of [
      ['--color-app-bg', '#181818'],
      ['--color-sidebar', '#1B1B1B'],
      ['--color-surface', '#343434'],
      ['--color-surface-raised', '#232323'],
      ['--color-hover', '#303030'],
      ['--color-selected', '#494949'],
      ['--color-border', '#353535'],
      ['--color-border-strong', '#505050'],
      ['--color-ink', '#F3F3F3'],
      ['--color-ink-soft', '#D3D3D3'],
      ['--color-ink-dim', '#ABABAB'],
      ['--color-accent', '#4299F5'],
      ['--color-accent-hover', '#60A9FA'],
      ['--color-warning', '#D5AB72'],
      ['--color-destructive', '#D88B83'],
      ['--pix-face', '#0E1013'],
      ['--pix-fold', '#A7D7C2'],
      ['--pix-eye', '#9BE5C7'],
    ]) {
      expect(css).toContain(`${token}: ${value}`);
    }
    expect(css).toContain('.theme-light');
    expect(css).toContain('--color-brand-foreground: var(--color-icon)');
  });

  it('limits chromatic color values to the approved palette', () => {
    expect(allRendererSource).not.toMatch(/(?:sky|blue|cyan|teal|emerald|green|yellow|rose|orange|violet|purple|indigo)-\d{2,3}/i);
    const approvedTints = new Set([
      '0e1013', '101113', '1a1e23', '20252a', '2a3138', '333a40', '394147', '3a4147', '515a61',
      'e6e9ed', 'c6cacd', '9aa1a6', 'd2d7db', 'a7d7c2', 'd6ede3', 'd5ab72', 'd88b83',
      '4299f5', '60a9fa', '1d70c9', '185ea9', '214d90', '181818', '1b1b1b', '232323', '303030', '353535', '505050', '171717', '252525', '343434', '202020', '414141', '494949', '444444', '595959', 'f3f3f3', 'd3d3d3', 'ababab', 'd8d8d8',
      '090909', '050505', '2b2b2b', 'e4e4e4', '111111', '555555', 'f0f0f0', 'bfbfbf',
      '9be5c7', '8cb8a5', '557765', '476653', 'a85049', '8c6330', '181b1e', 'aeb5bc', 'b8bec2', 'c7cdd2', '8cbca5', 'f3f4f5', '777e82', '353a3f', 'd1d5d8',
      'f1f3f3', 'e7eaea', 'f7f9f9', 'e3e7e7', 'd7dedd', 'c8d0ce', '9aa6a2', 'f5f7f6',
      '161b1a', '414947', '68716e',
    ]);

    for (const match of allRendererSource.matchAll(/#([\da-f]{3,8})\b/gi)) {
      if (approvedTints.has((match[1] ?? '').toLowerCase())) continue;
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
    expect(CURSOR_ICON_HOTSPOT).toEqual({ x: 2, y: 29 });
    expect(cursor).toContain('width="28"');
    expect(cursor).toContain('height="28"');
    expect(cursor).toContain('viewBox="0 0 32 32"');
    expect(cursor).toContain('rect x="8" y="7" width="17" height="12" rx="4"');
    expect(cursor).not.toMatch(/#(?:02f3fe|73f9fd)/i);
  });
});
