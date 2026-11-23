/**
 * Settings and secure credential storage.
 *
 * Two guarantees this module exists to uphold:
 *
 *  1. The DeepSeek API key is never written in plaintext. It goes through
 *     Electron's `safeStorage`, which is DPAPI on Windows. If the OS reports
 *     that encryption is unavailable, we refuse to store the key rather than
 *     silently falling back to plaintext.
 *  2. The key is never returned to the renderer, never logged, and never
 *     included in an error message.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { AppSettings, DeepSeekSettingsPatch } from '../shared/types';
import { mergeSettings } from '../shared/types';

interface KeyFile {
  /** Base64 of the DPAPI-encrypted buffer. */
  encrypted: string;
}

export class SettingsStore {
  private readonly settingsPath: string;
  private readonly keyPath: string;
  private readonly githubKeyPath: string;
  private cache: AppSettings | null = null;
  /** Decrypted key, held in memory only for the lifetime of the process. */
  private apiKeyCache: string | null = null;
  private apiKeyLoaded = false;
  private githubTokenCache: string | null = null;
  private githubTokenLoaded = false;

  constructor(userDataDir: string) {
    this.settingsPath = join(userDataDir, 'settings.json');
    this.keyPath = join(userDataDir, 'credentials', 'deepseek.key');
    this.githubKeyPath = join(userDataDir, 'credentials', 'github.key');
  }

  /* ----------------------------- settings ----------------------------- */

  get(): AppSettings {
    if (this.cache) return this.cache;
    try {
      if (existsSync(this.settingsPath)) {
        const raw = readFileSync(this.settingsPath, 'utf8');
        this.cache = mergeSettings(JSON.parse(raw));
      } else {
        this.cache = mergeSettings(undefined);
      }
    } catch {
      // A corrupt settings file must not brick the app: fall back to defaults
      // and let the next save overwrite the bad file.
      this.cache = mergeSettings(undefined);
    }
    return this.cache;
  }

  /** Shallow-merge a patch and persist. Returns the new full settings. */
  set(patch: DeepSeekSettingsPatch): AppSettings {
    const current = this.get();
    const merged = mergeSettings({ ...current, ...deepen(current, patch) });
    this.cache = merged;
    this.persist(merged);
    return merged;
  }

  private persist(settings: AppSettings): void {
    writeFileAtomic(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  /* ------------------------------ secrets ----------------------------- */

  /** True when the OS can encrypt for this user profile. */
  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Encrypt and persist the API key.
   * Returns an error message instead of throwing so the UI can show it.
   */
  setApiKey(key: string): { ok: boolean; error?: string } {
    const trimmed = key.trim();
    if (!trimmed) return { ok: false, error: 'The API key is empty.' };
    if (!this.isEncryptionAvailable()) {
      return {
        ok: false,
        error:
          'Windows credential encryption is unavailable on this account, so Pixel will not store the key. It would have to be saved unencrypted.',
      };
    }

    try {
      const encrypted = safeStorage.encryptString(trimmed);
      mkdirSync(dirname(this.keyPath), { recursive: true });
      const payload: KeyFile = { encrypted: encrypted.toString('base64') };
      writeFileSync(this.keyPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      this.apiKeyCache = trimmed;
      this.apiKeyLoaded = true;
      return { ok: true };
    } catch {
      // Deliberately does not include the key or the underlying error text,
      // which could contain fragments of the secret.
      return { ok: false, error: 'Pixel could not save the API key securely.' };
    }
  }

  /** Decrypted key, or null. Cached in memory after the first read. */
  getApiKey(): string | null {
    if (this.apiKeyLoaded) return this.apiKeyCache;
    this.apiKeyLoaded = true;
    this.apiKeyCache = null;

    if (!existsSync(this.keyPath)) return null;
    if (!this.isEncryptionAvailable()) return null;

    try {
      const raw = readFileSync(this.keyPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isKeyFile(parsed)) return null;
      this.apiKeyCache = safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64'));
      return this.apiKeyCache;
    } catch {
      return null;
    }
  }

  hasApiKey(): boolean {
    return this.getApiKey() !== null;
  }

  /** Remove the stored key from disk and memory. */
  clearApiKey(): void {
    try {
      if (existsSync(this.keyPath)) rmSync(this.keyPath, { force: true });
    } catch {
      // Report failure so the renderer cannot claim removal while the
      // encrypted credential remains on disk and reappears after restart.
      throw new Error('Pixel could not remove the saved API key.');
    }
    this.apiKeyCache = null;
    this.apiKeyLoaded = true;
  }

  /** Encrypt and persist an optional GitHub Personal Access Token via DPAPI. */
  setGitHubToken(token: string): { ok: boolean; error?: string } {
    const trimmed = token.trim();
    if (!trimmed) return { ok: false, error: 'The GitHub token is empty.' };
    if (trimmed.length > 512) return { ok: false, error: 'The GitHub token is unexpectedly long.' };
    if (!this.isEncryptionAvailable()) {
      return {
        ok: false,
        error: 'Windows credential encryption is unavailable on this account, so Pixel will not store the GitHub token.',
      };
    }
    try {
      const encrypted = safeStorage.encryptString(trimmed);
      mkdirSync(dirname(this.githubKeyPath), { recursive: true });
      const payload: KeyFile = { encrypted: encrypted.toString('base64') };
      writeFileSync(this.githubKeyPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
      this.githubTokenCache = trimmed;
      this.githubTokenLoaded = true;
      return { ok: true };
    } catch {
      return { ok: false, error: 'Pixel could not save the GitHub token securely.' };
    }
  }

  /** Decrypted GitHub token, or null. Held in memory only in the main process. */
  getGitHubToken(): string | null {
    if (this.githubTokenLoaded) return this.githubTokenCache;
    this.githubTokenLoaded = true;
    this.githubTokenCache = null;

    if (!existsSync(this.githubKeyPath)) return null;
    if (!this.isEncryptionAvailable()) return null;

    try {
      const raw = readFileSync(this.githubKeyPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isKeyFile(parsed)) return null;
      this.githubTokenCache = safeStorage.decryptString(Buffer.from(parsed.encrypted, 'base64'));
      return this.githubTokenCache;
    } catch {
      return null;
    }
  }

  hasGitHubToken(): boolean {
    return this.getGitHubToken() !== null;
  }

  /** Remove the locally stored encrypted GitHub token (does not revoke the token on github.com). */
  clearGitHubToken(): void {
    try {
      if (existsSync(this.githubKeyPath)) rmSync(this.githubKeyPath, { force: true });
    } catch {
      throw new Error('Pixel could not remove the saved GitHub token.');
    }
    this.githubTokenCache = null;
    this.githubTokenLoaded = true;
  }
}

function isKeyFile(value: unknown): value is KeyFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { encrypted?: unknown }).encrypted === 'string'
  );
}

/**
 * Deep-merge the object-valued keys of a patch over the current settings, so
 * that `{ provider: { temperature: 0.2 } }` does not wipe the other provider
 * fields.
 */
function deepen(
  current: AppSettings,
  patch: DeepSeekSettingsPatch,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = (current as unknown as Record<string, unknown>)[key];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      out[key] = { ...existing, ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Write via a temp file then rename, so a crash cannot truncate settings. */
function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}
