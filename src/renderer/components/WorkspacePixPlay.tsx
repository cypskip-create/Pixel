import { useEffect, useState } from 'react';
import type { AssistantState } from '@shared/types';
import { PixMascot } from '@/components/PixMascot';

/** A small, bounded idle home for Pix beside the composer. */
export function WorkspacePixPlay({ state, reducedMotion }: { state: AssistantState; reducedMotion: boolean }): React.JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  );
  const motionDisabled = reducedMotion || systemReducedMotion;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (state !== 'idle' || motionDisabled) {
      setPlaying(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const schedule = (): void => {
      if (disposed || document.visibilityState === 'hidden' || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || document.visibilityState === 'hidden') return;
        setPlaying(true);
        timer = setTimeout(() => {
          timer = undefined;
          setPlaying(false);
          if (!disposed) schedule();
        }, 2_700);
      }, 24_000 + Math.round(Math.random() * 16_000));
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        if (timer) clearTimeout(timer);
        timer = undefined;
        setPlaying(false);
      } else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [motionDisabled, state]);

  const active = playing && state === 'idle' && !motionDisabled;
  return <div className="workspace-pix-play" aria-hidden="true" data-playing={active ? 'true' : 'false'}>
    <span className="workspace-pix-home"><PixMascot size={44} state={state} reducedMotion={motionDisabled} decorative /></span>
    <span className="workspace-pix-ball" />
  </div>;
}
