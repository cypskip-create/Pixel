import { useEffect, useState } from 'react';
import type { AssistantState } from '@shared/types';

/** Original geometric companion for the Workspace, separate from the Pixel P. */
export function WorkspaceCharacter({ state, reducedMotion = false }: {
  state: AssistantState;
  reducedMotion?: boolean;
}): React.JSX.Element {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');

  useEffect(() => {
    const update = (): void => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return (
    <span
      className={`workspace-character${reducedMotion ? ' reduce-motion' : ''}${hidden ? ' is-hidden' : ''}`}
      data-state={state}
      role="img"
      aria-label={`Pixel is ${state.replaceAll('_', ' ')}`}
    >
      <svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">
        <path d="M10 4h20l14 13v18a9 9 0 0 1-9 9H11a7 7 0 0 1-7-7V11a7 7 0 0 1 6-7Z" fill="var(--workspace-panel-solid)" stroke="var(--workspace-accent)" strokeOpacity=".62" strokeWidth="1.5" />
        <path d="M30 4v9a5 5 0 0 0 5 5h9" fill="none" stroke="var(--workspace-accent)" strokeOpacity=".42" strokeWidth="1.5" />
        <path className="workspace-character-eye" d="M15 22h4v6h-4zM28 20h4v7h-4z" fill="var(--color-ink)" />
        <path className="workspace-character-mouth" d="M18 34c3 2 7 2 10-1" fill="none" stroke="var(--workspace-accent)" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M8 11h3M37 34h3" stroke="var(--workspace-accent)" strokeLinecap="round" strokeWidth="1.5" opacity=".75" />
      </svg>
      <span className="workspace-character-wave" aria-hidden="true"><i /><i /><i /></span>
    </span>
  );
}
