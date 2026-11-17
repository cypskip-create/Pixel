import { describe, expect, it } from 'vitest';
import { safeExternalHttpUrl } from '../src/shared/externalUrl';
import { mergeSettings } from '../src/shared/types';
import { isTrustedRendererUrl, supportsWindowsBackdrop } from '../src/main/windowPolicy';

describe('Windows backdrop policy', () => {
  it('opts into acrylic and Mica only on supported Windows 11 builds', () => {
    expect(supportsWindowsBackdrop('10.0.22000')).toBe(false);
    expect(supportsWindowsBackdrop('10.0.22621')).toBe(true);
    expect(supportsWindowsBackdrop('10.0.26100')).toBe(true);
    expect(supportsWindowsBackdrop('6.1.7601')).toBe(false);
    expect(supportsWindowsBackdrop('not-windows')).toBe(false);
  });

  it('bounds restored Workspace dimensions and accepts the configured shortcut', () => {
    const settings = mergeSettings({
      workspaceAccelerator: 'CommandOrControl+Alt+P',
      workspaceWindow: { x: 30_000, y: -30_000, width: 5_000, height: 1, maximized: false },
    });
    expect(settings.workspaceAccelerator).toBe('CommandOrControl+Alt+P');
    expect(settings.workspaceWindow).toEqual({
      x: 20_000,
      y: -20_000,
      width: 3_840,
      height: 600,
      maximized: false,
    });
  });
});

describe('renderer and external-link boundaries', () => {
  it('accepts only the configured development renderer origin and page', () => {
    expect(isTrustedRendererUrl('http://localhost:5199/?window=workspace', 'unused', 'http://localhost:5199')).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5199/index.html?window=settings', 'unused', 'http://localhost:5199')).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5200/', 'unused', 'http://localhost:5199')).toBe(false);
    expect(isTrustedRendererUrl('https://localhost:5199/', 'unused', 'http://localhost:5199')).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5199/untrusted.html', 'unused', 'http://localhost:5199')).toBe(false);
    expect(isTrustedRendererUrl('not a URL', 'unused', 'http://localhost:5199')).toBe(false);
  });

  it('allows parsed HTTP links and rejects custom schemes, credentials, and control characters', () => {
    expect(safeExternalHttpUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(safeExternalHttpUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(safeExternalHttpUrl('file:///C:/secret.txt')).toBeNull();
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalHttpUrl('https://user:pass@example.com')).toBeNull();
    expect(safeExternalHttpUrl('https://example.com/\nmalformed')).toBeNull();
    expect(safeExternalHttpUrl(`https://example.com/${'a'.repeat(4096)}`)).toBeNull();
  });
});
