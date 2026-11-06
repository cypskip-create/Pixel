import { useEffect, useState } from 'react';

/**
 * Detects whether non-essential motion should be suppressed.
 *
 * Two independent sources, either of which is sufficient:
 *  - the OS preference (`prefers-reduced-motion: reduce`), and
 *  - the app setting `companion.reducedMotion`.
 *
 * The OS query is read defensively because `matchMedia` is unavailable in some
 * test environments.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent): void => setPrefers(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefers;
}

/**
 * Applies the resolved motion policy to <html> so CSS controls every
 * animation. Returns the resolved value for components that need it in JS.
 */
export function useMotionPolicy(settingReducedMotion: boolean): boolean {
  const osReduced = usePrefersReducedMotion();
  const reduced = osReduced || settingReducedMotion;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', reduced);
  }, [reduced]);

  return reduced;
}
