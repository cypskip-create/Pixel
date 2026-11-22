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

function readDarkToken(token: string): string {
  const match = new RegExp(`${token}:\\s*(#[\\da-f]{6})`, 'i').exec(readFileSync(join(rendererRoot, 'index.css'), 'utf8'));
  if (!match?.[1]) throw new Error(`Missing color token ${token}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = expandHex(hex.slice(1)).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Pixel neutral matte blue design system', () => {
  const files = sourceFiles(rendererRoot);
  const allRendererSource = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const css = readFileSync(join(rendererRoot, 'index.css'), 'utf8');
  const workspaceCss = readFileSync(join(rendererRoot, 'workspace-design-system.css'), 'utf8');

  it('defines near-black matte surfaces, restored blue (#4299F5) functional accents, and independent Pix/status colors', () => {
    for (const [token, value] of [
      ['--color-app-bg', '#0D0E10'],
      ['--color-sidebar', '#111214'],
      ['--color-surface', '#181A1E'],
      ['--color-surface-raised', '#202328'],
      ['--color-hover', '#24272D'],
      ['--color-selected', '#282C33'],
      ['--color-border', '#25282E'],
      ['--color-border-strong', '#373C45'],
      ['--color-ink', '#ECEEF2'],
      ['--color-ink-soft', '#C2C7D0'],
      ['--color-ink-dim', '#9299A6'],
      ['--color-accent', '#4299F5'],
      ['--color-accent-hover', '#60A9FA'],
      ['--color-warning', '#D5A353'],
      ['--color-destructive', '#E06C65'],
      ['--pix-face', '#0E1013'],
      ['--pix-fold', '#A7D7C2'],
      ['--pix-eye', '#9BE5C7'],
    ]) {
      expect(css).toContain(`${token}: ${value}`);
    }
    expect(css).toContain('.theme-light');
    expect(css).toContain('--color-brand-foreground: var(--color-icon)');
  });

  it('prevents orange primary accents and colored selection-edge strips from returning', () => {
    expect(css).not.toMatch(/--color-accent:\s*#(?:f18a4f|f28a43|ffa262|b85b20)/i);
    expect(css).not.toMatch(/box-shadow:\s*inset\s+2px\s+0\s+0\s+var\(--color-accent\)/i);
    expect(workspaceCss).not.toMatch(/box-shadow:\s*inset\s+(?:2px\s+0|0\s+2px)\s+0\s+var\(--color-accent\)/i);
  });

  it('keeps small metadata text and accent labels above WCAG AA contrast on dark surfaces', () => {
    expect(contrastRatio(readDarkToken('--color-ink-dim'), readDarkToken('--color-surface-raised'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readDarkToken('--color-ink-soft'), readDarkToken('--color-surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readDarkToken('--color-accent-foreground'), readDarkToken('--color-accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('limits chromatic color values to the approved palette', () => {
    expect(allRendererSource).not.toMatch(/(?:sky|blue|cyan|teal|emerald|green|yellow|rose|orange|violet|purple|indigo)-\d{2,3}/i);
    const approvedTints = new Set([
      '0c0b0a', '11100f', '1b1816', '211d1a', '28221e', '30231b', '332b26', '51443b', '191613',
      'e9e4dd', 'c9c1b8', '96908a', 'f28a43', 'ffa262', '1a100a', 'd96a2b', 'd56d61', '79b58a',
      '211913', '211e1b', '604735', '0f0e0d', 'e0a16f', 'c88e68', '3a291f', '2b201a',
      'e7a16d', 'bd825b', 'f3d5bd', '8c4d25', 'd8a47e', '29211c', 'f6f2ed', 'efe8e0',
      'fbf8f4', 'eee5dc', 'f6dcc7', 'd8cbbf', 'b7a494', 'b85b20', '964414', '9a4e24',
      'a3443a', '39794c', 'f6e4d6',
      '0d0e10', '111214', '181a1e', '202328', '24272d', '282c33', '25282e', '373c45', '16181c',
      'eceef2', 'c2c7d0', '9299a6', 'c8cdd6', '09131f', 'd5a353', 'e06c65', '5fb382', '1e2127',
      '1f2630', '334154', '141920', '8ab8eb', '7a8ea8', 'f5f6f8', 'e4e7ee', 'dce1eb', 'd4d8e1',
      'aeb6c4', '16181d', '3d434f', '636b7a', '303642', '9a6b1e', 'b8423c', '2f7d52', 'e8eef6',
      'dfe8f5', 'a8c1e0', 'c7d8ee', '1d5a9e', '5a708c', 'f8f9fb',
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
