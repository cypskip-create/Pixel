import type { AssistantState } from '@shared/types';

export function CursorBuddy({
  reducedMotion = false,
  flipX = false,
  flipY = false,
  state = 'idle',
}: { reducedMotion?: boolean; flipX?: boolean; flipY?: boolean; state?: AssistantState }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" data-state={state} className={reducedMotion ? 'cursor-buddy cursor-buddy-reduced' : 'cursor-buddy'} width="28" height="28" focusable="false">
      <g transform={`translate(${flipX ? 32 : 0} ${flipY ? 32 : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`}>
        <path d="M2 2 28 18 17 20 22 30 16.5 32 12 22 5.5 29Z" fill="#0D0D0D" stroke="#0D0D0D" strokeWidth="3.2" strokeLinejoin="round" />
        <path d="M2 2 28 18 17 20 22 30 16.5 32 12 22 5.5 29Z" fill="#0D0D0D" stroke="#F4F4F4" strokeWidth="1.25" strokeLinejoin="round" />
        <circle cx="12.4" cy="13.4" r="1.05" fill="#D4D4D4" />
        <circle cx="16.2" cy="15.6" r="0.8" fill="#D4D4D4" />
      </g>
    </svg>
  );
}
