import { useId } from 'react';
import type { AssistantState } from '@shared/types';
import { useCompanionAnimation } from '@/hooks/useCompanionAnimation';

export type PixExpression = 'idle' | 'listening' | 'thinking' | 'working' | 'speaking' | 'success' | 'concerned' | 'stopped';

export function expressionForAssistantState(state: AssistantState): PixExpression {
  switch (state) {
    case 'listening': return 'listening';
    case 'transcribing':
    case 'thinking':
    case 'responding': return 'thinking';
    case 'executing':
    case 'working':
    case 'pointing': return 'working';
    case 'speaking': return 'speaking';
    case 'success': return 'success';
    case 'waiting_for_approval':
    case 'error':
    case 'paused': return 'concerned';
    case 'stopped': return 'stopped';
    default: return 'idle';
  }
}

/** Canonical application mascot. Cursor Buddy deliberately uses separate art. */
export function PixMascot({
  state = 'idle',
  size = 40,
  reducedMotion = false,
  animate = true,
  decorative = false,
  className = '',
}: {
  state?: AssistantState;
  size?: number;
  reducedMotion?: boolean;
  animate?: boolean;
  decorative?: boolean;
  className?: string;
}): React.JSX.Element {
  const id = useId().replaceAll(':', '');
  const expression = expressionForAssistantState(state);
  const { blink, visible } = useCompanionAnimation(animate && expression === 'idle', reducedMotion);

  return (
    <svg
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : `Pix is ${state.replaceAll('_', ' ')}`}
      role={decorative ? undefined : 'img'}
      focusable="false"
      viewBox="0 0 48 52"
      width={size}
      height={size * (52 / 48)}
      className={`pix-mascot${reducedMotion ? ' reduce-motion' : ''}${visible ? '' : ' is-hidden'}${className ? ` ${className}` : ''}`}
      data-state={state}
      data-expression={expression}
      data-blink={blink ? 'true' : 'false'}
      data-animated={animate ? 'true' : 'false'}
    >
      <defs>
        <linearGradient id={`pix-shell-${id}`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor="var(--pix-shell-highlight)" />
          <stop offset="0.58" stopColor="var(--pix-shell)" />
          <stop offset="1" stopColor="var(--pix-shell-shadow)" />
        </linearGradient>
        <linearGradient id={`pix-fold-${id}`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="var(--pix-fold-highlight)" />
          <stop offset="1" stopColor="var(--pix-fold)" />
        </linearGradient>
        <linearGradient id={`pix-face-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#181B1E" />
          <stop offset="1" stopColor="var(--pix-face)" />
        </linearGradient>
        <filter id={`pix-shadow-${id}`} x="-30%" y="-30%" width="160%" height="170%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.15" />
          <feOffset dy="0.8" />
          <feComponentTransfer><feFuncA type="linear" slope="0.2" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <ellipse className="pix-ground-shadow" cx="24" cy="49.3" rx="11.5" ry="1.2" />
      <g className="pix-limbs" filter={`url(#pix-shadow-${id})`}>
        <rect className="pix-arm" fill={`url(#pix-shell-${id})`} x="0.8" y="22.7" width="7.1" height="8.1" rx="3.5" transform="rotate(18 4.3 26.7)" />
        <rect className="pix-arm" fill={`url(#pix-shell-${id})`} x="40.1" y="22.3" width="7.1" height="8.1" rx="3.5" transform="rotate(-18 43.6 26.3)" />
        <rect className="pix-foot" fill={`url(#pix-shell-${id})`} x="13.3" y="42.8" width="7.8" height="6" rx="2.8" transform="rotate(9 17.2 45.8)" />
        <rect className="pix-foot" fill={`url(#pix-shell-${id})`} x="27" y="42.8" width="7.8" height="6" rx="2.8" transform="rotate(-9 30.9 45.8)" />
      </g>

      <g className="pix-body" filter={`url(#pix-shadow-${id})`}>
        <rect className="pix-shell" fill={`url(#pix-shell-${id})`} x="6.2" y="2.1" width="35.6" height="40.1" rx="11" />
        <path className="pix-fold" fill={`url(#pix-fold-${id})`} d="M28.2 2.4h5.4c4.4 0 7.8 3.4 8.1 7.8l.5 7.2c-4.8-.4-8.6-2-11-4.9-2-2.4-2.9-5.7-3-10.1Z" />
        <path className="pix-face" fill={`url(#pix-face-${id})`} d="M11.4 13.8c0-2.5 2-4.5 4.5-4.5h17.7c2.5 0 4.5 2 4.5 4.5v18.1c0 2.5-2 4.5-4.5 4.5H15.9c-2.5 0-4.5-2-4.5-4.5V13.8Z" />
        <path className="pix-face-highlight" d="M15.5 10.8h17.7" />

        <g className="pix-eyes">
          {expression === 'listening' ? <>
            <ellipse className="pix-eye-open" cx="19" cy="22" rx="2.2" ry="3.3" />
            <ellipse className="pix-eye-open" cx="29.3" cy="22" rx="2.2" ry="3.3" />
          </> : expression === 'thinking' ? <>
            <path className="pix-eye-curve" d="M16.2 22c1.1-2.4 4.5-2.8 6.1-.3" />
            <path className="pix-eye-curve pix-eye-right-thoughtful" d="M26 20.8c1.5-2.3 4.8-1.8 5.8.7" />
          </> : expression === 'working' ? <>
            <path className="pix-eye-curve pix-eye-focused" d="M16.4 21.1h5.2" />
            <path className="pix-eye-curve pix-eye-focused" d="M26.6 21.1h5.2" />
          </> : expression === 'success' ? <>
            <path className="pix-eye-happy" d="m16.7 21.6 2.5-2.4 2.5 2.4-2.5 2.5-2.5-2.5Zm10.3 0 2.5-2.4 2.5 2.4-2.5 2.5-2.5-2.5Z" />
          </> : expression === 'concerned' ? <>
            <ellipse className="pix-eye-open" cx="19" cy="22" rx="2.3" ry="3.1" />
            <ellipse className="pix-eye-open" cx="29.3" cy="22" rx="2.3" ry="3.1" />
          </> : expression === 'stopped' ? <>
            <path className="pix-eye-curve" d="M16.5 22.2c1.5 1.7 4.1 1.7 5.6 0m4.6 0c1.5 1.7 4.1 1.7 5.6 0" />
          </> : <>
            <path className="pix-eye-curve" d="M16.2 22.7c1.4-2.8 4.7-3.1 6.2-.5" />
            <path className="pix-eye-curve" d="M25.9 22.2c1.5-2.7 4.8-2.4 6.1.5" />
          </>}
        </g>

        {expression === 'speaking' ? <ellipse className="pix-mouth pix-mouth-open" cx="24.2" cy="29.2" rx="2.3" ry="2.4" />
          : expression === 'concerned' ? <path className="pix-mouth pix-mouth-concerned" d="M20.8 30.7c1.7-1.8 5.1-1.8 6.8 0" />
            : expression === 'stopped' ? null
              : <path className="pix-mouth pix-mouth-smile" d="M20.4 29.1c1.9 2 5.6 2.2 7.7.1" />}

        {expression === 'thinking' ? <g className="pix-thinking-dots"><circle cx="34.1" cy="7.8" r=".8" /><circle cx="37" cy="5.5" r=".8" /><circle cx="40" cy="3.5" r=".8" /></g> : null}
        {expression === 'success' ? <path className="pix-success-spark" d="M35.5 18.7v4.6m-2.3-2.3h4.6" /> : null}
      </g>
    </svg>
  );
}
