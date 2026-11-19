import type { AssistantState } from '@shared/types';

export function CursorBuddy({
  reducedMotion = false,
  flipX = false,
  flipY = false,
  state = 'idle',
}: { reducedMotion?: boolean; flipX?: boolean; flipY?: boolean; state?: AssistantState }): React.JSX.Element {
  const shell = 'M10 3h12c4.1 0 7 2.9 7 7v8c0 4.1-2.9 7-7 7h-9L2 29l3-8c-1.9-1.2-3-3-3-5.4V10c0-4.1 3-7 8-7Z';
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" data-state={state} className={reducedMotion ? 'cursor-buddy cursor-buddy-reduced' : 'cursor-buddy'} width="28" height="28" focusable="false">
      <g transform={`translate(${flipX ? 32 : 0} ${flipY ? 32 : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`}>
        <path d={shell} fill="#090909" stroke="#050505" strokeWidth="3" strokeLinejoin="round" />
        <path d={shell} fill="#2B2B2B" stroke="#E4E4E4" strokeWidth="1.15" strokeLinejoin="round" />
        <rect x="8" y="7" width="17" height="12" rx="4" fill="#111111" stroke="#555555" strokeWidth="0.7" />
        <circle cx="13.1" cy="12.4" r={state === 'listening' ? '1.8' : '1.35'} fill="#F0F0F0" />
        <circle cx="19.3" cy="12.4" r={state === 'listening' ? '1.8' : '1.35'} fill="#F0F0F0" />
        {state === 'success' ? <path d="M13 15.6q3.2 2.2 6.4 0" fill="none" stroke="#F0F0F0" strokeWidth="1" strokeLinecap="round" /> : <path d="M14.5 16h3" fill="none" stroke="#BFBFBF" strokeWidth="0.9" strokeLinecap="round" />}
        <circle cx="25.3" cy="20.6" r="0.8" fill="#BFBFBF" />
      </g>
    </svg>
  );
}
