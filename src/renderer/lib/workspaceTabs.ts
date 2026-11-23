/**
 * Hermes-inspired per-session tab state manager for Pixel Workspace.
 *
 * Isolates draft text, scroll position, busy/streaming state, and active model
 * per tab so background conversation updates never overwrite the visible tab.
 */

export interface WorkspaceSessionTab {
  id: string;
  conversationId: string | null;
  title: string;
  draft: string;
  scrollTop: number;
  busy: boolean;
  model?: string;
  provider?: string;
  pinned?: boolean;
  lastActiveAt: number;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceSessionTab[];
  activeTabId: string;
  closedTabs: WorkspaceSessionTab[];
}

const STORAGE_KEY = 'pixel.workspace.tabs.v1';
const MAX_TABS = 16;
const MAX_CLOSED = 10;

export function makeTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createNewTab(overrides: Partial<WorkspaceSessionTab> = {}): WorkspaceSessionTab {
  return {
    id: overrides.id ?? makeTabId(),
    conversationId: overrides.conversationId ?? null,
    title: overrides.title?.trim() || 'New chat',
    draft: overrides.draft ?? '',
    scrollTop: overrides.scrollTop ?? 0,
    busy: overrides.busy ?? false,
    model: overrides.model,
    provider: overrides.provider,
    pinned: overrides.pinned ?? false,
    lastActiveAt: overrides.lastActiveAt ?? Date.now(),
  };
}

export function createInitialTabsState(
  initialConversationId: string | null = null,
  initialTitle = 'New chat',
): WorkspaceTabsState {
  const first = createNewTab({ conversationId: initialConversationId, title: initialTitle });
  return {
    tabs: [first],
    activeTabId: first.id,
    closedTabs: [],
  };
}

export function loadPersistedTabsState(
  fallbackConversationId: string | null = null,
): WorkspaceTabsState {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return createInitialTabsState(fallbackConversationId);
    const parsed = JSON.parse(raw) as Partial<WorkspaceTabsState>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return createInitialTabsState(fallbackConversationId);
    }
    const tabs: WorkspaceSessionTab[] = parsed.tabs
      .filter((t): t is WorkspaceSessionTab => Boolean(t && typeof t.id === 'string'))
      .slice(0, MAX_TABS)
      .map((t) => ({
        id: t.id,
        conversationId: typeof t.conversationId === 'string' ? t.conversationId : null,
        title: typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 80) : 'New chat',
        draft: typeof t.draft === 'string' ? t.draft : '',
        scrollTop: typeof t.scrollTop === 'number' && Number.isFinite(t.scrollTop) ? Math.max(0, t.scrollTop) : 0,
        busy: false, // Never restore stale busy indicators across restart
        model: typeof t.model === 'string' ? t.model : undefined,
        provider: typeof t.provider === 'string' ? t.provider : undefined,
        pinned: t.pinned === true,
        lastActiveAt: typeof t.lastActiveAt === 'number' ? t.lastActiveAt : Date.now(),
      }));
    if (tabs.length === 0) return createInitialTabsState(fallbackConversationId);
    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId! : tabs[0]!.id;
    return { tabs, activeTabId, closedTabs: [] };
  } catch {
    return createInitialTabsState(fallbackConversationId);
  }
}

export function savePersistedTabsState(state: WorkspaceTabsState): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: state.tabs.map((t) => ({ ...t, busy: false })),
        activeTabId: state.activeTabId,
      }),
    );
  } catch {
    // Storage quota or private mode is non-fatal.
  }
}

export function openConversationInTabs(
  state: WorkspaceTabsState,
  conversationId: string | null,
  title: string,
  options: { inNewTab?: boolean; model?: string; provider?: string } = {},
): WorkspaceTabsState {
  if (conversationId) {
    const existing = state.tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      return {
        ...state,
        activeTabId: existing.id,
        tabs: state.tabs.map((t) =>
          t.id === existing.id
            ? { ...t, title: title.trim() || t.title, lastActiveAt: Date.now() }
            : t,
        ),
      };
    }
  }

  if (!options.inNewTab) {
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    // Reuse an empty draft tab instead of proliferating blank tabs.
    if (active && active.conversationId === null && !active.draft.trim() && !active.busy && conversationId) {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === active.id
            ? { ...t, conversationId, title: title.trim() || 'Conversation', lastActiveAt: Date.now() }
            : t,
        ),
      };
    }
  }

  const next = createNewTab({
    conversationId,
    title: title.trim() || 'New chat',
    model: options.model,
    provider: options.provider,
  });
  const trimmed = state.tabs.length >= MAX_TABS ? state.tabs.slice(state.tabs.length - MAX_TABS + 1) : state.tabs;
  return {
    ...state,
    tabs: [...trimmed, next],
    activeTabId: next.id,
  };
}

export function closeSessionTab(state: WorkspaceTabsState, tabId: string): WorkspaceTabsState {
  const index = state.tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return state;
  const target = state.tabs[index]!;

  if (state.tabs.length === 1) {
    const fresh = createNewTab();
    return {
      tabs: [fresh],
      activeTabId: fresh.id,
      closedTabs: [target, ...state.closedTabs].slice(0, MAX_CLOSED),
    };
  }

  const nextTabs = state.tabs.filter((t) => t.id !== tabId);
  const nextActive =
    state.activeTabId === tabId
      ? (nextTabs[Math.min(index, nextTabs.length - 1)] ?? nextTabs[0]!).id
      : state.activeTabId;

  return {
    tabs: nextTabs,
    activeTabId: nextActive,
    closedTabs: [target, ...state.closedTabs].slice(0, MAX_CLOSED),
  };
}

export function reopenLastClosedTab(state: WorkspaceTabsState): WorkspaceTabsState {
  if (state.closedTabs.length === 0) return state;
  const [restored, ...rest] = state.closedTabs;
  if (!restored) return state;
  const tab = { ...restored, id: makeTabId(), busy: false, lastActiveAt: Date.now() };
  return {
    tabs: [...state.tabs.slice(-(MAX_TABS - 1)), tab],
    activeTabId: tab.id,
    closedTabs: rest,
  };
}

export function cycleSessionTab(state: WorkspaceTabsState, delta: 1 | -1): WorkspaceTabsState {
  if (state.tabs.length <= 1) return state;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  const nextIdx = (idx + delta + state.tabs.length) % state.tabs.length;
  return {
    ...state,
    activeTabId: state.tabs[nextIdx]!.id,
  };
}

export function updateTabById(
  state: WorkspaceTabsState,
  tabId: string,
  updater: (tab: WorkspaceSessionTab) => WorkspaceSessionTab,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
  };
}

export function updateTabByConversationId(
  state: WorkspaceTabsState,
  conversationId: string,
  updater: (tab: WorkspaceSessionTab) => WorkspaceSessionTab,
): WorkspaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.conversationId === conversationId ? updater(t) : t)),
  };
}
