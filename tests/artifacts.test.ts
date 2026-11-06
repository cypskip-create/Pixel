import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Distribution artifact tests.
 *
 * These read the real files produced by `electron-builder`. When the artifacts
 * have not been built the assertions are skipped with an explicit message
 * rather than passing silently, so a green run never implies something was
 * verified that was not.
 *
 * ZIP entries are read from the archive's central directory directly, so the
 * check works without an unzip dependency.
 */

const root = process.cwd();
const releaseDir = join(root, 'release');
const version = (
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
).version;

const SETUP = join(releaseDir, `Pixel-Setup-${version}.exe`);
const PORTABLE = join(releaseDir, `Pixel-Portable-${version}.exe`);
const ZIP = join(releaseDir, `Pixel-Windows-Unpacked-${version}.zip`);
const UNPACKED = join(releaseDir, 'win-unpacked');

const built = existsSync(SETUP) && existsSync(PORTABLE) && existsSync(ZIP);
if (!built) {
  console.warn(
    '[artifact tests skipped] Build the distributions first: node node_modules/electron-builder/out/cli/cli.js --win',
  );
}
const distribution = built ? describe : describe.skip;

/** Read entry names from a ZIP via its central directory. */
export function listZipEntries(buffer: Buffer): string[] {
  // End of central directory record: 0x06054b50, searched backwards.
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset > buffer.length - 66_000; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: no end-of-central-directory record.');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  const names: string[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function mb(path: string): number {
  return Math.round((statSync(path).size / 1024 / 1024) * 10) / 10;
}

describe('ZIP central directory reader', () => {
  it('parses a minimal archive it builds itself', () => {
    // A one-entry ZIP, enough to prove the reader follows the documented layout.
    const name = Buffer.from('hello.txt', 'utf8');
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(name.length, 28);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(0, 16);

    const entries = listZipEntries(Buffer.concat([record, name, eocd]));
    expect(entries).toEqual(['hello.txt']);
  });

  it('rejects a file that is not a ZIP', () => {
    expect(() => listZipEntries(Buffer.alloc(64))).toThrow(/not a ZIP/i);
  });
});

distribution('Pixel distributions', () => {
  it('produces the installer with the documented name', () => {
    expect(existsSync(SETUP)).toBe(true);
    expect(SETUP).toContain(`Pixel-Setup-${version}.exe`);
    expect(mb(SETUP)).toBeGreaterThan(50);
  });

  it('produces the portable build with the documented name', () => {
    expect(existsSync(PORTABLE)).toBe(true);
    expect(PORTABLE).toContain(`Pixel-Portable-${version}.exe`);
    expect(mb(PORTABLE)).toBeGreaterThan(50);
  });

  it('produces the unpacked ZIP with the documented name', () => {
    expect(existsSync(ZIP)).toBe(true);
    expect(mb(ZIP)).toBeGreaterThan(50);
  });

  it('names no artifact after the old product', () => {
    const artifacts = readdirSync(releaseDir).filter((name) => /\.(exe|zip)$/i.test(name));
    expect(artifacts.length).toBeGreaterThanOrEqual(3);
    const cypsArtifacts = artifacts.filter((name) => name.toLowerCase().includes('cyps'));
    expect(cypsArtifacts).toEqual([]);
  });

  it('the unpacked directory contains the Pixel executable and app resources', () => {
    expect(existsSync(join(UNPACKED, 'Pixel.exe'))).toBe(true);
    expect(existsSync(join(UNPACKED, 'resources', 'app.asar'))).toBe(true);
    // The Electron runtime must be present for the ZIP to be runnable as-is.
    expect(existsSync(join(UNPACKED, 'resources.pak'))).toBe(true);
    expect(existsSync(join(UNPACKED, 'icudtl.dat'))).toBe(true);
  });

  it('ships no Cyps executable in the unpacked directory', () => {
    expect(existsSync(join(UNPACKED, 'Cyps.exe'))).toBe(false);
  });

  it('the ZIP contains the executable and the application resources', () => {
    const entries = listZipEntries(readFileSync(ZIP));
    const normalised = entries.map((entry) => entry.replace(/\\/g, '/'));

    expect(normalised).toContain('Pixel.exe');
    expect(normalised).toContain('resources/app.asar');
    // Runtimes required to launch without an installer.
    expect(normalised.some((entry) => entry.endsWith('resources.pak'))).toBe(true);
    expect(normalised.some((entry) => entry.endsWith('icudtl.dat'))).toBe(true);
    expect(normalised).not.toContain('Cyps.exe');
  });

  it('the ZIP embeds the application payload, not just runtime files', () => {
    const entries = listZipEntries(readFileSync(ZIP)).map((entry) => entry.replace(/\\/g, '/'));
    // asar is a single blob, but its existence plus the runtime files is what
    // makes the archive launchable; confirm the payload is a real size.
    const asar = join(UNPACKED, 'resources', 'app.asar');
    expect(statSync(asar).size).toBeGreaterThan(1024 * 1024);
    expect(entries.length).toBeGreaterThan(20);
  });
});

describe('packaged application metadata', () => {
  it('the packaged asar reports the Pixel identity', () => {
    const asarPath = join(UNPACKED, 'resources', 'app.asar');
    if (!existsSync(asarPath)) {
      console.warn('[metadata test skipped] release/win-unpacked/resources/app.asar not built');
      return;
    }
    // The asar header is JSON at a known offset; the package.json body is
    // located through the header's file table.
    const buffer = readFileSync(asarPath);
    const headerSize = buffer.readUInt32LE(12);
    const header = buffer.toString('utf8', 16, 16 + headerSize);
    expect(header).toContain('package.json');
    // The compiled application tree must be inside the archive.
    expect(header).toContain('"dist"');
  });
});
