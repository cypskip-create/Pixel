import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '../shared/channels';

const CURSOR_IPC_ALLOWLIST = new Set<string>([
  CHANNELS.windowCursorRendererReady,
  CHANNELS.windowCursorSettingsGet,
]);

/** The passive cursor surface gets only its paint acknowledgement and one preference. */
export function isCursorIpcChannelAllowed(channel: string): boolean {
  return CURSOR_IPC_ALLOWLIST.has(channel);
}

/**
 * Validates an external URL before passing it to `shell.openExternal`.
 * Allows only `https:` and `http:` URLs with no embedded credentials or
 * control characters. Rejects `javascript:`, `data:`, `file:`, `blob:`,
 * `vbscript:`, `ms-msdt:`, and malformed strings.
 */
export function validateExternalUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 4_096 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates that a dev server URL is strictly loopback (`127.0.0.1` or `localhost`)
 * over `http:`. Prevents arbitrary remote origins from being treated as trusted dev URLs.
 */
export function isSafeDevServerUrl(devServerUrl: string | null): boolean {
  if (!devServerUrl) return false;
  try {
    const parsed = new URL(devServerUrl);
    if (parsed.protocol !== 'http:') return false;
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  } catch {
    return false;
  }
}

/** Accept only the configured renderer document in its top-level frame. */
export function isTrustedRendererUrl(urlValue: string, rendererIndexPath: string, devServerUrl: string | null): boolean {
  try {
    const url = new URL(urlValue);
    if (devServerUrl) {
      if (!isSafeDevServerUrl(devServerUrl)) return false;
      const expected = new URL(devServerUrl);
      return url.origin === expected.origin && (url.pathname === '/' || url.pathname === '/index.html');
    }
    if (url.protocol !== 'file:') return false;
    const actual = resolve(fileURLToPath(url));
    const expected = resolve(rendererIndexPath);
    return process.platform === 'win32'
      ? actual.toLocaleLowerCase() === expected.toLocaleLowerCase()
      : actual === expected;
  } catch {
    return false;
  }
}

export interface HardenableWebContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: 'will-redirect', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: 'will-attach-webview', listener: (event: { preventDefault(): void }) => void): unknown;
  session?: {
    setPermissionRequestHandler?: (
      handler: (
        webContents: unknown,
        permission: string,
        callback: (granted: boolean) => void,
        details?: { requestingUrl?: string },
      ) => void,
    ) => void;
  };
}

export interface WindowSecurityPolicyOptions {
  windowRole: 'main' | 'workspace' | 'settings' | 'cursor' | 'guidance' | 'diagnostic';
  rendererIndexPath: string;
  devServerUrl: string | null;
  allowExternalLinks: boolean;
  openExternal?: (safeUrl: string) => void;
  onBlocked?: (event: { role: string; kind: 'window-open' | 'navigate' | 'redirect' | 'webview' | 'permission'; target: string }) => void;
}

const ALLOWED_RENDERER_PERMISSIONS = new Set<string>(['media', 'clipboard-sanitized-write']);

/**
 * Installs consistent navigation, redirect, popup, webview, and permission
 * guards on any Electron `WebContents`.
 *
 * - Blocks all child `BrowserWindow` creation (`action: 'deny'`).
 * - Optionally forwards validated `https:`/`http:` links to `openExternal`.
 * - Prevents untrusted top-level navigation and redirects.
 * - Blocks `<webview>` attachment unconditionally.
 * - Restricts browser permission requests to microphone (`media`) and sanitized clipboard write on trusted origins.
 */
export function attachWindowSecurityPolicy(
  contents: HardenableWebContents,
  options: WindowSecurityPolicyOptions,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (options.allowExternalLinks && options.openExternal) {
      const safe = validateExternalUrl(url);
      if (safe) {
        options.openExternal(safe);
        return { action: 'deny' };
      }
    }
    options.onBlocked?.({ role: options.windowRole, kind: 'window-open', target: url });
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, options.rendererIndexPath, options.devServerUrl)) {
      event.preventDefault();
      options.onBlocked?.({ role: options.windowRole, kind: 'navigate', target: url });
    }
  });

  contents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, options.rendererIndexPath, options.devServerUrl)) {
      event.preventDefault();
      options.onBlocked?.({ role: options.windowRole, kind: 'redirect', target: url });
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    options.onBlocked?.({ role: options.windowRole, kind: 'webview', target: 'webview' });
  });

  if (typeof contents.session?.setPermissionRequestHandler === 'function') {
    contents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
      const requestingUrl = details?.requestingUrl ?? '';
      const trustedOrigin = requestingUrl === ''
        || isTrustedRendererUrl(requestingUrl, options.rendererIndexPath, options.devServerUrl);
      const allow = trustedOrigin
        && options.allowExternalLinks
        && ALLOWED_RENDERER_PERMISSIONS.has(permission);
      if (!allow) {
        options.onBlocked?.({ role: options.windowRole, kind: 'permission', target: permission });
      }
      callback(allow);
    });
  }
}
