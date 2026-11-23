import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachWindowSecurityPolicy,
  isSafeDevServerUrl,
  isTrustedRendererUrl,
  validateExternalUrl,
  type HardenableWebContents,
} from '../src/main/windowPolicy';
import { IpcHandlerRegistry } from '../src/main/ipc/registry';
import { PixelBoardService } from '../src/main/board/service';
import {
  boardSvg,
  buildAlignmentOperations,
  objectIntersectsRect,
  snapPointToGrid,
  validateBoardDocument,
  type BoardObject,
} from '../src/shared/drawingBoard';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Phase F: Electron Window Security Hardening', () => {
  it('validates external URLs strictly and rejects malicious or credentialed schemes', () => {
    expect(validateExternalUrl('https://github.com/cypskip-create/Pixel')).toBe('https://github.com/cypskip-create/Pixel');
    expect(validateExternalUrl('http://example.com/docs')).toBe('http://example.com/docs');
    expect(validateExternalUrl('javascript:alert(1)')).toBeNull();
    expect(validateExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(validateExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBeNull();
    expect(validateExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(validateExternalUrl('ms-msdt:/id PCWDiagnostic')).toBeNull();
    expect(validateExternalUrl('https://user:pass@example.com/')).toBeNull();
    expect(validateExternalUrl('https://example.com/\nfoo')).toBeNull();
  });

  it('restricts trusted renderer URLs to exact file path or loopback dev server', () => {
    const rendererPath = join(tmpdir(), 'pixel-renderer-test', 'index.html');
    const trustedFileUrl = pathToFileURL(rendererPath).toString();
    expect(isTrustedRendererUrl(trustedFileUrl, rendererPath, null)).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL(join(tmpdir(), 'other.html')).toString(), rendererPath, null)).toBe(false);
    expect(isTrustedRendererUrl('https://evil.example/', rendererPath, null)).toBe(false);

    expect(isSafeDevServerUrl('http://127.0.0.1:5199')).toBe(true);
    expect(isSafeDevServerUrl('http://localhost:5199')).toBe(true);
    expect(isSafeDevServerUrl('https://evil.example:5199')).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5199/', rendererPath, 'http://127.0.0.1:5199')).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:5199/other', rendererPath, 'http://127.0.0.1:5199')).toBe(false);
    expect(isTrustedRendererUrl('https://evil.example/', rendererPath, 'https://evil.example')).toBe(false);
  });

  it('enforces window-open, will-navigate, will-redirect, will-attach-webview, and permission guards', () => {
    const rendererPath = join(tmpdir(), 'pixel-renderer-test', 'index.html');
    const trustedFileUrl = pathToFileURL(rendererPath).toString();
    const openedExternally: string[] = [];
    const blocked: Array<{ kind: string; target: string }> = [];

    let openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null;
    const listeners = new Map<string, (event: { preventDefault(): void }, arg?: string) => void>();
    let permHandler: ((wc: unknown, perm: string, cb: (ok: boolean) => void, details?: { requestingUrl?: string }) => void) | null = null;

    const fakeContents: HardenableWebContents = {
      setWindowOpenHandler: (handler) => { openHandler = handler; },
      on: (event, listener) => { listeners.set(event, listener as (event: { preventDefault(): void }, arg?: string) => void); },
      session: {
        setPermissionRequestHandler: (handler) => { permHandler = handler; },
      },
    };

    attachWindowSecurityPolicy(fakeContents, {
      windowRole: 'workspace',
      rendererIndexPath: rendererPath,
      devServerUrl: null,
      allowExternalLinks: true,
      openExternal: (url) => openedExternally.push(url),
      onBlocked: (ev) => blocked.push({ kind: ev.kind, target: ev.target }),
    });

    // Window open always denies child BrowserWindow; opens only validated HTTPS/HTTP externally.
    expect(openHandler!({ url: 'https://github.com/cypskip-create/Pixel' })).toEqual({ action: 'deny' });
    expect(openedExternally).toEqual(['https://github.com/cypskip-create/Pixel']);
    expect(openHandler!({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(openedExternally).toHaveLength(1);

    // will-navigate & will-redirect block untrusted URLs and allow trusted renderer URL.
    let prevented = false;
    listeners.get('will-navigate')!({ preventDefault: () => { prevented = true; } }, 'https://evil.example');
    expect(prevented).toBe(true);

    prevented = false;
    listeners.get('will-navigate')!({ preventDefault: () => { prevented = true; } }, trustedFileUrl);
    expect(prevented).toBe(false);

    prevented = false;
    listeners.get('will-redirect')!({ preventDefault: () => { prevented = true; } }, 'https://evil.example/redirect');
    expect(prevented).toBe(true);

    // will-attach-webview always prevents attachment.
    prevented = false;
    listeners.get('will-attach-webview')!({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);

    // Session permissions: allow media on trusted origin, deny geolocation & untrusted origins.
    let granted = false;
    permHandler!(null, 'media', (ok) => { granted = ok; }, { requestingUrl: trustedFileUrl });
    expect(granted).toBe(true);

    permHandler!(null, 'geolocation', (ok) => { granted = ok; }, { requestingUrl: trustedFileUrl });
    expect(granted).toBe(false);

    permHandler!(null, 'media', (ok) => { granted = ok; }, { requestingUrl: 'https://evil.example' });
    expect(granted).toBe(false);
    expect(blocked.length).toBeGreaterThanOrEqual(4);
  });

  it('installs centralized security hardening across all BrowserWindows in window.ts and app.ts', () => {
    const windowSrc = readFileSync(join(process.cwd(), 'src', 'main', 'window.ts'), 'utf8');
    const appSrc = readFileSync(join(process.cwd(), 'src', 'main', 'app.ts'), 'utf8');

    const windowCreations = (windowSrc.match(/new BrowserWindow\(/g) ?? []).length;
    const hardenCalls = (windowSrc.match(/this\.hardenWindow\(/g) ?? []).length;
    expect(windowCreations).toBe(5);
    expect(hardenCalls).toBe(5);
    expect(appSrc).toContain('attachWindowSecurityPolicy(diagnostic.webContents');
    expect(appSrc).toContain("contents.on('will-attach-webview'");
  });
});

describe('Phase F: Modular IPC Registry Boundaries', () => {
  it('enforces unique channel registration, trusted-sender checks, and clean disposal', () => {
    const handlers = new Map<string, (event: any, ...args: any[]) => unknown>();
    let trusted = true;
    const registry = new IpcHandlerRegistry({
      handle: (channel, listener) => handlers.set(channel, listener),
      removeHandler: (channel) => handlers.delete(channel),
      isTrustedSender: () => trusted,
    });

    registry.registerHandler('test:ping', () => 'pong');
    expect(() => registry.registerHandler('test:ping', () => 'dup')).toThrow(/Duplicate IPC handler/);
    expect(registry.listChannels()).toEqual(['test:ping']);

    expect(handlers.get('test:ping')!({})).toBe('pong');
    trusted = false;
    expect(() => handlers.get('test:ping')!({})).toThrow(/Unauthorized IPC sender/);

    registry.dispose();
    expect(registry.listChannels()).toEqual([]);
    expect(handlers.size).toBe(0);
  });
});

describe('Phase F: Pixel Board Multi-Selection, Alignment, Snapping & Linked Connectors', () => {
  it('snaps coordinates to grid, detects marquee intersections, and aligns multiple objects atomically with undo/redo', () => {
    expect(snapPointToGrid({ x: 31, y: 49 }, 20)).toEqual({ x: 40, y: 40 });

    const dir = mkdtempSync(join(tmpdir(), 'pixel-board-phase-f-'));
    tempDirs.push(dir);
    const service = new PixelBoardService(join(dir, 'draft.json'));

    const rectA: BoardObject = { id: 'a', kind: 'rectangle', points: [{ x: 100, y: 100 }, { x: 200, y: 160 }], color: '#4299F5', width: 2 };
    const rectB: BoardObject = { id: 'b', kind: 'rectangle', points: [{ x: 350, y: 220 }, { x: 450, y: 280 }], color: '#4299F5', width: 2 };
    const rectC: BoardObject = { id: 'c', kind: 'rectangle', points: [{ x: 700, y: 300 }, { x: 800, y: 360 }], color: '#4299F5', width: 2 };

    service.apply([
      { type: 'add', object: rectA },
      { type: 'add', object: rectB },
      { type: 'add', object: rectC },
    ]);

    expect(objectIntersectsRect(rectA, { minX: 90, minY: 90, maxX: 250, maxY: 200 })).toBe(true);
    expect(objectIntersectsRect(rectC, { minX: 90, minY: 90, maxX: 250, maxY: 200 })).toBe(false);

    const alignOps = buildAlignmentOperations(service.getSnapshot().document.objects, ['a', 'b', 'c'], 'top');
    expect(alignOps.length).toBe(2);
    const aligned = service.apply(alignOps, service.getSnapshot().revision);
    expect(aligned.document.objects.every((o) => o.points[0]?.y === 100)).toBe(true);

    // Undo restores pre-alignment coordinates cleanly.
    const undone = service.undo(aligned.revision);
    expect(undone.document.objects.find((o) => o.id === 'b')?.points[0]?.y).toBe(220);
  });

  it('moves linked connectors automatically when connected objects move, detaches on delete, and exports to SVG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-board-conn-'));
    tempDirs.push(dir);
    const service = new PixelBoardService(join(dir, 'draft.json'));

    const node1: BoardObject = { id: 'n1', kind: 'rectangle', points: [{ x: 100, y: 100 }, { x: 200, y: 160 }], color: '#4299F5', width: 2 };
    const node2: BoardObject = { id: 'n2', kind: 'rectangle', points: [{ x: 400, y: 100 }, { x: 500, y: 160 }], color: '#4299F5', width: 2 };
    const conn: BoardObject = {
      id: 'c1',
      kind: 'connector',
      points: [{ x: 200, y: 130 }, { x: 400, y: 130 }],
      fromId: 'n1',
      toId: 'n2',
      arrowHead: true,
      color: '#4299F5',
      width: 2,
    };

    const s1 = service.apply([
      { type: 'add', object: node1 },
      { type: 'add', object: node2 },
      { type: 'add', object: conn },
    ]);

    // Move node2 down by +100px -> connector endpoint must follow automatically!
    const s2 = service.apply([{ type: 'move', id: 'n2', dx: 0, dy: 100 }], s1.revision);
    const updatedConn = s2.document.objects.find((o) => o.id === 'c1');
    expect(updatedConn?.points[1]?.y).toBeGreaterThan(180);

    // Persists & validates cleanly and exports SVG.
    expect(validateBoardDocument(s2.document)).not.toBeNull();
    const svg = boardSvg(s2.document);
    expect(svg).toContain('<svg ');
    expect(svg).toContain('<path ');

    // Deleting node2 detaches `toId` without leaving a dangling reference.
    const s3 = service.apply([{ type: 'delete', id: 'n2' }], s2.revision);
    const detachedConn = s3.document.objects.find((o) => o.id === 'c1');
    expect(detachedConn?.toId).toBeUndefined();
    expect(detachedConn?.fromId).toBe('n1');
  });
});
