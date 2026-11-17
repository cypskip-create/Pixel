import { useId } from 'react';
import mark from '@shared/pixelMark.json';

export function PixelMark({ size = 28, className = '' }: { size?: number; className?: string }): React.JSX.Element {
  const maskId = `pixel-mark-cutout-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const viewBox = (mark.viewBox as number[]).join(' ');
  const sparkle = (mark.sparkle as number[][]).map(([x, y]) => `${String(x)},${String(y)}`).join(' ');
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="90" height="90">
        <rect width="90" height="90" fill="white" />
        <polygon points={sparkle} fill="black" />
      </mask>
      <g mask={`url(#${maskId})`}>
        {(mark.shapes as Array<Record<string, unknown>>).map((shape, index) => {
          const fill = mark.palette[shape.color as keyof typeof mark.palette];
          if (shape.kind === 'rect') {
            return <rect key={index} x={shape.x as number} y={shape.y as number} width={shape.width as number} height={shape.height as number} fill={fill} />;
          }
          const points = (shape.points as number[][]).map(([x, y]) => `${String(x)},${String(y)}`).join(' ');
          return <polygon key={index} points={points} fill={fill} />;
        })}
      </g>
    </svg>
  );
}
