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
 * wave / gear / check / cross / pause), a *motion* programme, and a neutral
 * shade. Status never depends on colour.
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
      {/* A quiet outline signals that the bar is open. */}
      {halo ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-[var(--color-border-strong)] opacity-70"
        />
      ) : null}

      {/* Outline rings mark microphone and speech activity. */}
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

      {/* The flat grayscale orb body. Shape and motion carry status. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full ${visual.motion}`}
        style={{
          background: visual.tone,
          border: '1px solid var(--color-border-strong)',
        }}
      />

      {/* The inner mark - the shape channel. Drawn above the body. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={size * 0.62}
        height={size * 0.62}
        className="relative"
        style={{ color: 'var(--color-app-bg)' }}
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
