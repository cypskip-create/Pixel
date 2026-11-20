import { useEffect, useRef, useState } from 'react';
import type { AssistantState } from '@shared/types';
import { PixMascot } from '@/components/PixMascot';

export type PixPetActivity = 'idle' | 'looking' | 'sitting' | 'lying' | 'sleeping' | 'waking' | 'stretching' | 'walking' | 'exploring' | 'playing' | 'jumping' | 'waving' | 'thinking' | 'resting';

const ACTIVE_BEHAVIORS: PixPetActivity[] = ['looking', 'looking', 'sitting', 'lying', 'stretching', 'walking', 'exploring', 'playing', 'jumping', 'waving', 'thinking', 'resting'];

/** Select a bounded idle behavior. Exposed for deterministic scheduler tests. */
export function choosePixPetActivity(idleMs: number, random: () => number, previous: PixPetActivity): PixPetActivity {
  if (idleMs >= 180_000 && previous !== 'sleeping' && random() < 0.3) return 'sleeping';
  const restingOptions = (['sitting', 'lying'] as const).filter((activity) => activity !== previous);
  if (idleMs >= 60_000 && restingOptions.length > 0 && random() < 0.28) {
    return restingOptions[Math.min(restingOptions.length - 1, Math.floor(random() * restingOptions.length))];
  }
  const eligible = ACTIVE_BEHAVIORS.filter((activity) => activity !== previous);
  return eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))] ?? 'looking';
}

/** One event-driven idle scheduler for the single Workspace Pix. */
export function WorkspacePixPlay({ state, reducedMotion }: { state: AssistantState; reducedMotion: boolean }): React.JSX.Element {
  const [activity, setActivity] = useState<PixPetActivity>('idle');
  const activityRef = useRef<PixPetActivity>('idle');
  const lastActivity = useRef<PixPetActivity>('idle');
  const updateActivity = (next: PixPetActivity): void => { activityRef.current = next; setActivity(next); };
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
      updateActivity('idle');
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let startedAt = Date.now();
    const clearTimer = (): void => { if (timer) clearTimeout(timer); timer = undefined; };
    const schedule = (): void => {
      if (disposed || document.visibilityState === 'hidden' || timer || activityRef.current !== 'idle') return;
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed || document.visibilityState === 'hidden') return;
        const next = choosePixPetActivity(Date.now() - startedAt, Math.random, lastActivity.current);
        lastActivity.current = next;
        updateActivity(next);
        if (next === 'sleeping') return;
        const duration = next === 'playing' ? 2_700 : next === 'exploring' || next === 'walking' ? 2_200 : next === 'lying' || next === 'sitting' || next === 'resting' ? 4_000 : 1_500;
        timer = setTimeout(() => { timer = undefined; updateActivity('idle'); schedule(); }, duration);
      }, 24_000 + Math.round(Math.random() * 16_000));
    };
    const wake = (): void => {
      startedAt = Date.now();
      clearTimer();
      if (activityRef.current === 'sleeping') {
        updateActivity('waking');
        timer = setTimeout(() => { timer = undefined; updateActivity('idle'); schedule(); }, 900);
      } else if (activityRef.current !== 'idle') {
        updateActivity('idle');
        schedule();
      } else schedule();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
        updateActivity('idle');
      } else { startedAt = Date.now(); schedule(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('keydown', wake, true);
    document.addEventListener('pointerdown', wake, true);
    document.addEventListener('focusin', wake, true);
    schedule();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', wake, true);
      document.removeEventListener('pointerdown', wake, true);
      document.removeEventListener('focusin', wake, true);
    };
  }, [motionDisabled, state]);

  const active = state === 'idle' && !motionDisabled ? activity : 'idle';
  return <div className="workspace-pix-play" aria-hidden="true" data-activity={active} data-playing={active === 'playing' ? 'true' : 'false'}>
    <span className="workspace-pix-home"><PixMascot size={44} state={active === 'sleeping' || active === 'resting' || active === 'lying' ? 'stopped' : state} reducedMotion={motionDisabled} decorative /></span>
    <span className="workspace-pix-ball" />
  </div>;
}
