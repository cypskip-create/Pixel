import { useEffect, useState } from 'react';

/** One deterministic, visibility-aware idle blink scheduler for each character. */
export function useCompanionAnimation(active: boolean, reducedMotion: boolean): {
  blink: boolean;
  visible: boolean;
} {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  );
  const [blink, setBlink] = useState(false);
  const motionDisabled = reducedMotion || systemReducedMotion;

  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!active || !visible || motionDisabled) {
      setBlink(false);
      return;
    }

    const intervals = [3_800, 5_100, 4_300, 6_200, 4_700] as const;
    let cycle = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const later = (callback: () => void, delay: number): void => {
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) callback();
      }, delay);
    };
    const schedule = (): void => later(blinkOnce, intervals[cycle % intervals.length] ?? intervals[0]);
    const blinkOnce = (): void => {
      setBlink(true);
      later(() => {
        setBlink(false);
        const doubleBlink = cycle % 4 === 2;
        cycle += 1;
        if (!doubleBlink) {
          schedule();
          return;
        }
        later(() => {
          setBlink(true);
          later(() => {
            setBlink(false);
            schedule();
          }, 100);
        }, 130);
      }, 140);
    };

    schedule();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [active, motionDisabled, visible]);

  return { blink, visible };
}
