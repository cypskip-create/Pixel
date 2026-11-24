import { useEffect, useRef } from 'react';

export interface DynamicIslandHorseCanvasProps {
  /** True when a background task or agent turn is actively running. */
  running: boolean;
  reducedMotion?: boolean;
  width?: number;
  height?: number;
}

/**
 * 4-frame articulated dot-matrix pixel horse sprite (14 cols x 9 rows).
 * Rendered in crisp integer pixel dots inside the matte black Dynamic Island.
 */
const HORSE_FRAMES: ReadonlyArray<readonly string[]> = [
  [
    '          ..  ',
    '         .###.',
    '   ..   .####.',
    '  .#########. ',
    ' .#########.  ',
    '  .##   .##   ',
    ' .#       .#  ',
    ' #         .# ',
    '              ',
  ],
  [
    '          ..  ',
    '         .###.',
    '  ..    .####.',
    ' .#########.  ',
    '  .########.  ',
    '   .##  .##   ',
    '   .#    .#   ',
    '  .#     #    ',
    '              ',
  ],
  [
    '          ..  ',
    '         .###.',
    '   ..   .####.',
    '  .#########. ',
    ' .#########.  ',
    '   .## .##    ',
    '    .# .#     ',
    '    .#  .#    ',
    '              ',
  ],
  [
    '          ..  ',
    '         .###.',
    ' ..     .####.',
    '.#########.   ',
    ' .#########.  ',
    '  .##    .##  ',
    ' .#       .#  ',
    '#          .# ',
    '              ',
  ],
];

const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [12, 8, 0.7], [38, 12, 0.5], [68, 6, 0.85], [96, 14, 0.45],
  [124, 9, 0.75], [148, 16, 0.5], [24, 22, 0.4], [84, 20, 0.6],
  [112, 7, 0.55], [52, 18, 0.35],
];

const MOON_PIXELS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [2, 0],
  [0, 1], [1, 1], [2, 1], [3, 1],
  [0, 2], [1, 2], [2, 2], [3, 2],
  [1, 3], [2, 3],
];

/**
 * Exact Inspora `dynamic-island-pixel-art-horse` 60 FPS pixel-art canvas:
 * crisp dot-matrix horse galloping across a starry night landscape with
 * parallax mountains, pixel moon, muted sage trees, and campfire dot.
 */
export function DynamicIslandHorseCanvas({
  running,
  reducedMotion = false,
  width = 320,
  height = 84,
}: DynamicIslandHorseCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const px = 2; // 2px dot-matrix cell
    const cols = Math.floor(width / px);
    const rows = Math.floor(height / px);
    const groundRow = rows - 4;

    let rafId = 0;
    let startMs = performance.now();

    const drawDot = (gx: number, gy: number, color: string) => {
      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
      ctx.fillStyle = color;
      ctx.fillRect(gx * px, gy * px, px - 0.3, px - 0.3);
    };

    const renderFrame = (nowMs: number) => {
      const elapsed = (nowMs - startMs) / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // 1. Twinkling stars
      for (let i = 0; i < STARS.length; i += 1) {
        const [sx, sy, baseAlpha] = STARS[i]!;
        const twinkle = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(elapsed * 2.2 + i * 1.7);
        drawDot(sx % cols, sy % Math.max(8, groundRow - 12), `rgba(255, 255, 255, ${(baseAlpha * twinkle).toFixed(2)})`);
      }

      // 2. Clustered dot-matrix moon in top-right
      const moonX = cols - 14;
      const moonY = 5;
      for (const [mx, my] of MOON_PIXELS) {
        drawDot(moonX + mx, moonY + my, 'hsla(220, 60%, 97%, 0.92)');
      }

      // 3. Parallax mountain ridge outlines
      const scrollFar = running && !reducedMotion ? elapsed * 9 : 0;
      for (let gx = 0; gx < cols; gx += 1) {
        const sample = (gx + scrollFar) * 0.085;
        const ridge = Math.round(
          groundRow - 4 - (Math.sin(sample) * 3.5 + Math.sin(sample * 2.3 + 1.1) * 2.2 + 4.5),
        );
        drawDot(gx, ridge, 'hsla(216, 15%, 56%, 0.42)');
        if (gx % 2 === 0 && ridge + 1 < groundRow) {
          drawDot(gx, ridge + 1, 'hsla(218, 12%, 40%, 0.22)');
        }
      }

      // 4. Ground dotted line
      for (let gx = 0; gx < cols; gx += 1) {
        drawDot(gx, groundRow, gx % 2 === 0 ? 'hsla(216, 18%, 70%, 0.48)' : 'hsla(216, 12%, 48%, 0.25)');
      }

      // 5. Sage-green pixel trees + tiny warm campfire ember scrolling past
      const scrollNear = running && !reducedMotion ? elapsed * 24 : 0;
      const treeSpacing = 34;
      for (let t = 0; t < 6; t += 1) {
        const tx = Math.floor(((t * treeSpacing - scrollNear) % (cols + 20) + (cols + 20)) % (cols + 20)) - 10;
        const treeH = t % 2 === 0 ? 5 : 4;
        for (let ty = 0; ty < treeH; ty += 1) {
          const half = Math.floor(ty / 2) + 1;
          for (let dx = -half; dx <= half; dx += 1) {
            drawDot(tx + dx, groundRow - treeH + ty, 'hsla(135, 18%, 56%, 0.72)');
          }
        }
        drawDot(tx, groundRow - 1, 'hsla(120, 5%, 45%, 0.55)');
        // Subtle campfire dot beside every third tree
        if (t === 2) {
          const flicker = reducedMotion ? 0.9 : 0.65 + 0.35 * Math.sin(elapsed * 9);
          drawDot(tx + 4, groundRow - 1, `hsla(36, 88%, 67%, ${flicker.toFixed(2)})`);
        }
      }

      // 6. Articulated galloping white dot-matrix horse
      const horseCycle = running && !reducedMotion ? (elapsed * 32) % (cols + 24) : Math.floor(cols * 0.42);
      const horseX = Math.floor(horseCycle) - 12;
      const frameIdx = running && !reducedMotion ? Math.floor(elapsed * 11) % HORSE_FRAMES.length : 0;
      const bob = running && !reducedMotion && (frameIdx === 1 || frameIdx === 3) ? -1 : 0;
      const sprite = HORSE_FRAMES[frameIdx] ?? HORSE_FRAMES[0]!;
      const horseTop = groundRow - sprite.length + 1 + bob;

      for (let r = 0; r < sprite.length; r += 1) {
        const rowStr = sprite[r] ?? '';
        for (let c = 0; c < rowStr.length; c += 1) {
          const ch = rowStr[c];
          if (ch === '#') {
            drawDot(horseX + c, horseTop + r, 'rgba(255, 255, 255, 0.96)');
          } else if (ch === '.') {
            drawDot(horseX + c, horseTop + r, 'hsla(216, 25%, 86%, 0.68)');
          }
        }
      }

      if (running && !reducedMotion) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    startMs = performance.now();
    renderFrame(startMs);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [running, reducedMotion, width, height]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="dynamic-island-horse-canvas"
      aria-hidden="true"
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
    />
  );
}
