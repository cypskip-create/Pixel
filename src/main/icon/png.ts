/**
 * Dependency-free PNG encoding for the Pixel mark.
 *
 * Kept free of Electron imports on purpose: the encoder is pure, so it can be
 * unit-tested, and the tray/window modules only convert the bytes into a
 * nativeImage. Building the icon at runtime means the repository carries no
 * opaque binary blobs and the icon cannot be missing from a package.
 */

import { deflateSync } from 'node:zlib';
import mark from '../../shared/pixelMark.json';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PixelShape =
  | { kind: 'rect'; color: string; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; color: string; points: number[][] };

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
 * RGBA pixels for the canonical Pixel P mark. Geometry and palette come from
 * src/shared/pixelMark.json, also used by the renderer and SVG master.
 */
export function renderIconPixels(size: number): Buffer {
  if (!Number.isInteger(size) || size < 8) {
    throw new Error(`Icon size must be an integer of at least 8, received ${String(size)}.`);
  }

  const buffer = Buffer.alloc(size * size * 4);
  const viewBox = mark.viewBox as number[];
  const shapes = mark.shapes as PixelShape[];
  const sparkle = mark.sparkle as number[][];
  const width = viewBox[2] ?? 0;
  const height = viewBox[3] ?? 0;
  const markScale = (size * 0.82) / Math.max(width, height);
  const markWidth = width * markScale;
  const markHeight = height * markScale;
  const markLeft = (size - markWidth) / 2;
  const markTop = (size - markHeight) / 2;
  const palette = Object.fromEntries(Object.entries(mark.palette).map(([key, value]) => [key, hexToRgb(value)])) as Record<string, [number, number, number]>;
  const inPolygon = (x: number, y: number, points: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i]!;
      const b = points[j]!;
      if (((a[1]! > y) !== (b[1]! > y)) && x < ((b[0]! - a[0]!) * (y - a[1]!) / (b[1]! - a[1]!)) + a[0]!) inside = !inside;
    }
    return inside;
  };
  const rgb = (color: string): [number, number, number] | null => palette[color] ?? null;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const px = viewBox[0]! + ((x + (sx + 0.5) / 4 - markLeft) / markScale);
          const py = viewBox[1]! + ((y + (sy + 0.5) / 4 - markTop) / markScale);
          if (px < viewBox[0]! || px > viewBox[0]! + width || py < viewBox[1]! || py > viewBox[1]! + height) continue;
          if (inPolygon(px, py, sparkle)) continue;
          let color: [number, number, number] | null = null;
          for (const shape of shapes) {
            const contains = shape.kind === 'rect'
              ? px >= shape.x && px < shape.x + shape.width && py >= shape.y && py < shape.y + shape.height
              : inPolygon(px, py, shape.points);
            if (contains) color = rgb(shape.color);
          }
          if (!color) continue;
          red += color[0]; green += color[1]; blue += color[2]; covered += 1;
        }
      }
      buffer[offset] = covered ? Math.round(red / covered) : 255;
      buffer[offset + 1] = covered ? Math.round(green / covered) : 255;
      buffer[offset + 2] = covered ? Math.round(blue / covered) : 255;
      buffer[offset + 3] = Math.round((covered / 16) * 255);
    }
  }

  return buffer;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
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
