/**
 * User-data location and legacy migration.
 *
 * The product was renamed from Cyps to Pixel. Electron derives its data
 * directory from the application name, so a rename would silently move every
 * setting, conversation, encrypted credential and task record to a fresh empty
 * folder. To a user that looks exactly like "the app forgot everything".
 *
 * This module pins the data directory deliberately and copies legacy data
 * across on first run:
 *
 *  - the new directory is %APPDATA%\Pixel;
 *  - legacy data is copied from %APPDATA%\cyps (the name the previous build
 *    shipped with) and, defensively, %APPDATA%\Cyps;
 *  - the legacy folder is NEVER deleted or modified, so it remains a backup the
 *    user can restore from by hand.
 *
 * Filesystem work is injected so the policy can be tested without touching the
 * real profile directory.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The name the 0.1.0 build shipped with, hence its data folder. */
export const LEGACY_APP_NAMES = ['cyps', 'Cyps'] as const;

/** Current application name, used for the data folder and window titles. */
export const APP_NAME = 'Pixel';

/** Relative paths inside the data directory that make up the user's state. */
export const MIGRATED_ENTRIES = [
  'settings.json',
  'credentials',
  'history',
  'executions',
] as const;

export interface MigrationFileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  readdir(path: string): string[];
  mkdir(path: string): void;
  copy(from: string, to: string): void;
}

export const realFileSystem: MigrationFileSystem = {
  exists: (path) => existsSync(path),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readdir: (path) => readdirSync(path),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  copy: (from, to) => copyFileSync(from, to),
};

export interface MigrationOptions {
  /** Directory the app should use now, e.g. %APPDATA%\Pixel. */
  targetDir: string;
  /** Candidate legacy directories, most likely first. */
  legacyDirs: string[];
  fs: MigrationFileSystem;
}

export interface MigrationResult {
  /** True when legacy data was copied into the target directory. */
  migrated: boolean;
  /** Legacy directory the data came from, when migrated. */
  source: string | null;
  filesCopied: number;
  /** Directories that were skipped because they did not exist. */
  legacyMissing: string[];
  /** Non-fatal problems; a failed copy must never stop the app starting. */
  warnings: string[];
}

/** True when the target already holds user state of its own. */
export function hasExistingState(targetDir: string, fs: MigrationFileSystem): boolean {
  return fs.exists(join(targetDir, 'settings.json'));
}

/**
 * Decide whether to migrate, and do it.
 *
 * Rules:
 *  - Never overwrite existing Pixel data: if the target already has settings,
 *    migration is skipped entirely.
 *  - Copy only known state entries, never arbitrary files.
 *  - Skip entries that already exist in the target (defensive against a partial
 *    earlier migration).
 *  - Leave the legacy directory untouched.
 */
export function migrateLegacyData(options: MigrationOptions): MigrationResult {
  const { targetDir, legacyDirs, fs } = options;
  const result: MigrationResult = {
    migrated: false,
    source: null,
    filesCopied: 0,
    legacyMissing: [],
    warnings: [],
  };

  if (hasExistingState(targetDir, fs)) return result;

  const source = legacyDirs.find((dir) => hasExistingState(dir, fs));
  if (!source) {
    // Distinguish "no legacy install" from "legacy install was incomplete".
    for (const dir of legacyDirs) {
      if (!fs.exists(dir)) result.legacyMissing.push(dir);
    }
    return result;
  }

  try {
    fs.mkdir(targetDir);
  } catch (error) {
    result.warnings.push(`Could not create ${targetDir}: ${describe(error)}`);
    return result;
  }

  for (const entry of MIGRATED_ENTRIES) {
    const from = join(source, entry);
    const to = join(targetDir, entry);
    if (!fs.exists(from)) continue;

    try {
      if (fs.isDirectory(from)) {
        result.filesCopied += copyDirectory(from, to, fs, result.warnings);
      } else if (!fs.exists(to)) {
        fs.copy(from, to);
        result.filesCopied += 1;
      }
    } catch (error) {
      result.warnings.push(`Could not copy ${entry}: ${describe(error)}`);
    }
  }

  result.migrated = result.filesCopied > 0;
  result.source = result.migrated ? source : null;
  return result;
}

function copyDirectory(
  from: string,
  to: string,
  fs: MigrationFileSystem,
  warnings: string[],
): number {
  let copied = 0;
  fs.mkdir(to);
  for (const entry of fs.readdir(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    try {
      if (fs.isDirectory(source)) {
        copied += copyDirectory(source, target, fs, warnings);
      } else {
        // Never clobber a file the new version already wrote.
        if (fs.exists(target)) continue;
        fs.copy(source, target);
        copied += 1;
      }
    } catch (error) {
      warnings.push(`Could not copy ${entry}: ${describe(error)}`);
    }
  }
  return copied;
}

/** Human-readable one-liner for the startup log. */
export function describeMigration(result: MigrationResult): string {
  if (result.migrated) {
    return `Migrated ${result.filesCopied} file(s) from ${result.source ?? 'legacy data'} (legacy copy kept as backup).`;
  }
  if (result.legacyMissing.length === LEGACY_APP_NAMES.length) {
    return 'No legacy Cyps data found; starting fresh.';
  }
  if (result.warnings.length > 0) {
    return `Legacy data found but not migrated: ${result.warnings.join('; ')}`;
  }
  return 'No legacy data needed migrating.';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
