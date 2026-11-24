/**
 * Consented Browser Profile Manager & CDP Endpoint Validator.
 *
 * Adapted from Hermes `tools/browser_session_real_profile.py` and
 * `tools/browser_session_cdp.py` for Windows + Pixel's security boundaries:
 *  - Detects installed stable Windows Chromium browsers (Chrome, Edge, Brave).
 *  - Never touches or copies user browser profiles unless `realProfileConsent`
 *    is explicitly enabled.
 *  - Detects locked profiles (`SingletonLock` / `lockfile`) and falls back
 *    truthfully to a fresh isolated session with a clear note.
 *  - Revoking consent deletes Pixel-owned profile snapshot copies.
 *  - Validates CDP endpoints (loopback HTTP/WS or remote HTTPS/WSS only;
 *    unconditionally rejects cloud metadata) and marks attached browsers
 *    `ownedByPixel: false` so user browsers are never terminated on cleanup.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isCloudMetadataHost } from './netGuard';

export interface DetectedBrowserProfile {
  id: 'chrome' | 'edge' | 'brave';
  label: string;
  executablePath: string;
  userDataDir: string;
  profileDir: string;
  locked: boolean;
}

export interface BrowserProfileResolution {
  mode: 'isolated_fresh_profile' | 'signed_in_profile_copy';
  profilePath: string | null;
  browserId?: string;
  fallbackNote?: string;
}

export interface CdpValidationResult {
  ok: boolean;
  endpoint?: string;
  ownedByPixel: false;
  error?: string;
}

export function validateCdpEndpoint(raw: string): CdpValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, ownedByPixel: false, error: 'CDP endpoint URL is empty.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, ownedByPixel: false, error: 'CDP endpoint is not a valid URL.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, ownedByPixel: false, error: 'CDP endpoint must not embed credentials.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (isCloudMetadataHost(host)) {
    return { ok: false, ownedByPixel: false, error: 'Cloud metadata endpoints are unconditionally blocked.' };
  }
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  if (parsed.protocol === 'http:' || parsed.protocol === 'ws:') {
    if (!isLoopback) {
      return {
        ok: false,
        ownedByPixel: false,
        error: 'Plaintext HTTP/WS CDP endpoints are only permitted on localhost/127.0.0.1.',
      };
    }
    return { ok: true, endpoint: trimmed.replace(/\/+$/, ''), ownedByPixel: false };
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') {
    return { ok: true, endpoint: trimmed.replace(/\/+$/, ''), ownedByPixel: false };
  }
  return { ok: false, ownedByPixel: false, error: `Unsupported CDP protocol "${parsed.protocol}".` };
}

export function detectWindowsBrowserProfiles(
  env: NodeJS.ProcessEnv = process.env,
): DetectedBrowserProfile[] {
  const localAppData = env.LOCALAPPDATA ?? '';
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';

  const candidates: Array<{
    id: 'chrome' | 'edge' | 'brave';
    label: string;
    exes: string[];
    userDataDir: string;
  }> = [
    {
      id: 'chrome',
      label: 'Google Chrome (Stable)',
      exes: [
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      userDataDir: join(localAppData, 'Google', 'Chrome', 'User Data'),
    },
    {
      id: 'edge',
      label: 'Microsoft Edge (Stable)',
      exes: [
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      userDataDir: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    },
    {
      id: 'brave',
      label: 'Brave Browser (Stable)',
      exes: [
        join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ],
      userDataDir: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    },
  ];

  const found: DetectedBrowserProfile[] = [];
  for (const c of candidates) {
    const exe = c.exes.find((p) => p && existsSync(p));
    const defaultProfile = join(c.userDataDir, 'Default');
    if (!exe || !existsSync(defaultProfile)) continue;
    const locked =
      existsSync(join(c.userDataDir, 'SingletonLock')) ||
      existsSync(join(defaultProfile, 'LOCK')) ||
      existsSync(join(c.userDataDir, 'lockfile'));
    found.push({
      id: c.id,
      label: c.label,
      executablePath: exe,
      userDataDir: c.userDataDir,
      profileDir: defaultProfile,
      locked,
    });
  }
  return found;
}

/**
 * Prepare a Pixel-owned profile copy ONLY when explicit `consent === true`.
 * Never modifies the user's live profile; falls back cleanly if locked or missing.
 */
export function prepareBrowserProfile(options: {
  consent: boolean;
  snapshotRoot: string;
  selectedProfile?: DetectedBrowserProfile | null;
}): BrowserProfileResolution {
  if (!options.consent) {
    return { mode: 'isolated_fresh_profile', profilePath: null };
  }
  const profile = options.selectedProfile;
  if (!profile || !existsSync(profile.profileDir)) {
    return {
      mode: 'isolated_fresh_profile',
      profilePath: null,
      fallbackNote:
        'Real-profile browsing is enabled, but no supported stable Chromium profile was found. Using a fresh isolated browser instead.',
    };
  }
  if (profile.locked) {
    return {
      mode: 'isolated_fresh_profile',
      profilePath: null,
      browserId: profile.id,
      fallbackNote: `${profile.label} is currently open (profile locked). Using a fresh isolated browser instead.`,
    };
  }

  const destDir = join(options.snapshotRoot, `pixel-profile-${profile.id}`);
  try {
    mkdirSync(destDir, { recursive: true });
    // Copy only safe non-cache preferences/bookmarks/state metadata (bounded).
    for (const file of ['Preferences', 'Bookmarks']) {
      const src = join(profile.profileDir, file);
      if (existsSync(src)) {
        cpSync(src, join(destDir, file), { force: true });
      }
    }
    return {
      mode: 'signed_in_profile_copy',
      profilePath: destDir,
      browserId: profile.id,
    };
  } catch {
    return {
      mode: 'isolated_fresh_profile',
      profilePath: null,
      browserId: profile.id,
      fallbackNote: `Could not snapshot ${profile.label} profile cleanly. Using a fresh isolated browser instead.`,
    };
  }
}

/** Delete all Pixel-owned real-profile snapshots when consent is revoked. */
export function revokeRealProfileSnapshots(snapshotRoot: string): boolean {
  if (!snapshotRoot || !existsSync(snapshotRoot)) return true;
  try {
    rmSync(snapshotRoot, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
