import type { AssistantState } from '@shared/types';
import { PixMascot } from '@/components/PixMascot';

/** Official Pix mascot in the Workspace; the Pixel P remains a separate brand mark. */
export function WorkspaceCharacter({ state, reducedMotion = false }: {
  state: AssistantState;
  reducedMotion?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={`workspace-character${reducedMotion ? ' reduce-motion' : ''}`}
      data-state={state}
      role="img"
      aria-label={`Pixel is ${state.replaceAll('_', ' ')}`}
    >
      <PixMascot size={34} state={state} reducedMotion={reducedMotion} decorative className="workspace-character-art" />
    </span>
  );
}
