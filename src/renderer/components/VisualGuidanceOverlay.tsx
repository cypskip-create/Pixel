import { useEffect, useState } from 'react';
import type { VisualGuidanceSnapshot } from '@shared/types';
import { useBridge } from '@/hooks/useBridge';
import { ScreenDrawingOverlay } from './ScreenDrawingOverlay';

const EMPTY: VisualGuidanceSnapshot = { visible: false, bounds: null, annotations: [] };

/** Passive transparent renderer for the main-process owned guidance & screen-drawing window. */
export function VisualGuidanceOverlay(): React.JSX.Element {
  const bridgeStatus = useBridge();
  const [snapshot, setSnapshot] = useState<VisualGuidanceSnapshot>(EMPTY);
  useEffect(() => {
    if (bridgeStatus.kind !== 'ready') return;
    return bridgeStatus.bridge.screen.onGuidanceUpdate(setSnapshot);
  }, [bridgeStatus]);

  const viewport = snapshot.visible && snapshot.bounds ? snapshot.bounds : null;
  return (
    <>
      <ScreenDrawingOverlay />
      {viewport && (
        <svg
          aria-hidden="true"
          className="pointer-events-none block h-full w-full overflow-hidden"
          width="100%"
          height="100%"
          viewBox={'0 0 ' + viewport.width + ' ' + viewport.height}
          preserveAspectRatio="none"
        >
      {snapshot.annotations.map((annotation) => {
        const x = annotation.bounds.x - viewport.x;
        const y = annotation.bounds.y - viewport.y;
        const width = annotation.bounds.width;
        const height = annotation.bounds.height;
        const text = annotation.label
          ? (annotation.step ? 'Step ' + annotation.step + ': ' : '') + annotation.label
          : annotation.step
            ? 'Step ' + annotation.step
            : '';
        const labelY = Math.max(20, y - 9);
        const labelWidth = Math.min(viewport.width - 12, Math.max(46, text.length * 7 + 18));
        const maxCharacters = Math.max(3, Math.floor((labelWidth - 18) / 7));
        const labelText = text.length > maxCharacters ? text.slice(0, maxCharacters - 1) + '…' : text;
        const cx = x + width / 2;
        const arrowY = Math.max(4, y - 20);
        const arrowEndY = y + Math.min(14, height / 2);
        return (
          <g key={annotation.id}>
            {annotation.shape === 'rectangle' && (
              <rect x={x} y={y} width={width} height={height} rx={4} fill="none" stroke="#F4F4F4" strokeWidth={2.5} />
            )}
            {annotation.shape === 'circle' && (
              <ellipse cx={cx} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="none" stroke="#F4F4F4" strokeWidth={2.5} />
            )}
            {annotation.shape === 'arrow' && (
              <path
                d={'M ' + cx + ' ' + arrowY + ' L ' + cx + ' ' + arrowEndY +
                  ' M ' + cx + ' ' + arrowEndY + ' l -6 -7 M ' + cx + ' ' + arrowEndY + ' l 6 -7'}
                fill="none"
                stroke="#F4F4F4"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {text && (
              <g transform={'translate(' + Math.max(6, Math.min(x, viewport.width - labelWidth - 6)) + ', ' + labelY + ')'}>
                <rect x={0} y={-18} width={labelWidth} height={24} rx={5} fill="#171717" stroke="#F4F4F4" strokeWidth={1.25} />
                <text x={9} y={-2} fill="#F4F4F4" fontFamily="Segoe UI, sans-serif" fontSize={12} fontWeight={600}>
                  {labelText}
                </text>
              </g>
            )}
          </g>
        );
      })}
        </svg>
      )}
    </>
  );
}
