// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type DocumentLibraryItem,
  type DocumentLibraryRead,
} from '@shared/types';
import {
  closeSessionTab,
  createInitialTabsState,
  cycleSessionTab,
  openConversationInTabs,
  reopenLastClosedTab,
  updateTabByConversationId,
  updateTabById,
} from '../src/renderer/lib/workspaceTabs';
import {
  clampRightRailWidth,
  clampSplitRatio,
  mergePaneLayout,
} from '../src/renderer/lib/workspaceLayout';
import { CommandPalette, type PaletteCommand } from '../src/renderer/components/CommandPalette';
import { ModelPickerPopover } from '../src/renderer/components/ModelPickerPopover';
import {
  WorkspaceRightRail,
  groupDocumentsByFolder,
} from '../src/renderer/components/WorkspaceRightRail';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

function mount(node: React.ReactElement): HTMLDivElement {
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(node);
  });
  return mountedContainer;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

afterEach(() => {
  if (mountedRoot !== null) act(() => mountedRoot?.unmount());
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.restoreAllMocks();
});

describe('Hermes Stage 3: Workspace Tabs, Split Panes, Right Rail, Command Palette & Model Picker', () => {
  it('isolates drafts, scroll positions, and background busy state across session tabs', () => {
    let state = createInitialTabsState('conv-1', 'Alpha');
    const tab1Id = state.activeTabId;
    state = updateTabById(state, tab1Id, (t) => ({ ...t, draft: 'Draft for Alpha', scrollTop: 320 }));

    state = openConversationInTabs(state, 'conv-2', 'Beta', { inNewTab: true });
    const tab2Id = state.activeTabId;
    expect(state.tabs).toHaveLength(2);
    expect(tab2Id).not.toBe(tab1Id);

    state = updateTabByConversationId(state, 'conv-1', (t) => ({ ...t, busy: true }));
    expect(state.activeTabId).toBe(tab2Id);
    expect(state.tabs.find((t) => t.id === tab1Id)?.busy).toBe(true);
    expect(state.tabs.find((t) => t.id === tab1Id)?.draft).toBe('Draft for Alpha');
    expect(state.tabs.find((t) => t.id === tab1Id)?.scrollTop).toBe(320);
    expect(state.tabs.find((t) => t.id === tab2Id)?.busy).toBe(false);

    const cycled = cycleSessionTab(state, 1);
    expect(cycled.activeTabId).toBe(tab1Id);

    const closed = closeSessionTab(state, tab2Id);
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeTabId).toBe(tab1Id);

    const reopened = reopenLastClosedTab(closed);
    expect(reopened.tabs).toHaveLength(2);
    expect(reopened.tabs[1]?.conversationId).toBe('conv-2');
  });

  it('clamps and persists split-pane ratios and right-rail widths safely', () => {
    expect(clampSplitRatio(0.05)).toBe(0.3);
    expect(clampSplitRatio(0.95)).toBe(0.7);
    expect(clampRightRailWidth(100)).toBe(260);
    expect(clampRightRailWidth(999)).toBe(560);

    const merged = mergePaneLayout({
      splitEnabled: true,
      splitRatio: 0.62,
      rightRailOpen: true,
      rightRailWidth: 420,
      rightRailTab: 'terminal',
      secondaryConversationId: 'conv-side',
    });
    expect(merged).toMatchObject({
      splitEnabled: true,
      splitRatio: 0.62,
      rightRailOpen: true,
      rightRailWidth: 420,
      rightRailTab: 'terminal',
      secondaryConversationId: 'conv-side',
    });
  });

  it('filters commands and executes keyboard selection in CommandPalette', () => {
    const onSplit = vi.fn();
    const onSettings = vi.fn();
    const onClose = vi.fn();
    const commands: PaletteCommand[] = [
      { id: 'split', group: 'Workspace', label: 'Split workspace pane', shortcut: 'Ctrl+\\', onSelect: onSplit },
      { id: 'settings', group: 'Navigation', label: 'Open Settings', onSelect: onSettings },
    ];

    const container = mount(createElement(CommandPalette, { open: true, commands, onClose }));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search commands"]')!;
    setInputValue(input, 'settings');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onSplit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches providers, models, and reasoning effort in ModelPickerPopover', () => {
    const onSelectModel = vi.fn();
    const onSelectEffort = vi.fn();

    const container = mount(
      createElement(ModelPickerPopover, {
        providerSettings: DEFAULT_SETTINGS.provider,
        hasApiKey: true,
        onSelectModel,
        onSelectEffort,
      }),
    );

    const pill = container.querySelector<HTMLButtonElement>('button.workspace-model-pill')!;
    act(() => { pill.click(); });

    const effortButtons = [...container.querySelectorAll<HTMLButtonElement>('button.workspace-effort-pill')];
    const lowBtn = effortButtons.find((b) => b.textContent === 'low')!;
    act(() => { lowBtn.click(); });
    expect(onSelectEffort).toHaveBeenCalledWith('low');

    const filter = container.querySelector<HTMLInputElement>('input[aria-label="Filter models"]')!;
    setInputValue(filter, 'claude-sonnet-4-20250514');
    const option = container.querySelector<HTMLButtonElement>('button[role="option"]')!;
    act(() => { option.click(); });
    expect(onSelectModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-20250514');
  });

  it('renders project-scoped file tree, opens file previews, and dispatches permission-gated terminal commands', async () => {
    const docs: DocumentLibraryItem[] = [
      {
        id: 'doc-1',
        folderId: 'f1',
        folderName: 'Pixel Repo',
        fileName: 'README.md',
        title: 'README',
        kind: 'markdown',
        sizeBytes: 120,
        modifiedAt: 1,
        indexedAt: 1,
        chunks: 1,
      },
      {
        id: 'doc-2',
        folderId: 'f1',
        folderName: 'Pixel Repo',
        fileName: 'src/app.ts',
        title: 'app.ts',
        kind: 'code',
        sizeBytes: 240,
        modifiedAt: 2,
        indexedAt: 2,
        chunks: 1,
      },
    ];

    expect(groupDocumentsByFolder(docs, 'app.ts')).toHaveLength(1);

    const onSelectTab = vi.fn();
    const onReadDocument = vi.fn(async (): Promise<DocumentLibraryRead | null> => ({
      state: 'ready',
      title: 'app.ts',
      kind: 'code',
      startChunk: 0,
      chunkCount: 1,
      hasMore: false,
      passages: [{ ordinal: 0, content: 'export const ok = true;', location: 'L1' }],
    }));
    const onRunTerminalCommand = vi.fn(async (cmd: string) => `Dispatched: ${cmd}`);

    const baseProps = {
      width: 360,
      projectName: 'Pixel Repo',
      documents: docs,
      documentsLoading: false,
      onSelectTab,
      onClose: vi.fn(),
      onRefreshDocuments: vi.fn(),
      onIndexFolder: vi.fn(),
      onReadDocument,
      onOpenExternal: vi.fn(async () => undefined),
      onRunTerminalCommand,
      onStopTerminal: vi.fn(),
      terminalBusy: false,
      tasks: [],
      audit: [],
    };

    const container = mount(createElement(WorkspaceRightRail, { ...baseProps, activeTab: 'files' }));
    const fileButtons = [...container.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]')];
    const appBtn = fileButtons.find((b) => b.textContent?.includes('src/app.ts'))!;
    await act(async () => {
      appBtn.click();
    });
    expect(onReadDocument).toHaveBeenCalledWith('doc-2');
    expect(onSelectTab).toHaveBeenCalledWith('preview');

    act(() => {
      mountedRoot!.render(createElement(WorkspaceRightRail, { ...baseProps, activeTab: 'terminal' }));
    });

    const termInput = container.querySelector<HTMLInputElement>('input[aria-label="Terminal command"]')!;
    setInputValue(termInput, 'git status');
    const form = termInput.closest('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onRunTerminalCommand).toHaveBeenCalledWith('git status');
  });
});
