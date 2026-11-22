import { useEffect, useRef } from 'react';
import { PixelSharkEngine, type SharkSceneMode } from '@/lib/asciiSharks';

export interface AsciiSharkBackgroundProps {
  /** 'empty' for a new empty conversation; 'active' for quieter background behind messages. */
  mode: SharkSceneMode;
  reducedMotion: boolean;
  theme?: 'dark' | 'light';
}

/**
 * Ambient ASCII glyph canvas rendered behind Pixel's conversation transcript.
 *
 * - Runs a single shared Canvas 2D rAF loop with zero React re-renders per frame.
 * - Continuously transitions from `empty` to `active` mode without resetting sharks.
 * - Strictly pointer-inert (`pointer-events: none`) and `aria-hidden="true"`.
 */
export function AsciiSharkBackground({
  mode,
  reducedMotion,
  theme = 'dark',
}: AsciiSharkBackgroundProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PixelSharkEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new PixelSharkEngine(canvas, { mode, reducedMotion, theme });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Single engine instance lives across empty <-> active transitions so sharks stay continuous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setOptions({ mode, reducedMotion, theme });
  }, [mode, reducedMotion, theme]);

  return (
    <div
      className="ascii-shark-bg"
      aria-hidden="true"
      data-shark-mode={mode}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <canvas ref={canvasRef} className="ascii-shark-canvas" aria-hidden="true" />
    </div>
  );
}
