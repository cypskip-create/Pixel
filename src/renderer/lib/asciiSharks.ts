/**
 * Pixel ASCII Shark ambient engine.
 *
 * Adapted from the spine-kinematics, cell-grid rendering, fixed-timestep loop,
 * passive pointer reaction, and reduced-motion architecture of
 * `stackedlol/ascii-sharks` (MIT License, Copyright (c) 2026 drewdi, rev fff1af0).
 *
 * Designed specifically for Pixel's dark matte workspace:
 *  - Replaces the upstream shark artwork with small, abstract Pixel-like
 *    constellation marks on a transparent Canvas 2D grid (zero React re-renders per frame).
 *  - Supports continuous transitions between `empty` (new chat) and `active`
 *    (quieter background behind live messages) without resetting shark positions.
 *  - Honors reduced-motion preferences, pauses when hidden/off-screen, and
 *    never captures pointer events.
 */

export type SharkSceneMode = 'empty' | 'active';

export interface SharkEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  scale: number;
  depth: number; // 0.45 (far) to 1.0 (near)
  baseSpeed: number;
  phase: number;
  waveFreq: number;
  turnTimer: number;
  /** Target visibility weight: primary sharks stay visible in active mode; secondary sharks gently fade. */
  activeVisible: boolean;
  opacityWeight: number;
}

export interface PlanktonDot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  char: string;
  alpha: number;
}

export interface SharkEngineOptions {
  mode: SharkSceneMode;
  reducedMotion: boolean;
  theme?: 'dark' | 'light';
  creature?: AsciiCreatureKind | 'auto';
}

/**
 * Right-facing anatomical ASCII shark sprite (11 rows x 40 cols).
 * Left-facing sharks are mirrored horizontally with bracket/slash reflection.
 */
export const SHARK_ART_RIGHT: readonly string[] = [
  '                     .:+15#                   ',
  '                    :+28%@@@1                 ',
  '   .:              :+59#@@@@@8:               ',
  '  :+15:.         .:+28%@@@@@@@@%61:.          ',
  '  :+259%#2:..  .:+158#@@@@@@@@@@@@@@@85210+:. ',
  '   .:+59#@@@@##@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%9',
  '    .:+89#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#',
  '  :+258#@@@@@@@@%965210++++1258%@@@@@@@@@@@@5:',
  '  :+15:.       .:+28#@@@5:.      .:+1589%@@2: ',
  '   .:            .:+59#@2:            .:+15:  ',
  '                   :+158:                     ',
  '                    .:+:                      ',
];

const HAMMERHEAD_ART_RIGHT: readonly string[] = [
  '                       .:+5#2:            .+158:  ',
  '                      :+28%@@@1          :+28%@9: ',
  '   .:                :+59#@@@@@2:      .:+59#@@@#:',
  '  :+15:.           .:+28%@@@@@@@@85211258#@@@@@@@#',
  '  :+259%#2::....::+158#@@@@@@@@@@@@@@@@@@@@@@@@@@#',
  '   .:+59#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@9',
  '  :+258#@@@@@@@@%965210++++1258%@@@@@@@@@@@#59#@5:',
  '  :+15:.       .:+28#@@@5:.      .:+1582:.  .:+58:',
  '   .:            .:+59#@2:                    :+1:',
];

export type AsciiCreatureKind = 'sharks' | 'jellyfish' | 'dolphin' | 'horse';

const JELLYFISH_ART: readonly string[] = [
  '             011011101110110             ',
  '         01110111111111111101110         ',
  '       011111111111111111111111110       ',
  '     0111111111111111111111111111110     ',
  '    011111111111111111111111111111110    ',
  '    101111011110111111111011110111101    ',
  '     0110101101011011101101011010110     ',
  '       1  0  1  0  1 1  0  1  0  1       ',
  '      0   1  0  1  0 1  1  0  1   0      ',
  '       1  0   1  0  1   0  1   0  1      ',
  '        0  1  0   1 0   1   0  1  0      ',
  '       1   0   1  0 1   0  1   0   1     ',
  '        0   1   0  1    0   1   0        ',
  '         1   0   1  0  1   0   1         ',
];

const DOLPHIN_ART_RIGHT: readonly string[] = [
  '                 .:+1589#2:.              ',
  '              .:+28#@@@@@@@%61:.          ',
  '            .:+59#@@@@@@@@@@@@@@%82:.     ',
  '   .:+15:..:+28%@@@@@@@@@@@@@@@@@@@@@%91: ',
  '  :+59#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%6:',
  '   :+28#@@@@@@@@@@@@@@@@@@@@@@@@@@@@8520: ',
  '     .:+158#@@@@@@@@@@%85210+::..         ',
  '          .:+28#@@@@5:.                   ',
  '             .:+158:                      ',
];

const HORSE_ART_RIGHT: readonly string[] = [
  '                         .:+5#@2:      ',
  '                        :+28#@@@@%1    ',
  '   .:+15:              :+59#@@@@@@8:   ',
  '  :+28%@@2::..      ..:+28%@@@@@@@5:   ',
  '   :+59#@@@@%85211258#@@@@@@@@@@@8:    ',
  '    :+28%@@@@@@@@@@@@@@@@@@@@@@@5:     ',
  '      :+59#@@@@@@@@@@@@@@@@@@@@2:      ',
  '       :+28#@@@@%620+::+28#@@@5:       ',
  '       :+28:  :+15:     :+28::+15:     ',
  '      :+15:    :+2:      :+15: :+2:    ',
  '      :+2:      :.       :+2:   :.     ',
];

const CREATURE_ORDER: readonly AsciiCreatureKind[] = ['sharks', 'jellyfish', 'dolphin', 'horse'];
const SCENE_CYCLE_SEC = 10;
const SCENE_FADE_SEC = 1.4;

const DENSE_CELL_GLYPHS = '01235689%@#';

const MIRROR_CHAR: Record<string, string> = {
  '/': '\\',
  '\\': '/',
  '(': ')',
  ')': '(',
  '<': '>',
  '>': '<',
  '[': ']',
  ']': '[',
};

export function mirrorAsciiLine(line: string): string {
  let out = '';
  for (let i = line.length - 1; i >= 0; i -= 1) {
    const ch = line[i] ?? ' ';
    out += MIRROR_CHAR[ch] ?? ch;
  }
  return out;
}

export const SHARK_ART_LEFT: readonly string[] = SHARK_ART_RIGHT.map(mirrorAsciiLine);

const STEP = 1 / 60;
const MAX_STEPS = 4;
const TARGET_FPS_INTERVAL_MS = 1000 / 60; // Smooth 60 fps canvas loop

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function createInitialSharks(width: number, height: number): SharkEntity[] {
  const w = Math.max(width, 480);
  const h = Math.max(height, 360);
  return [
    {
      id: 0,
      x: w * 0.22,
      y: h * 0.34,
      vx: 26,
      vy: 1.5,
      facing: 1,
      scale: 1.0,
      depth: 0.95,
      baseSpeed: 26,
      phase: 0.4,
      waveFreq: 2.1,
      turnTimer: 11,
      activeVisible: true,
      opacityWeight: 1,
    },
    {
      id: 1,
      x: w * 0.78,
      y: h * 0.25,
      vx: -22,
      vy: -1.2,
      facing: -1,
      scale: 0.88,
      depth: 0.82,
      baseSpeed: 22,
      phase: 2.1,
      waveFreq: 1.85,
      turnTimer: 14,
      activeVisible: true,
      opacityWeight: 1,
    },
    {
      id: 2,
      x: w * 0.72,
      y: h * 0.66,
      vx: -28,
      vy: 1.0,
      facing: -1,
      scale: 0.96,
      depth: 0.9,
      baseSpeed: 28,
      phase: 4.0,
      waveFreq: 2.25,
      turnTimer: 9,
      activeVisible: true,
      opacityWeight: 1,
    },
    {
      id: 3,
      x: w * 0.28,
      y: h * 0.72,
      vx: 18,
      vy: -0.9,
      facing: 1,
      scale: 0.72,
      depth: 0.62,
      baseSpeed: 18,
      phase: 1.2,
      waveFreq: 1.6,
      turnTimer: 16,
      activeVisible: false,
      opacityWeight: 1,
    },
    {
      id: 4,
      x: w * 0.54,
      y: h * 0.16,
      vx: 15,
      vy: 0.6,
      facing: 1,
      scale: 0.62,
      depth: 0.52,
      baseSpeed: 15,
      phase: 3.3,
      waveFreq: 1.45,
      turnTimer: 19,
      activeVisible: false,
      opacityWeight: 1,
    },
  ];
}

function createInitialPlankton(width: number, height: number): PlanktonDot[] {
  const count = clamp(Math.floor((width * height) / 28_000), 14, 38);
  const chars = ['.', '·', ':', '`'];
  const dots: PlanktonDot[] = [];
  for (let i = 0; i < count; i += 1) {
    // Deterministic spread so initial static frames look balanced
    const fx = ((i * 73 + 19) % 100) / 100;
    const fy = ((i * 41 + 11) % 100) / 100;
    dots.push({
      x: fx * width,
      y: fy * height,
      vx: (i % 2 === 0 ? 1 : -1) * (2.5 + (i % 4) * 1.1),
      vy: ((i % 3) - 1) * 0.8,
      char: chars[i % chars.length] ?? '.',
      alpha: 0.18 + (i % 5) * 0.05,
    });
  }
  return dots;
}

export class PixelSharkEngine {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private mode: SharkSceneMode;
  private reducedMotionProp: boolean;
  private theme: 'dark' | 'light';
  private creatureOverride: AsciiCreatureKind | 'auto' = 'auto';
  private osReducedMotion: MediaQueryList | null = null;

  private width = 800;
  private height = 500;
  private dpr = 1;
  private sharks: SharkEntity[];
  private plankton: PlanktonDot[];
  private pointer = { x: 0, y: 0, active: false };

  private rafId = 0;
  private lastFrameMs = 0;
  private lastRenderMs = 0;
  private acc = 0;
  private time = 0;
  private modeBlend = 0; // 0 = empty, 1 = active
  private visible = true;
  private pageHidden = false;
  private disposed = false;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;

  constructor(canvas: HTMLCanvasElement, options: SharkEngineOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = options.mode;
    this.modeBlend = options.mode === 'active' ? 1 : 0;
    this.reducedMotionProp = options.reducedMotion;
    this.theme = options.theme ?? 'dark';
    this.creatureOverride = options.creature ?? 'auto';

    const rect = canvas.getBoundingClientRect();
    this.width = Math.max(rect.width || 800, 160);
    this.height = Math.max(rect.height || 500, 160);
    this.sharks = createInitialSharks(this.width, this.height);
    this.plankton = createInitialPlankton(this.width, this.height);

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.osReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.osReducedMotion.addEventListener?.('change', this.onMotionChange);
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        this.visible = entry ? entry.isIntersecting : true;
        this.schedule();
      });
      this.intersectionObserver.observe(canvas);
    }

    if (typeof document !== 'undefined') {
      this.pageHidden = document.hidden;
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      window.addEventListener('blur', this.onPointerLeave);
    }

    this.resize();
    if (this.isFrozen()) {
      this.drawStaticFrame();
    } else {
      this.schedule();
    }
  }

  setOptions(options: Partial<SharkEngineOptions>): void {
    const prevFrozen = this.isFrozen();
    if (options.mode) this.mode = options.mode;
    if (typeof options.reducedMotion === 'boolean') this.reducedMotionProp = options.reducedMotion;
    if (options.theme) this.theme = options.theme;
    if (options.creature) this.creatureOverride = options.creature;

    const nextFrozen = this.isFrozen();
    if (nextFrozen) {
      this.modeBlend = this.mode === 'active' ? 1 : 0;
      this.stopLoop();
      this.drawStaticFrame();
    } else if (prevFrozen && !nextFrozen) {
      this.schedule();
    }
  }

  getStateSnapshot(): {
    mode: SharkSceneMode;
    sharkCount: number;
    visibleInActiveCount: number;
    frozen: boolean;
    paused: boolean;
  } {
    return {
      mode: this.mode,
      sharkCount: this.sharks.length,
      visibleInActiveCount: this.sharks.filter((s) => s.activeVisible).length,
      frozen: this.isFrozen(),
      paused: this.rafId === 0,
    };
  }

  destroy(): void {
    this.disposed = true;
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.osReducedMotion?.removeEventListener?.('change', this.onMotionChange);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('blur', this.onPointerLeave);
    }
  }

  private isFrozen(): boolean {
    return this.reducedMotionProp || Boolean(this.osReducedMotion?.matches);
  }

  private stopLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private schedule(): void {
    this.stopLoop();
    if (this.disposed || !this.visible || this.pageHidden || this.isFrozen()) return;
    this.lastFrameMs = performance.now();
    this.lastRenderMs = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.plankton = createInitialPlankton(this.width, this.height);
    if (this.isFrozen()) this.drawStaticFrame();
  }

  private drawStaticFrame(): void {
    this.modeBlend = this.mode === 'active' ? 1 : 0;
    for (const shark of this.sharks) {
      shark.opacityWeight = this.mode === 'active' && !shark.activeVisible ? 0 : 1;
    }
    this.render();
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameMs) / 1000));
    this.lastFrameMs = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.step(STEP);
      this.acc -= STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS) this.acc = 0;

    if (now - this.lastRenderMs >= TARGET_FPS_INTERVAL_MS) {
      this.lastRenderMs = now;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    this.time += dt;
    const targetBlend = this.mode === 'active' ? 1 : 0;
    this.modeBlend += (targetBlend - this.modeBlend) * Math.min(1, dt * 2.2);

    const speedScale = 1 - this.modeBlend * 0.38; // Calm down in active conversation mode
    const marginX = 160;
    const minY = 56;
    const maxY = Math.max(minY + 60, this.height - 120); // Stay clear of bottom composer

    for (const shark of this.sharks) {
      const targetWeight = this.mode === 'active' && !shark.activeVisible ? 0 : 1;
      shark.opacityWeight += (targetWeight - shark.opacityWeight) * Math.min(1, dt * 1.8);

      shark.phase += dt * shark.waveFreq * speedScale;
      shark.turnTimer -= dt;
      if (shark.turnTimer <= 0) {
        shark.turnTimer = 9 + ((shark.id * 3.7 + this.time) % 11);
        shark.vy += (Math.sin(this.time + shark.id) * 4.5 - shark.vy) * 0.4;
      }

      // Gentle vertical cruise & subtle pointer avoidance
      let steerY = Math.sin(shark.phase * 0.45) * 4.2;
      if (this.pointer.active) {
        const dx = shark.x - this.pointer.x;
        const dy = shark.y - this.pointer.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 180 * 180 && distSq > 1) {
          const dist = Math.sqrt(distSq);
          const push = (1 - dist / 180) * 18;
          steerY += (dy / dist) * push;
        }
      }

      // Soft centre clearance in empty mode so headline remains unobstructed
      if (this.modeBlend < 0.5) {
        const cx = this.width * 0.5;
        const cy = this.height * 0.44;
        const rx = Math.max(150, this.width * 0.24);
        const ry = Math.max(68, this.height * 0.16);
        const nx = (shark.x - cx) / rx;
        const ny = (shark.y - cy) / ry;
        if (nx * nx + ny * ny < 1) {
          steerY += (shark.y < cy ? -14 : 14) * (1 - this.modeBlend);
        }
      }

      shark.vy += (steerY - shark.vy) * Math.min(1, dt * 1.4);
      shark.vy = clamp(shark.vy, -14, 14);

      const targetVx = shark.facing * shark.baseSpeed * speedScale;
      shark.vx += (targetVx - shark.vx) * Math.min(1, dt * 2.0);

      shark.x += shark.vx * dt;
      shark.y += shark.vy * dt;

      if (shark.y < minY) {
        shark.y = minY;
        shark.vy = Math.abs(shark.vy) * 0.6;
      } else if (shark.y > maxY) {
        shark.y = maxY;
        shark.vy = -Math.abs(shark.vy) * 0.6;
      }

      // Wrap or gently turn around at canvas boundaries
      if (shark.facing === 1 && shark.x > this.width + marginX) {
        shark.facing = -1;
        shark.vx = -shark.baseSpeed * speedScale;
        shark.y = clamp(minY + ((shark.id * 97 + this.time * 13) % Math.max(80, maxY - minY)), minY, maxY);
      } else if (shark.facing === -1 && shark.x < -marginX) {
        shark.facing = 1;
        shark.vx = shark.baseSpeed * speedScale;
        shark.y = clamp(minY + ((shark.id * 113 + this.time * 17) % Math.max(80, maxY - minY)), minY, maxY);
      }
    }

    for (const dot of this.plankton) {
      dot.x += dot.vx * dt * speedScale;
      dot.y += dot.vy * dt * speedScale;
      if (dot.x < 0) dot.x = this.width;
      if (dot.x > this.width) dot.x = 0;
      if (dot.y < 0) dot.y = this.height;
      if (dot.y > this.height) dot.y = 0;
    }
  }

  private render(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const isLight = this.theme === 'light';
    const gridColor = (a: number) => (isLight ? `hsla(220, 25%, 20%, ${a.toFixed(3)})` : `hsla(215, 22%, 68%, ${a.toFixed(3)})`);
    const tileDarkColor = (a: number) => (isLight ? `hsla(215, 24%, 26%, ${a.toFixed(3)})` : `hsla(215, 28%, 34%, ${a.toFixed(3)})`);
    const tileMidColor = (a: number) => (isLight ? `hsla(215, 18%, 48%, ${a.toFixed(3)})` : `hsla(215, 22%, 24%, ${a.toFixed(3)})`);
    const glyphColor = (a: number) => (isLight ? `hsla(220, 38%, 12%, ${a.toFixed(3)})` : `hsla(214, 45%, 94%, ${a.toFixed(3)})`);
    const accentColor = (a: number) => (isLight ? `hsla(228, 72%, 48%, ${a.toFixed(3)})` : `hsla(212, 92%, 64%, ${a.toFixed(3)})`);

    // Bold, crisp visibility in empty mode; gentle backdrop in active chat mode
    const sceneAlpha = (1 - this.modeBlend) * 0.96 + this.modeBlend * 0.36;

    // 0. Crisp Inspora hairline square grid
    const gridStep = 14;
    ctx.strokeStyle = gridColor(sceneAlpha * 0.085);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx < this.width; gx += gridStep) {
      ctx.moveTo(gx + 0.5, 0);
      ctx.lineTo(gx + 0.5, this.height);
    }
    for (let gy = 0; gy < this.height; gy += gridStep) {
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(this.width, gy + 0.5);
    }
    ctx.stroke();

    // 1. Ambient drifting ASCII micro-dots
    ctx.font = '11px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textBaseline = 'top';
    for (const dot of this.plankton) {
      const a = clamp(dot.alpha * sceneAlpha * 1.35, 0.05, 0.55);
      ctx.fillStyle = glyphColor(a);
      ctx.fillText(dot.char, dot.x, dot.y);
    }

    // Active creature selection (auto-cycles Sharks -> Jellyfish -> Dolphin -> Horse, or manual lock)
    let creature: AsciiCreatureKind = 'sharks';
    let cycleFade = 1;
    if (this.creatureOverride !== 'auto') {
      creature = this.creatureOverride;
    } else {
      const cyclePos = (this.time % (SCENE_CYCLE_SEC * CREATURE_ORDER.length)) / SCENE_CYCLE_SEC;
      const idx = Math.floor(cyclePos) % CREATURE_ORDER.length;
      const withinSec = (cyclePos - Math.floor(cyclePos)) * SCENE_CYCLE_SEC;
      if (withinSec < SCENE_FADE_SEC) {
        cycleFade = 0.25 + 0.75 * (withinSec / SCENE_FADE_SEC);
      } else if (withinSec > SCENE_CYCLE_SEC - SCENE_FADE_SEC) {
        cycleFade = 0.25 + 0.75 * ((SCENE_CYCLE_SEC - withinSec) / SCENE_FADE_SEC);
      }
      creature = CREATURE_ORDER[idx] ?? 'sharks';
    }

    // 2. High-contrast cell-shaded ASCII creatures with articulated spine/tentacle/gallop kinematics
    const glyphTick = Math.floor(this.time * 6);
    for (const shark of this.sharks) {
      const weight = shark.opacityWeight * clamp(cycleFade, 0.25, 1);
      if (weight < 0.04) continue;

      const cell = Math.max(9, Math.round(11 * shark.scale));
      ctx.font = `700 ${Math.max(9, Math.round(cell * 0.9))}px ui-monospace, "Cascadia Mono", Consolas, monospace`;

      let sprite: readonly string[];
      if (creature === 'jellyfish') {
        sprite = JELLYFISH_ART;
      } else if (creature === 'dolphin') {
        sprite = shark.facing === 1 ? DOLPHIN_ART_RIGHT : DOLPHIN_ART_RIGHT.map(mirrorAsciiLine);
      } else if (creature === 'horse') {
        sprite = shark.facing === 1 ? HORSE_ART_RIGHT : HORSE_ART_RIGHT.map(mirrorAsciiLine);
      } else {
        // Mix hammerhead & classic reef sharks like Inspora shark-ascii-animation!
        const baseShark = shark.id % 2 === 1 ? HAMMERHEAD_ART_RIGHT : SHARK_ART_RIGHT;
        sprite = shark.facing === 1 ? baseShark : baseShark.map(mirrorAsciiLine);
      }

      const cols = sprite[0]?.length ?? 40;
      const spriteW = cols * cell;
      const spriteH = sprite.length * cell;
      const originX = shark.x - spriteW * 0.5;
      const originY = shark.y - spriteH * 0.5;
      const baseAlpha = sceneAlpha * clamp(0.68 + shark.depth * 0.32, 0.7, 1.0) * weight;

      for (let row = 0; row < sprite.length; row += 1) {
        const line = sprite[row] ?? '';
        for (let col = 0; col < line.length; col += 1) {
          const rawCh = line[col];
          if (!rawCh || rawCh === ' ') continue;

          const bodyT = shark.facing === 1 ? 1 - col / line.length : col / line.length;
          let offsetX = 0;
          let offsetY = 0;
          if (creature === 'jellyfish') {
            const tentacleFactor = row >= 7 ? (row - 6) / 7 : 0;
            offsetX = Math.sin(shark.phase * 1.6 - row * 0.7 + col * 0.28) * (6.0 * tentacleFactor * shark.scale);
            offsetY = Math.sin(shark.phase * 1.35) * (4.0 * (1 - tentacleFactor) * shark.scale);
          } else if (creature === 'horse') {
            const legFactor = row >= 8 ? 1 : 0.18;
            offsetX = Math.sin(shark.phase * 3.1 + col * 0.45) * (4.2 * legFactor * shark.scale);
            offsetY = Math.abs(Math.sin(shark.phase * 2.6)) * (-4.5 * shark.scale);
          } else {
            offsetY = Math.sin(shark.phase - bodyT * 4.8) * (4.8 * bodyT * shark.scale);
          }

          const px = Math.round((originX + col * cell + offsetX) / cell) * cell;
          const py = Math.round((originY + row * cell + offsetY) / cell) * cell;

          const isCore = rawCh === '@' || rawCh === '#' || rawCh === '%' || rawCh === '1';
          const isMid = rawCh === '8' || rawCh === '9' || rawCh === '5' || rawCh === '6' || rawCh === '2' || rawCh === '0';
          const tileAlpha = clamp(baseAlpha * (isCore ? 0.74 : isMid ? 0.48 : 0.24), 0.08, 0.85);
          ctx.fillStyle = isCore && (row + col) % 6 === 0
            ? accentColor(tileAlpha * 0.85)
            : isCore
              ? tileDarkColor(tileAlpha)
              : tileMidColor(tileAlpha);
          ctx.fillRect(px, py, cell - 1, cell - 1);

          let ch = rawCh;
          if (creature === 'jellyfish' && (rawCh === '0' || rawCh === '1')) {
            ch = ((row * 13 + col * 7 + glyphTick) % 2 === 0) ? '0' : '1';
          } else if (isCore && (row + col + glyphTick) % 4 === 0) {
            ch = DENSE_CELL_GLYPHS[(row * 5 + col * 3 + glyphTick) % DENSE_CELL_GLYPHS.length] ?? rawCh;
          }

          const charAlpha = clamp(baseAlpha * (isCore ? 0.98 : isMid ? 0.88 : 0.7), 0.2, 1.0);
          ctx.fillStyle = isCore && creature === 'jellyfish' ? accentColor(charAlpha) : glyphColor(charAlpha);
          ctx.fillText(ch, px + 1, py + 1);
        }
      }
    }

    ctx.restore();
  }

  private onMotionChange = (): void => {
    if (this.isFrozen()) {
      this.stopLoop();
      this.drawStaticFrame();
    } else {
      this.schedule();
    }
  };

  private onVisibilityChange = (): void => {
    this.pageHidden = typeof document !== 'undefined' ? document.hidden : false;
    if (this.pageHidden) {
      this.stopLoop();
    } else if (!this.isFrozen()) {
      this.schedule();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = inside && event.pointerType !== 'touch';
  };

  private onPointerLeave = (): void => {
    this.pointer.active = false;
  };
}
