import { memo } from 'react';
import type { JSX } from 'react';
import type { AssistantState } from '@shared/types';
import type { OrbMark } from '@/lib/orbVisuals';
import { orbVisual } from '@/lib/orbVisuals';

interface AvatarProps {
  /** Which of the eight assistant states to render. */
  state: AssistantState;
  /** Diameter in logical pixels. */
  size?: number;
  /** Adds the outer halo ring used when the bar is expanded. */
  halo?: boolean;
}

/**
 * The Pixel orb.
 *
 * This is the whole product at rest: a single round avatar floating at the top
 * of the screen. It renders the state as a *shape* (core / ring / diamond /
 * wave / gear / check / cross / pause), a *motion* programme, and a *hue* -
 * three redundant channels so no two states are confusable without colour.
 *
 * The mark geometry is inline SVG rather than an icon font so it inherits
 * `currentColor` and stays crisp at any zoom.
 */
export const Avatar = memo(function Avatar({ state, size = 30, halo = false }: AvatarProps) {
  const visual = orbVisual(state);
  const stroke = Math.max(1.75, size * 0.075);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Pixel is ${visual.label.toLowerCase()}`}
      data-state={state}
    >
      {/* Halo: a soft ring that signals "the bar is open". */}
      {halo ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full opacity-70"
          style={{
            boxShadow: `0 0 0 1px ${visual.tone}33, 0 0 18px 2px ${visual.tone}55`,
          }}
        />
      ) : null}

      {/* Ambient bloom, always present; stronger while busy. */}
      <span
        aria-hidden="true"
        className="absolute rounded-full"
        style={{
          inset: -size * 0.22,
          background: `radial-gradient(circle at 50% 50%, ${visual.tone}${visual.busy ? '4d' : '33'} 0%, transparent 70%)`,
          filter: 'blur(3px)',
          transition: 'background var(--cyps-duration) ease',
        }}
      />

      {/* Expanding sonar rings: listening / speaking read as "broadcasting". */}
      {(state === 'listening' || state === 'speaking') && (
        <span
          aria-hidden="true"
          className="orb-pulse absolute inset-0 rounded-full"
          style={{
            border: `${Math.max(1, size * 0.045)}px solid ${visual.tone}`,
            animationDelay: state === 'speaking' ? '1.1s' : '0.55s',
          }}
        />
      )}

      {/* The orb body. The outer element breathes/spins; the inner stays put. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full ${visual.motion}`}
        style={{
          background: `radial-gradient(circle at 34% 28%, ${visual.tone} 0%, ${visual.tone}cc 42%, ${visual.tone}66 72%, ${visual.tone}22 100%)`,
          boxShadow: `inset 0 1px 1px rgb(255 255 255 / 0.45), 0 2px 10px -2px ${visual.tone}99`,
        }}
      >
        {/* Glossy top-left highlight gives the orb its spherical read. */}
        <span
          className="absolute rounded-full"
          style={{
            left: '20%',
            top: '14%',
            width: '34%',
            height: '26%',
            background: 'radial-gradient(circle, rgb(255 255 255 / 0.85), transparent 70%)',
            filter: 'blur(0.5px)',
          }}
        />
      </span>

      {/* The inner mark - the shape channel. Drawn above the body. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        className="relative"
        style={{ color: 'rgb(9 12 20 / 0.82)' }}
      >
        <Mark mark={visual.mark} stroke={stroke} />
      </svg>
    </span>
  );
});

function Mark({
  mark,
  stroke,
}: {
  mark: OrbMark;
  stroke: number;
}): JSX.Element {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (mark.kind) {
    case 'circle':
      return <circle cx={12} cy={12} r={mark.r} fill="currentColor" />;
    case 'ring':
      return <circle cx={12} cy={12} r={mark.r} {...common} strokeWidth={mark.width} />;
    case 'path':
      return <path d={mark.d} {...common} strokeWidth={mark.width} />;
    case 'bars': {
      const gap = 3.2;
      const totalWidth = mark.widths.length * gap - gap;
      const startX = 12 - totalWidth / 2;
      return (
        <g fill="currentColor">
          {mark.widths.map((height: number, index: number) => (
            <rect
              key={`bar-${String(index)}`}
              x={startX + index * gap - stroke * 0.36}
              y={12 - height * 1.9}
              width={Math.max(1.4, stroke * 0.72)}
              height={height * 3.8}
              rx={stroke * 0.36}
            />
          ))}
        </g>
      );
    }
  }
}
