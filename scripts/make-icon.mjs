/**
 * Generate the application icon used by electron-builder.
 *
 * The Windows app tile and tray mark share the supplied Pixel P geometry.
 * Written at 256x256, which electron-builder converts to the Windows .ico.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'build');
const mark = JSON.parse(readFileSync(join(here, '..', 'src', 'shared', 'pixelMark.json'), 'utf8'));

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function insideRoundRect(x, y, bounds) {
  if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) return false;
  const cx = Math.max(bounds.x + bounds.radius, Math.min(x, bounds.x + bounds.width - bounds.radius));
  const cy = Math.max(bounds.y + bounds.radius, Math.min(y, bounds.y + bounds.height - bounds.radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= bounds.radius ** 2;
}

function render(size, { appTile = false } = {}) {
  const buffer = Buffer.alloc(size * size * 4);
  const [viewX, viewY, viewWidth, viewHeight] = mark.viewBox;
  const palette = Object.fromEntries(Object.entries(mark.palette).map(([name, hex]) => {
    const color = Number.parseInt(hex.slice(1), 16);
    return [name, [(color >> 16) & 255, (color >> 8) & 255, color & 255]];
  }));
  const tile = { x: size * 0.045, y: size * 0.045, width: size * 0.91, height: size * 0.91, radius: size * 0.19 };
  const tileFill = [13, 17, 26];
  const tileEdge = [59, 69, 83];
  const markHeight = size * 0.69;
  const markScale = markHeight / viewHeight;
  const markWidth = viewWidth * markScale;
  const markLeft = (size - markWidth) / 2 - viewX * markScale;
  const markTop = (size - markHeight) / 2 - viewY * markScale;
  const sampleCount = 4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          const px = x + (sx + 0.5) / sampleCount;
          const py = y + (sy + 0.5) / sampleCount;
          let color = null;
          if (appTile && insideRoundRect(px, py, tile)) {
            const inner = { ...tile, x: tile.x + 2, y: tile.y + 2, width: tile.width - 4, height: tile.height - 4, radius: tile.radius - 2 };
            color = insideRoundRect(px, py, inner) ? tileFill : tileEdge;
          }

          const markX = (px - markLeft) / markScale;
          const markY = (py - markTop) / markScale;
          if (markX >= 0 && markX <= viewWidth && markY >= 0 && markY <= viewHeight &&
              !insidePolygon(markX, markY, mark.sparkle)) {
            for (const shape of mark.shapes) {
              const contains = shape.kind === 'rect'
                ? markX >= shape.x && markX < shape.x + shape.width && markY >= shape.y && markY < shape.y + shape.height
                : insidePolygon(markX, markY, shape.points);
              if (contains) color = palette[shape.color] ?? color;
            }
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
const png = encodePng(SIZE, SIZE, render(SIZE, { appTile: true }));
writeFileSync(join(outDir, 'icon.png'), png);
const shapes = mark.shapes.map((shape) => shape.kind === 'rect'
  ? `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${mark.palette[shape.color]}"/>`
  : `<polygon points="${shape.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${mark.palette[shape.color]}"/>`).join('');
const sparkle = mark.sparkle.map(([x, y]) => `${x},${y}`).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox.join(' ')}"><mask id="sparkle"><rect x="0" y="0" width="${mark.viewBox[2]}" height="${mark.viewBox[3]}" fill="white"/><polygon points="${sparkle}" fill="black"/></mask><g mask="url(#sparkle)">${shapes}</g></svg>\n`;
writeFileSync(join(outDir, 'pixel-mark.svg'), svg, 'utf8');
console.log(`Wrote build/icon.png (${SIZE}x${SIZE}, ${png.length} bytes) and build/pixel-mark.svg from src/shared/pixelMark.json`);
