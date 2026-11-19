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

/** Accept only the configured renderer document in its top-level frame. */
export function isTrustedRendererUrl(urlValue: string, rendererIndexPath: string, devServerUrl: string | null): boolean {
  try {
    const url = new URL(urlValue);
    if (devServerUrl) {
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
