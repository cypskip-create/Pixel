import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { UUID } from 'builder-util-runtime';
import {
  APP_NAME,
  LEGACY_APP_NAMES,
  MIGRATED_ENTRIES,
  describeMigration,
  hasExistingState,
  migrateLegacyData,
} from '../src/main/startup/user-data';
import type { MigrationFileSystem } from '../src/main/startup/user-data';
import { StartupLog, describeError } from '../src/main/startup/log';

const root = process.cwd();

/* ------------------------------------------------------------------ *
 * Packaging configuration
 * ------------------------------------------------------------------ */

interface BuilderConfig {
  appId: string;
  productName: string;
  win: {
    executableName?: string;
    artifactName?: string;
    target: Array<{ target: string; arch: string[] } | string>;
  };
  nsis: {
    guid?: string;
    include?: string;
    artifactName?: string;
    deleteAppDataOnUninstall?: boolean;
    perMachine?: boolean;
    oneClick?: boolean;
    shortcutName?: string;
    uninstallDisplayName?: string;
  };
  portable: { artifactName?: string };
  files: string[];
}

function loadConfig(): BuilderConfig {
  return yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as BuilderConfig;
}

/** electron-builder derives the uninstall GUID like this (NsisTarget.js:261). */
const ELECTRON_BUILDER_NS_UUID = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');

describe('packaging identity', () => {
  const config = loadConfig();

  it('keeps the Cyps appId so Pixel upgrades in place instead of installing beside it', () => {
    expect(config.appId).toBe('com.cyps.companion');
  });

  it('pins the uninstall GUID to the value Cyps 0.1.0 registered', () => {
    const derived = UUID.v5(config.appId, ELECTRON_BUILDER_NS_UUID);
    expect(derived).toBe('a5745318-c98a-51f9-87f5-f1c32713b276');
    // Pinned explicitly so a future appId edit cannot silently orphan the old
    // uninstall entry.
    expect(config.nsis.guid).toBe(derived);
  });

  it('presents the Pixel product name while the identity stays stable', () => {
    expect(config.productName).toBe('Pixel');
    expect(config.win.executableName).toBe('Pixel');
    expect(config.nsis.shortcutName).toBe('Pixel');
    expect(config.nsis.uninstallDisplayName).toBe('Pixel');
  });

  it('installs per-user and never destroys application data', () => {
    expect(config.nsis.perMachine).toBe(false);
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
  });

  it('ships all three distribution formats', () => {
    const targets = config.win.target.map((entry) =>
      typeof entry === 'string' ? entry : entry.target,
    );
    expect(targets).toContain('nsis');
    expect(targets).toContain('portable');
    expect(targets).toContain('zip');
  });

  it('names the artifacts after the product', () => {
    expect(config.nsis.artifactName).toBe('Pixel-Setup-${version}.${ext}');
    expect(config.portable.artifactName).toBe('Pixel-Portable-${version}.${ext}');
    expect(config.win.artifactName).toBe('Pixel-Windows-Unpacked-${version}.${ext}');
  });

  it('references an installer customisation script that exists', () => {
    expect(config.nsis.include).toBe('build/installer.nsh');
    expect(existsSync(join(root, 'build', 'installer.nsh'))).toBe(true);
  });

  it('still ships only compiled output', () => {
    expect(config.files).toContain('dist/**/*');
    expect(config.files).toContain('package.json');
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    productName: string;
    version: string;
    main: string;
  };

  it('is renamed to Pixel', () => {
    expect(pkg.name).toBe('pixel');
    expect(pkg.productName).toBe('Pixel');
  });

  it('uses the next version after the Cyps build', () => {
    expect(pkg.version).toBe('0.2.0');
  });

  it('still points at the compiled main bundle', () => {
    expect(pkg.main).toBe('dist/main/main/main.js');
  });
});

/* ------------------------------------------------------------------ *
 * Installer script safety
 * ------------------------------------------------------------------ */

describe('installer.nsh', () => {
  const script = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8');

  it('overrides the process check instead of disabling it', () => {
    expect(script).toContain('!macro customCheckAppRunning');
    // electron-builder only honours the macro if it is strictly custom-prefixed.
    expect(script).not.toContain('disableAppRunningCheck');
  });

  it('matches process names exactly, so a similarly named app is not targeted', () => {
    expect(script).toContain('findstr.exe" /B /I');
  });

  it('only ever closes Pixel and the legacy Cyps executable', () => {
    const killLines = script
      .split('\n')
      .filter((line) => !line.trimStart().startsWith(';'))
      .filter((line) => line.includes('taskkill'));
    expect(killLines.length).toBeGreaterThan(0);
    for (const line of killLines) {
      expect(line).toMatch(/APP_EXECUTABLE_FILENAME|"Cyps\.exe"/);
    }
  });

  it('scopes termination to the current user', () => {
    expect(script).toContain('/FI "USERNAME eq %USERNAME%"');
  });

  it('never deletes user data or application data directories', () => {
    expect(script).not.toMatch(/RMDir\s+\/r/i);
    expect(script).not.toContain('$APPDATA');
    expect(script).not.toContain('deleteAppData');
  });

  it('validates the chosen directory before extracting', () => {
    expect(script).toContain('Function .onVerifyInstDir');
    expect(script).toContain('FileOpen $0 "$INSTDIR\\.pixel-write-test" w');
    expect(script).toContain('Abort');
  });

  it('only removes legacy shortcuts and the legacy executable on upgrade', () => {
    expect(script).toContain('Delete "$DESKTOP\\Cyps.lnk"');
    expect(script).toContain('Delete "$INSTDIR\\Cyps.exe"');
    const deletes = script
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('Delete '));
    expect(deletes.length).toBeGreaterThan(0);
    for (const directive of deletes) {
      // Upgrades may remove the old Cyps shortcut/executable, plus the temporary
      // writability probe. Nothing else may be deleted.
      expect(directive).toMatch(/Cyps\.lnk|Cyps\.exe|pixel-write-test/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * User-data migration
 * ------------------------------------------------------------------ */

/** In-memory filesystem so migration policy can be tested without a profile. */
class MemoryFs implements MigrationFileSystem {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  /** Windows path.join uses backslashes; normalise keys so comparisons hold. */
  private static normalise(path: string): string {
    return path.split(String.fromCharCode(92)).join('/');
  }

  exists(path: string): boolean {
    const key = MemoryFs.normalise(path);
    if (this.files.has(key) || this.dirs.has(key)) return true;
    const prefix = key + '/';
    return [...this.files.keys()].some((file) => file.startsWith(prefix));
  }

  isDirectory(path: string): boolean {
    const key = MemoryFs.normalise(path);
    if (this.dirs.has(key)) return true;
    const prefix = key + '/';
    return [...this.files.keys()].some((file) => file.startsWith(prefix));
  }

  readdir(path: string): string[] {
    const prefix = MemoryFs.normalise(path) + '/';
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.length === 0) continue;
      names.add(rest.split('/')[0]);
    }
    return [...names];
  }

  mkdir(path: string): void {
    this.dirs.add(MemoryFs.normalise(path));
  }

  copy(from: string, to: string): void {
    const value = this.files.get(MemoryFs.normalise(from));
    if (value === undefined) throw new Error('ENOENT: ' + from);
    this.files.set(MemoryFs.normalise(to), value);
  }
}

const TARGET = 'C:/Users/me/AppData/Roaming/Pixel';
const LEGACY_LOWER = 'C:/Users/me/AppData/Roaming/cyps';
const LEGACY_UPPER = 'C:/Users/me/AppData/Roaming/Cyps';

describe('user-data migration', () => {
  it('uses Pixel as the product name and knows the legacy folder names', () => {
    expect(APP_NAME).toBe('Pixel');
    expect([...LEGACY_APP_NAMES]).toEqual(['cyps', 'Cyps']);
  });

  it('reports a fresh install when no legacy data exists', () => {
    const fs = new MemoryFs();
    const result = migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });
    expect(result.migrated).toBe(false);
    expect(describeMigration(result)).toMatch(/no legacy/i);
  });

  it('copies settings, credentials, history and executions from the Cyps folder', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    fs.files.set(`${LEGACY_LOWER}/settings.json`, '{"theme":"dark"}');
    fs.files.set(`${LEGACY_LOWER}/credentials/deepseek.key`, 'encrypted-blob');
    fs.files.set(`${LEGACY_LOWER}/history/history.index.json`, '["a"]');
    fs.files.set(`${LEGACY_LOWER}/executions/runs.json`, '[]');

    const result = migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });

    expect(result.migrated).toBe(true);
    expect(result.source).toBe(LEGACY_LOWER);
    expect(result.filesCopied).toBe(4);
    expect(fs.files.get(`${TARGET}/settings.json`)).toBe('{"theme":"dark"}');
    expect(fs.files.get(`${TARGET}/credentials/deepseek.key`)).toBe('encrypted-blob');
    expect(fs.files.get(`${TARGET}/history/history.index.json`)).toBe('["a"]');
    expect(fs.files.get(`${TARGET}/executions/runs.json`)).toBe('[]');
  });

  it('leaves the legacy folder untouched so it remains a backup', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    fs.files.set(`${LEGACY_LOWER}/settings.json`, '{"a":1}');

    migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });

    expect(fs.files.get(`${LEGACY_LOWER}/settings.json`)).toBe('{"a":1}');
    expect(fs.dirs.has(LEGACY_LOWER)).toBe(true);
  });

  it('never overwrites existing Pixel data', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    fs.files.set(`${LEGACY_LOWER}/settings.json`, '{"legacy":true}');
    fs.dirs.add(TARGET);
    fs.files.set(`${TARGET}/settings.json`, '{"pixel":true}');

    const result = migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });

    expect(result.migrated).toBe(false);
    expect(fs.files.get(`${TARGET}/settings.json`)).toBe('{"pixel":true}');
  });

  it('handles the capitalised legacy folder defensively', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_UPPER);
    fs.files.set(`${LEGACY_UPPER}/settings.json`, '{"upper":true}');

    const result = migrateLegacyData({
      targetDir: TARGET,
      legacyDirs: [LEGACY_LOWER, LEGACY_UPPER],
      fs,
    });

    expect(result.source).toBe(LEGACY_UPPER);
    expect(fs.files.get(`${TARGET}/settings.json`)).toBe('{"upper":true}');
  });

  it('prefers the lower-case folder, which is what the shipped build used', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    fs.dirs.add(LEGACY_UPPER);
    fs.files.set(`${LEGACY_LOWER}/settings.json`, '{"lower":true}');
    fs.files.set(`${LEGACY_UPPER}/settings.json`, '{"upper":true}');

    const result = migrateLegacyData({
      targetDir: TARGET,
      legacyDirs: [LEGACY_LOWER, LEGACY_UPPER],
      fs,
    });

    expect(result.source).toBe(LEGACY_LOWER);
  });

  it('skips a partial legacy install without failing startup', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    // A folder exists but there is no settings.json to migrate.
    const result = migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });
    expect(result.migrated).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('reports a copy error as a warning rather than throwing', () => {
    const fs = new MemoryFs();
    fs.dirs.add(LEGACY_LOWER);
    fs.files.set(`${LEGACY_LOWER}/settings.json`, '{}');
    const originalCopy = fs.copy.bind(fs);
    fs.copy = () => {
      throw new Error('EPERM');
    };

    const result = migrateLegacyData({ targetDir: TARGET, legacyDirs: [LEGACY_LOWER], fs });
    expect(result.migrated).toBe(false);
    expect(result.warnings.join(' ')).toContain('EPERM');
    fs.copy = originalCopy;
  });

  it('only migrates known state entries', () => {
    expect([...MIGRATED_ENTRIES]).toEqual([
      'settings.json',
      'credentials',
      'history',
      'executions',
    ]);
    expect(MIGRATED_ENTRIES).not.toContain('logs');
  });

  it('detects existing state via settings.json', () => {
    const fs = new MemoryFs();
    expect(hasExistingState(TARGET, fs)).toBe(false);
    fs.dirs.add(TARGET);
    fs.files.set(`${TARGET}/settings.json`, '{}');
    expect(hasExistingState(TARGET, fs)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Startup logging
 * ------------------------------------------------------------------ */

describe('StartupLog', () => {
  it('writes readable lines and can tail them', () => {
    const dir = join(
      root,
      'node_modules',
      '.cache',
      `pixel-log-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const log = new StartupLog(dir);
    log.info('first');
    log.warn('second');
    log.error('third');

    const tail = log.tail(10);
    expect(tail).toHaveLength(3);
    expect(tail[0]).toContain('[info] first');
    expect(tail[1]).toContain('[warn] second');
    expect(tail[2]).toContain('[error] third');
  });

  it('returns an empty list before anything is written', () => {
    const log = new StartupLog(join(root, 'node_modules', '.cache', 'pixel-log-none'));
    expect(log.tail(5)).toEqual([]);
  });

  it('describes errors with their stack', () => {
    const described = describeError(new Error('boom'));
    expect(described).toContain('Error: boom');
    expect(describeError('plain')).toBe('plain');
  });
});
