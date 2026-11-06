/**
 * Dependency-free PNG encoding for the Cyps mark.
 *
 * Kept free of Electron imports on purpose: the encoder is pure, so it can be
 * unit-tested, and the tray/window modules only convert the bytes into a
 * nativeImage. Building the icon at runtime means the repository carries no
 * opaque binary blobs and the icon cannot be missing from a package.
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard PNG CRC-32. */
export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * RGBA pixels for the Cyps mark: a bright core inside an anti-aliased ring.
 * The mark reads clearly at 16px in the notification area.
 */
export function renderIconPixels(size: number): Buffer {
  if (!Number.isInteger(size) || size < 8) {
    throw new Error(`Icon size must be an integer of at least 8, received ${String(size)}.`);
  }

  const buffer = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const outer = size * 0.46;
  const ringInner = size * 0.3;
  const dot = size * 0.16;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * size + x) * 4;

      let alpha = 0;
      let r = 255;
      let g = 255;
      let b = 255;

      if (distance <= dot) {
        alpha = 255;
      } else if (distance <= outer && distance >= ringInner) {
        const edgeOuter = Math.min(1, Math.max(0, (outer - distance) / 1.5));
        const edgeInner = Math.min(1, Math.max(0, (distance - ringInner) / 1.5));
        alpha = Math.round(235 * Math.min(edgeOuter, edgeInner));
        r = 200;
        g = 225;
        b = 255;
      }

      buffer[offset] = r;
      buffer[offset + 1] = g;
      buffer[offset + 2] = b;
      buffer[offset + 3] = alpha;
    }
  }

  return buffer;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode 8-bit RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const expected = stride * height;
  if (rgba.length !== expected) {
    throw new Error(`Expected ${expected} bytes of RGBA for ${width}x${height}, got ${rgba.length}.`);
  }

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Convenience: render and encode in one step. */
export function buildPng(size: number): Buffer {
  return encodePng(size, size, renderIconPixels(size));
}
