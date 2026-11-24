import { useEffect, useRef } from 'react';

export interface DynamicIslandHorseCanvasProps {
  /** True when a background task or agent turn is actively running. */
  running: boolean;
  reducedMotion?: boolean;
  width?: number;
  height?: number;
  /** Compact mini mode for the 132x36 collapsed Dynamic Island pill. */
  compact?: boolean;
}

/**
 * 6-frame articulated dot-matrix pixel horse sprite (22 cols x 12 rows).
 * Rendered in crisp 3px pixel clusters inside the solid #000000 Dynamic Island,
 * matching Inspora `dynamic-island-pixel-art-horse` by Kris Puckett.
 */
const HORSE_FRAMES: ReadonlyArray<readonly string[]> = [
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    '   ...       .#####.. ',
    '  .####.....######.   ',
    ' .###############.    ',
    '  .#############.     ',
    '   .###.    .###.     ',
    '  .##.        .##.    ',
    ' .#.           .##.   ',
    '.#.              .#.  ',
    '                      ',
  ],
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    '    ...      .#####.. ',
    '   .###.....######.   ',
    '  .##############.    ',
    '   .############.     ',
    '    .###.   .###.     ',
    '    .##.     .##.     ',
    '   .##.       .#.     ',
    '   .#.        .#.     ',
    '                      ',
  ],
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    '   ...       .#####.. ',
    '  .####.....######.   ',
    '  .##############.    ',
    '   .############.     ',
    '    .###.  .###.      ',
    '     .##.  .##.       ',
    '     .##.   .##.      ',
    '      .#.    .#.      ',
    '                      ',
  ],
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    '  ...        .#####.. ',
    ' .####......######.   ',
    ' .###############.    ',
    '  .#############.     ',
    '   .###.    .###.     ',
    '  .##.       .##.     ',
    ' .##.         .##.    ',
    ' .#.           .#.    ',
    '                      ',
  ],
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    ' ...         .#####.. ',
    '.#####......######.   ',
    ' .###############.    ',
    '  .#############.     ',
    '  .###.      .###.    ',
    ' .##.          .##.   ',
    '.#.             .##.  ',
    '#                .#.  ',
    '                      ',
  ],
  [
    '                ...   ',
    '               .####. ',
    '              .######.',
    '   ...       .#####.. ',
    '  .####.....######.   ',
    '  .##############.    ',
    '   .############.     ',
    '   .###.    .###.     ',
    '   .##.      .##.     ',
    '  .##.       .##.     ',
    '  .#.         .#.     ',
    '                      ',
  ],
];

const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [9, 5, 0.9], [23, 9, 0.65], [41, 4, 0.95], [58, 11, 0.6],
  [76, 6, 0.85], [93, 12, 0.7], [15, 15, 0.55], [51, 14, 0.75],
  [84, 4, 0.8], [33, 12, 0.5], [108, 9, 0.75], [67, 8, 0.65],
];

const MOON_PIXELS: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [3, 0],
  [1, 1], [2, 1], [3, 1], [4, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2],
  [1, 3], [2, 3], [3, 3], [4, 3],
  [2, 4], [3, 4],
];

export function DynamicIslandHorseCanvas({
  running,
  reducedMotion = false,
  width = 348,
  height = 96,
  compact = false,
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

    const px = compact ? 2 : 3;
    const cols = Math.floor(width / px);
    const rows = Math.floor(height / px);
    const groundRow = rows - (compact ? 2 : 4);

    let rafId = 0;
    const startMs = performance.now();

    const drawDot = (gx: number, gy: number, color: string) => {
      if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
      ctx.fillStyle = color;
      ctx.fillRect(gx * px, gy * px, px - 0.35, px - 0.35);
    };

    const renderFrame = (nowMs: number) => {
      const elapsed = (nowMs - startMs) / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // 1. Crisp twinkling stars
      for (let i = 0; i < STARS.length; i += 1) {
        const [sx, sy, baseAlpha] = STARS[i]!;
        const twinkle = reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(elapsed * 2.5 + i * 1.7);
        drawDot(
          sx % cols,
          sy % Math.max(4, groundRow - (compact ? 4 : 10)),
          `rgba(255, 255, 255, ${(baseAlpha * twinkle).toFixed(2)})`,
        );
      }

      // 2. Clustered bright pixel moon in top-right
      if (!compact) {
        const moonX = cols - 14;
        const moonY = 3;
        for (const [mx, my] of MOON_PIXELS) {
          drawDot(moonX + mx, moonY + my, 'rgba(255, 255, 255, 0.96)');
        }
      }

      // 3. Parallax dot-matrix mountain ridge outlines
      if (!compact) {
        const scrollFar = running && !reducedMotion ? elapsed * 7 : 0;
        for (let gx = 0; gx < cols; gx += 1) {
          const sample = (gx + scrollFar) * 0.11;
          const ridge = Math.round(
            groundRow - 2 - (Math.sin(sample) * 3.2 + Math.sin(sample * 2.2 + 0.9) * 2.1 + 4.2),
          );
          drawDot(gx, ridge, 'hsla(215, 18%, 74%, 0.72)');
          if (gx % 2 === 0 && ridge + 1 < groundRow) {
            drawDot(gx, ridge + 1, 'hsla(215, 14%, 52%, 0.38)');
          }
        }
      }

      // 4. Dotted horizon ground line
      for (let gx = 0; gx < cols; gx += 1) {
        drawDot(gx, groundRow, gx % 2 === 0 ? 'hsla(215, 20%, 78%, 0.65)' : 'hsla(215, 14%, 52%, 0.35)');
      }

      // 5. Sage-green pixel trees + warm flickering campfire dot
      if (!compact) {
        const scrollNear = running && !reducedMotion ? elapsed * 18 : 0;
        const treeSpacing = 26;
        for (let t = 0; t < 6; t += 1) {
          const span = cols + 20;
          const tx = Math.floor((((t * treeSpacing - scrollNear) % span) + span) % span) - 10;
          const isRoundTree = t % 2 === 0;
          if (isRoundTree) {
            for (let dy = -4; dy <= -2; dy += 1) {
              const rad = dy === -3 ? 2 : 1;
              for (let dx = -rad; dx <= rad; dx += 1) {
                drawDot(tx + dx, groundRow + dy, 'hsla(132, 28%, 58%, 0.9)');
              }
            }
            drawDot(tx, groundRow - 1, 'hsla(120, 10%, 52%, 0.75)');
          } else {
            for (let ty = 0; ty < 4; ty += 1) {
              const half = Math.floor(ty / 2) + 1;
              for (let dx = -half; dx <= half; dx += 1) {
                drawDot(tx + dx, groundRow - 5 + ty, 'hsla(138, 30%, 54%, 0.88)');
              }
            }
            drawDot(tx, groundRow - 1, 'hsla(120, 10%, 52%, 0.75)');
          }
          if (t === 2) {
            const flicker = reducedMotion ? 0.95 : 0.72 + 0.28 * Math.sin(elapsed * 10);
            drawDot(tx + 4, groundRow - 1, `hsla(36, 96%, 66%, ${flicker.toFixed(2)})`);
            drawDot(tx + 5, groundRow - 1, `hsla(28, 92%, 58%, ${(flicker * 0.85).toFixed(2)})`);
          }
        }
      }

      // 6. Articulated galloping bright-white pixel horse
      const span = cols + 28;
      const horseCycle = running && !reducedMotion ? (elapsed * 24) % span : Math.floor(cols * 0.36);
      const horseX = running && !reducedMotion ? Math.floor(horseCycle) - 22 : Math.floor(cols * 0.34);
      const frameIdx = running && !reducedMotion ? Math.floor(elapsed * 12) % HORSE_FRAMES.length : 0;
      const bob = running && !reducedMotion && (frameIdx === 1 || frameIdx === 4) ? -1 : 0;
      const sprite = HORSE_FRAMES[frameIdx] ?? HORSE_FRAMES[0]!;
      const horseTop = groundRow - sprite.length + 1 + bob;

      for (let r = 0; r < sprite.length; r += 1) {
        const rowStr = sprite[r] ?? '';
        for (let c = 0; c < rowStr.length; c += 1) {
          const ch = rowStr[c];
          if (ch === '#') {
            drawDot(horseX + c, horseTop + r, 'rgba(255, 255, 255, 1)');
          } else if (ch === '.') {
            drawDot(horseX + c, horseTop + r, 'rgba(218, 218, 218, 0.85)');
          }
        }
      }

      if (running && !reducedMotion) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    renderFrame(startMs);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [running, reducedMotion, width, height, compact]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="dynamic-island-horse-canvas"
      aria-hidden="true"
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
    />
  );
}
