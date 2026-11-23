/**
 * Hermes-inspired split-pane & right-rail layout state with bounded persistence.
 */

export type RightRailTab = 'files' | 'preview' | 'terminal' | 'context';
export type ActivePaneId = 'primary' | 'secondary';

export interface WorkspacePaneLayout {
  splitEnabled: boolean;
  /** Primary pane share in split mode (0.30–0.70, default 0.54). */
  splitRatio: number;
  activePane: ActivePaneId;
  secondaryConversationId: string | null;
  rightRailOpen: boolean;
  /** Right rail width in pixels (260–560, default 360). */
  rightRailWidth: number;
  rightRailTab: RightRailTab;
}

export const DEFAULT_PANE_LAYOUT: WorkspacePaneLayout = {
  splitEnabled: false,
  splitRatio: 0.54,
  activePane: 'primary',
  secondaryConversationId: null,
  rightRailOpen: false,
  rightRailWidth: 360,
  rightRailTab: 'files',
};

const STORAGE_KEY = 'pixel.workspace.layout.v1';

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_PANE_LAYOUT.splitRatio;
  return Math.round(Math.min(0.7, Math.max(0.3, ratio)) * 100) / 100;
}

export function clampRightRailWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANE_LAYOUT.rightRailWidth;
  return Math.round(Math.min(560, Math.max(260, width)));
}

export function mergePaneLayout(raw: unknown): WorkspacePaneLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PANE_LAYOUT };
  const p = raw as Partial<WorkspacePaneLayout>;
  const validTab =
    p.rightRailTab === 'files' ||
    p.rightRailTab === 'preview' ||
    p.rightRailTab === 'terminal' ||
    p.rightRailTab === 'context'
      ? p.rightRailTab
      : DEFAULT_PANE_LAYOUT.rightRailTab;

  return {
    splitEnabled: p.splitEnabled === true,
    splitRatio: clampSplitRatio(p.splitRatio ?? DEFAULT_PANE_LAYOUT.splitRatio),
    activePane: p.activePane === 'secondary' ? 'secondary' : 'primary',
    secondaryConversationId:
      typeof p.secondaryConversationId === 'string' && p.secondaryConversationId.trim()
        ? p.secondaryConversationId
        : null,
    rightRailOpen: p.rightRailOpen === true,
    rightRailWidth: clampRightRailWidth(p.rightRailWidth ?? DEFAULT_PANE_LAYOUT.rightRailWidth),
    rightRailTab: validTab,
  };
}

export function loadPersistedPaneLayout(): WorkspacePaneLayout {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_PANE_LAYOUT };
    return mergePaneLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PANE_LAYOUT };
  }
}

export function savePersistedPaneLayout(layout: WorkspacePaneLayout): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Non-fatal in private/test environments.
  }
}
