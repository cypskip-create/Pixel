import { describe, expect, it } from 'vitest';
import { buildPng, crc32, encodePng, renderIconPixels } from '../src/main/icon/png';

/** Read a PNG chunk header at a byte offset. */
function readChunk(png: Buffer, offset: number): { type: string; length: number; crcOk: boolean } {
  const length = png.readUInt32BE(offset);
  const type = png.toString('ascii', offset + 4, offset + 8);
  const body = png.subarray(offset + 4, offset + 8 + length);
  const expected = png.readUInt32BE(offset + 8 + length);
  return { type, length, crcOk: crc32(body) === expected };
}

describe('renderIconPixels', () => {
  it('produces 4 bytes per pixel', () => {
    expect(renderIconPixels(16)).toHaveLength(16 * 16 * 4);
    expect(renderIconPixels(32)).toHaveLength(32 * 32 * 4);
  });

  it('draws an opaque core at the centre', () => {
    const size = 32;
    const pixels = renderIconPixels(size);
    const centre = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    expect(pixels[centre + 3]).toBe(255);
  });

  it('leaves the corners fully transparent', () => {
    const size = 32;
    const pixels = renderIconPixels(size);
    expect(pixels[3]).toBe(0); // top-left alpha
    expect(pixels[(size * size - 1) * 4 + 3]).toBe(0); // bottom-right alpha
  });

  it('is horizontally symmetric', () => {
    const size = 16;
    const pixels = renderIconPixels(size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const left = (y * size + x) * 4 + 3;
        const right = (y * size + (size - 1 - x)) * 4 + 3;
        expect(pixels[left]).toBe(pixels[right]);
      }
    }
  });

  it('rejects a size that cannot form a mark', () => {
    expect(() => renderIconPixels(4)).toThrow(/at least 8/i);
    expect(() => renderIconPixels(10.5)).toThrow();
  });
});

describe('encodePng', () => {
  const size = 16;
  const png = encodePng(size, size, renderIconPixels(size));

  it('starts with the PNG signature', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('writes IHDR with the right dimensions and RGBA colour type', () => {
    const ihdr = readChunk(png, 8);
    expect(ihdr.type).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
    expect(ihdr.crcOk).toBe(true);
  });

  it('ends with IEND', () => {
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');
  });

  it('computes a valid CRC for every chunk', () => {
    let offset = 8;
    const seen: string[] = [];
    while (offset < png.length) {
      const chunk = readChunk(png, offset);
      expect(chunk.crcOk, `CRC for ${chunk.type}`).toBe(true);
      seen.push(chunk.type);
      offset += 12 + chunk.length;
    }
    expect(seen).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('rejects a buffer that does not match the dimensions', () => {
    expect(() => encodePng(16, 16, Buffer.alloc(10))).toThrow(/bytes of RGBA/i);
  });
});

describe('crc32', () => {
  it('matches the known CRC of "IEND"', () => {
    // Well-known constant for the empty IEND chunk body including its type.
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xae426082);
  });

  it('is stable for identical input', () => {
    const a = Buffer.from('Pixel', 'utf8');
    expect(crc32(a)).toBe(crc32(Buffer.from('Pixel', 'utf8')));
  });
});

describe('buildPng', () => {
  it('produces a decodable 32x32 icon for the tray', () => {
    const png = buildPng(32);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.length).toBeGreaterThan(100);
  });

  it('is deterministic, so rebuilds do not churn the binary', () => {
    expect(buildPng(16).equals(buildPng(16))).toBe(true);
  });
});
