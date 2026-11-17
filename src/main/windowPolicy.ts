import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CompanionGlassMode = 'acrylic' | 'fallback';

/** Windows 11 22H2+ supports the acrylic and Mica system backdrop materials. */
export function supportsWindowsBackdrop(systemVersion: string): boolean {
  const match = /^10\.0\.(\d+)/.exec(systemVersion);
  return match !== null && Number(match[1]) >= 22_621;
}

/**
 * Use the native Windows backdrop only on builds that support it. The fallback
 * stays readable on older Windows versions and other platforms. Setting
 * PIXEL_GLASS_MODE=fallback makes the two visual treatments easy to compare.
 */
export function resolveCompanionGlassMode(
  platform: NodeJS.Platform | string,
  systemVersion: string,
  requestedMode?: string,
): CompanionGlassMode {
  if (requestedMode?.trim().toLowerCase() === 'fallback') return 'fallback';
  return platform === 'win32' && supportsWindowsBackdrop(systemVersion) ? 'acrylic' : 'fallback';
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
