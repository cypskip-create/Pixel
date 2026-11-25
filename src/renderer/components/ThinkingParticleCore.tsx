import { useEffect, useRef } from 'react';

export interface ThinkingParticleCoreProps {
  /** Pixel square dimension (default 76px, or 28-32px when compact). */
  size?: number;
  reducedMotion?: boolean;
  label?: string;
  /** Compact inline blob mode (for composer send area & Dynamic Island). */
  compact?: boolean;
}

interface Particle3D {
  x: number;
  y: number;
  z: number;
  phase: number;
  ring: boolean;
}

/**
 * High-density 3D morphing particle blob + octahedral core lattice (~520 particles)
 * matching Inspora `1-50` ("Connected to the Core") with high-contrast bright white
 * and silver square pixel particles on a #090909 well.
 */
function buildParticles(): Particle3D[] {
  const pts: Particle3D[] = [];
  // Golden-spiral spherical/octahedral shell + inner planar cross-ridges
  const total = 440;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < total; i += 1) {
    const y = 1 - (i / (total - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    // Blend sphere toward faceted polyhedron
    const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z);
    const facet = 1 / Math.max(0.72, l1 * 0.76);
    pts.push({
      x: x * facet,
      y: y * facet,
      z: z * facet,
      phase: (i % 29) * 0.22,
      ring: i % 9 === 0,
    });
  }
  // Internal crystalline axes
  for (let s = -8; s <= 8; s += 1) {
    const u = s / 8;
    pts.push({ x: u, y: u * 0.4, z: 0, phase: s * 0.3, ring: false });
    pts.push({ x: 0, y: u, z: u * 0.4, phase: s * 0.5, ring: false });
    pts.push({ x: u * 0.4, y: 0, z: u, phase: s * 0.7, ring: false });
  }
  return pts;
}

const PARTICLES = buildParticles();

export function ThinkingParticleCore({
  size = 76,
  reducedMotion = false,
  label = 'Thinking…',
  compact = false,
}: ThinkingParticleCoreProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    let rafId = 0;
    const startMs = performance.now();

    const draw = (nowMs: number) => {
      const t = reducedMotion ? 0.8 : (nowMs - startMs) / 1000;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#090909';
      ctx.fillRect(0, 0, size, size);

      const angleY = t * 1.05;
      const angleX = t * 0.68 + Math.sin(t * 0.9) * 0.3;
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const cx = size * 0.5;
      const cy = size * 0.5;
      const scale = size * 0.36;

      const projected: Array<{ sx: number; sy: number; depth: number; ring: boolean }> = [];
      for (let i = 0; i < PARTICLES.length; i += 1) {
        const p = PARTICLES[i]!;
        // Organic liquid-crystal blob morphing wave
        const blobWave =
          1 +
          0.16 * Math.sin(t * 2.4 + p.x * 3.1 + p.y * 2.4) +
          0.11 * Math.cos(t * 1.9 - p.z * 3.4 + p.phase);
        const scatter = p.ring ? 1.14 + 0.08 * Math.sin(t * 3 + p.phase) : 1.0;

        const px = p.x * blobWave * scatter;
        const py = p.y * blobWave * scatter;
        const pz = p.z * blobWave * scatter;

        const rx = px * cosY - pz * sinY;
        const rz1 = px * sinY + pz * cosY;
        const ry = py * cosX - rz1 * sinX;
        const rz = py * sinX + rz1 * cosX;

        const persp = 2.5 / (2.5 - rz * 0.82);
        projected.push({
          sx: cx + rx * scale * persp,
          sy: cy + ry * scale * persp,
          depth: rz,
          ring: p.ring,
        });
      }

      projected.sort((a, b) => a.depth - b.depth);
      const dotSize = Math.max(2, Math.round(size / 36));

      for (const pt of projected) {
        const norm = Math.max(0, Math.min(1, (pt.depth + 1.25) / 2.5));
        const alpha = pt.ring ? 0.35 + norm * 0.65 : 0.25 + norm * 0.75;
        const lum = Math.round(150 + norm * 105);
        ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum}, ${alpha.toFixed(2)})`;
        ctx.fillRect(Math.round(pt.sx), Math.round(pt.sy), dotSize, dotSize);
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    draw(startMs);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [size, reducedMotion]);

  if (compact) {
    return (
      <div
        data-testid="thinking-particle-core"
        title={label}
        aria-label={label}
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[#090909]"
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: `${size}px`, height: `${size}px`, display: 'block' }}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="thinking-particle-core"
      className="inline-flex items-center gap-3.5 rounded-2xl border border-[var(--color-border-strong)] bg-[#090909] px-3.5 py-2.5"
    >
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#050505]">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: `${size}px`, height: `${size}px`, display: 'block' }}
        />
      </div>
      <div className="flex flex-col gap-0.5 pr-2">
        <span className="text-xs font-semibold text-[#F3F3F3]">{label}</span>
        <span className="font-mono text-[10.5px] text-[#ABABAB]">Synthesizing context &amp; tools</span>
      </div>
    </div>
  );
}
