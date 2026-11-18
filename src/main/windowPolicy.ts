import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
