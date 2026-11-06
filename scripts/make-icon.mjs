/**
 * Generate the application icon used by electron-builder.
 *
 * The icon is drawn from the same geometry as the tray mark so the app and its
 * notification-area presence look like one product. Written at 256x256, which
 * is the minimum electron-builder accepts when converting to .ico.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'build');

function render(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const outer = size * 0.46;
  const ringInner = size * 0.30;
  const dot = size * 0.16;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      const distance = Math.hypot(dx, dy);
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
const png = encodePng(SIZE, SIZE, render(SIZE));
writeFileSync(join(outDir, 'icon.png'), png);
console.log(`Wrote build/icon.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
