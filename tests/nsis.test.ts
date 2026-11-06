import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Executable regression tests for the installer's directory preflight.
 *
 * The preflight is NSIS code, so the only honest test is to compile it with the
 * same makensis electron-builder uses and run it. Each case compiles
 * tests/nsis/dir-check.nsi with the directory baked in via /D, runs the resulting
 * executable silently, and reads the verdict file it writes.
 *
 * When makensis cannot be found the suite is skipped with an explicit message -
 * a skipped run must never look like a passing run.
 */

const root = process.cwd();

function findMakensis(): string | null {
  const candidates = [
    join(
      process.env.LOCALAPPDATA ?? '',
      'electron-builder',
      'Cache',
      'nsis-3.0.4.1',
      'nsis-3.0.4.1-1mx3n',
      'makensis.exe',
    ),
    join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'nsis-3.0.4.1', 'nsis-3.0.4.1-1mx3n', 'Bin', 'makensis.exe'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const makensis = findMakensis();

if (!makensis) {
  console.warn(
    '[nsis tests skipped] makensis not found. Build the installer once (npm run dist) so electron-builder downloads NSIS.',
  );
}

const nsis = makensis ? describe : describe.skip;

interface Verdict {
  old: string;
  new: string;
  dir: string;
}

function runCase(directory: string): Verdict {
  if (!makensis) throw new Error('makensis is unavailable');

  const work = mkdtempSync(join(tmpdir(), 'pixel-dircheck-'));
  const exe = join(work, 'dircheck.exe');
  const result = join(work, 'result.txt');

  try {
    execFileSync(
      makensis,
      [
        '/V1',
        `/DPIXEL_BUILD_DIR=${join(root, 'build')}`,
        `/DTEST_DIR=${directory}`,
        `/DRESULT_FILE=${result}`,
        `/DOUTFILE=${exe}`,
        join(root, 'tests', 'nsis', 'dir-check.nsi'),
      ],
      { stdio: 'pipe', timeout: 120_000 },
    );

    execFileSync(exe, [], { stdio: 'pipe', timeout: 60_000 });

    const text = readFileSync(result, 'utf8');
    const pick = (key: string): string => {
      const match = new RegExp(`^${key}=(\\d)$`, 'm').exec(text);
      return match?.[1] ?? 'missing';
    };
    return { old: pick('OLD'), new: pick('NEW'), dir: directory };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

nsis('installer directory preflight', () => {
  it('accepts an existing, writable directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-writable-'));
    try {
      const verdict = runCase(dir);
      expect(verdict.new).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a directory that does not exist yet but can be created', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pixel-parent-'));
    const dir = join(parent, 'Brand', 'New', 'Pixel');
    try {
      const verdict = runCase(dir);
      expect(verdict.new).toBe('1');
      // The check is allowed to create it.
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('accepts a path with a trailing separator, as Browse produces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-slash-'));
    try {
      const verdict = runCase(`${dir}\\`);
      expect(verdict.new).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a path on a drive that does not exist', () => {
    // The check must still have teeth: a write that genuinely cannot happen is
    // reported as not writable.
    const verdict = runCase('Z:\\pixel-preflight-does-not-exist');
    expect(verdict.new).toBe('0');
  });

  it('does not leave the probe file behind in a writable directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pixel-probe-'));
    try {
      runCase(dir);
      expect(existsSync(join(dir, '.pixel-write-test'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the two implementations agree on a genuinely unusable path', () => {
    const verdict = runCase('Z:\\pixel-preflight-does-not-exist');
    expect(verdict.old).toBe('0');
    expect(verdict.new).toBe('0');
  });

  it('both implementations accept a plain writable directory', () => {
    // Documents that the shared macro was never the source of the false
    // rejection reported on hardware; the removed .onVerifyInstDir callback was.
    const dir = mkdtempSync(join(tmpdir(), 'pixel-both-'));
    try {
      const verdict = runCase(dir);
      expect(verdict.old).toBe('1');
      expect(verdict.new).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('installer script shape', () => {
  const script = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8');

  it('no longer validates in .onVerifyInstDir', () => {
    // This callback fired while the path was being typed and rejected writable
    // directories on real hardware. Its history is documented in a comment, so
    // assert on the definition rather than on any mention of the name.
    expect(script).not.toContain('Function .onVerifyInstDir');
  });

  it('validates once, in customInit', () => {
    expect(script).toContain('!macro customInit');
    expect(script).toContain('PIXEL_CHECK_DIR_WRITABLE');
  });

  it('preserves registers the installer relies on', () => {
    // The old callback clobbered $0 inside MUI's own page code.
    expect(script).toContain('Push $0');
    expect(script).toContain('Pop $0');
  });

  it('only inserts the check macro once, avoiding duplicate NSIS labels', () => {
    const insertions = script.split('!insertmacro PIXEL_CHECK_DIR_WRITABLE').length - 1;
    expect(insertions).toBe(1);
  });
});
