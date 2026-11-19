import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeExternalHttpUrl } from '../src/shared/externalUrl';
import { mergeSettings } from '../src/shared/types';
import { isCursorIpcChannelAllowed, isTrustedRendererUrl } from '../src/main/windowPolicy';
import { CHANNELS } from '../src/shared/channels';

describe('Workspace window policy', () => {
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
  it('limits the cursor companion to readiness and its reduced-motion preference', () => {
    expect(isCursorIpcChannelAllowed(CHANNELS.windowCursorRendererReady)).toBe(true);
    expect(isCursorIpcChannelAllowed(CHANNELS.windowCursorSettingsGet)).toBe(true);
    expect(isCursorIpcChannelAllowed(CHANNELS.settingsGet)).toBe(false);
    expect(isCursorIpcChannelAllowed(CHANNELS.settingsSet)).toBe(false);
    expect(isCursorIpcChannelAllowed(CHANNELS.screenCaptureDisplay)).toBe(false);
    expect(isCursorIpcChannelAllowed(CHANNELS.systemEmergencyStop)).toBe(false);
  });

  it('keeps the renderer identity and per-channel cursor gate connected', () => {
    const ipc = readFileSync(join(process.cwd(), 'src', 'main', 'ipc.ts'), 'utf8');
    const windows = readFileSync(join(process.cwd(), 'src', 'main', 'window.ts'), 'utf8');
    expect(ipc).toContain('isCursorIpcChannelAllowed(channel) &&');
    expect(ipc).toContain('windows.isTrustedCursorApplicationSender(event.sender, event.senderFrame)');
    expect(windows).toContain('frame !== sender.mainFrame');
    expect(windows).toContain('isTrustedRendererUrl(frame.url, this.deps.rendererIndexPath, this.deps.devServerUrl)');
  });

  it('gives Cursor Buddy only the reduced-motion preference instead of all settings', () => {
    const ipc = readFileSync(join(process.cwd(), 'src', 'main', 'ipc.ts'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8');
    const start = app.indexOf('function CursorCompanionWindow()');
    const end = app.indexOf('/* ------------------------------------------------------------------ *', start);
    const cursorWindow = app.slice(start, end);
    expect(ipc).toContain('return { reducedMotion: settings.get().companion.reducedMotion };');
    expect(ipc).toContain('if (!windows.isCursorSender(event.sender))');
    expect(cursorWindow).toContain('window.getCursorSettings()');
    expect(cursorWindow).not.toContain('settings.get()');
  });

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
