import { useEffect, useRef } from 'react';

export interface ThinkingParticleCoreProps {
  /** Pixel square dimension (default 56px). */
  size?: number;
  reducedMotion?: boolean;
  label?: string;
}

interface Particle3D {
  x: number;
  y: number;
  z: number;
  jitter: number;
}

/**
 * Generate a deterministic 3D octahedral + cubic crystalline lattice of particles
 * matching Inspora `1-50` ("Connected to the Core") monochrome particle morphing blob.
 */
function buildLatticeParticles(): Particle3D[] {
  const pts: Particle3D[] = [];
  const steps = 6;
  for (let ix = -steps; ix <= steps; ix += 1) {
    for (let iy = -steps; iy <= steps; iy += 1) {
      for (let iz = -steps; iz <= steps; iz += 1) {
        const ax = Math.abs(ix);
        const ay = Math.abs(iy);
        const az = Math.abs(iz);
        const manhattan = ax + ay + az;
        const chebyshev = Math.max(ax, ay, az);
        // Surface shell of octahedron + inner cubic lattice ridges
        if (manhattan === steps || (chebyshev === steps - 1 && (ax === 0 || ay === 0 || az === 0))) {
          pts.push({
            x: ix / steps,
            y: iy / steps,
            z: iz / steps,
            jitter: ((ix * 31 + iy * 17 + iz * 13) % 11) * 0.08,
          });
        }
      }
    }
  }
  return pts;
}

const PARTICLES = buildLatticeParticles();

/**
 * 60 FPS monochrome 3D particle-core thinking indicator (Inspora `1-50`).
 * Crisp square pixel particles with depth-sorted luminance and organic breathing morph.
 */
export function ThinkingParticleCore({
  size = 56,
  reducedMotion = false,
  label = 'Thinking',
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

    let rafId = 0;
    const startMs = performance.now();

    const draw = (nowMs: number) => {
      const t = reducedMotion ? 0.6 : (nowMs - startMs) / 1000;
      ctx.clearRect(0, 0, size, size);

      const angleY = t * 0.95;
      const angleX = t * 0.62 + Math.sin(t * 0.8) * 0.25;
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const morph = 1 + Math.sin(t * 2.1) * 0.12;
      const cx = size * 0.5;
      const cy = size * 0.5;
      const scale = size * 0.34;

      const projected: Array<{ sx: number; sy: number; depth: number }> = [];
      for (let i = 0; i < PARTICLES.length; i += 1) {
        const p = PARTICLES[i]!;
        const wave = morph + Math.sin(t * 2.6 + p.jitter * 6) * 0.09;
        const px = p.x * wave;
        const py = p.y * wave;
        const pz = p.z * wave;

        // Rotate Y then X
        const rx = px * cosY - pz * sinY;
        const rz1 = px * sinY + pz * cosY;
        const ry = py * cosX - rz1 * sinX;
        const rz = py * sinX + rz1 * cosX;

        const persp = 2.4 / (2.4 - rz * 0.75);
        projected.push({
          sx: cx + rx * scale * persp,
          sy: cy + ry * scale * persp,
          depth: rz,
        });
      }

      projected.sort((a, b) => a.depth - b.depth);
      const dotSize = Math.max(1.5, size / 34);

      for (const pt of projected) {
        const norm = Math.max(0, Math.min(1, (pt.depth + 1.2) / 2.4));
        const alpha = 0.2 + norm * 0.8;
        ctx.fillStyle = `rgba(245, 245, 245, ${alpha.toFixed(2)})`;
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

  return (
    <div
      data-testid="thinking-particle-core"
      className="inline-flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
    >
      <div className="flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] p-1">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: `${size}px`, height: `${size}px`, display: 'block' }}
        />
      </div>
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}
