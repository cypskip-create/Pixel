/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecentChatsPanel } from '../src/renderer/components/RecentChatsPanel';
import { BridgeContext } from '../src/renderer/hooks/useBridge';
import type { BridgeStatus } from '../src/renderer/lib/bridge';
import type { ConversationRecordView, ConversationSummary, CypsBridge } from '../src/shared/types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function summary(id: string, title: string, daysAgo = 0): ConversationSummary {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return { id, title, createdAt: date.getTime(), updatedAt: date.getTime(), preview: `Preview ${title}`, persistence: 'persistent' };
}

function setup(items: ConversationSummary[] = [summary('today', 'Today chat'), summary('yesterday', 'Yesterday chat', 1), summary('older', 'Older chat', 12)]) {
  const history = {
    list: vi.fn(async () => items),
    open: vi.fn(async (id: string) => {
      const selected = items.find((entry) => entry.id === id);
      return selected ? { ...selected, messages: [] } as ConversationRecordView : null;
    }),
    create: vi.fn(async () => ({ ...summary('new', 'New conversation'), messages: [] } as ConversationRecordView)),
    rename: vi.fn(async (id: string, title: string) => ({ ...items.find((entry) => entry.id === id)!, title })),
    delete: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
  };
  const bridge = { history } as unknown as CypsBridge;
  const status: BridgeStatus = { kind: 'ready', bridge };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onOpen = vi.fn(async () => true);
  const onNew = vi.fn(async () => true);
  act(() => root?.render(
    <BridgeContext.Provider value={status}>
      <RecentChatsPanel selectedId="today" onOpen={onOpen} onNew={onNew} onClose={vi.fn()} />
    </BridgeContext.Provider>,
  ));
  return { history, onOpen, onNew, host };
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
}

function cleanup(): void {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

afterEach(cleanup);

describe('Recent Chats panel', () => {
  it('groups recent conversations and marks the selected chat', async () => {
    const { host: rendered } = setup();
    await settle();
    expect(rendered.querySelector('[aria-label="Today"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Yesterday"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Older"]')).not.toBeNull();
    expect(rendered.textContent).toContain('Preview Today chat');
    expect(rendered.querySelector('.ring-1')).not.toBeNull();
  });

  it('opens the selected conversation and starts a new chat', async () => {
    const { host: rendered, onOpen, onNew } = setup();
    await settle();
    const target = [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Yesterday chat'));
    await act(async () => { target?.click(); await Promise.resolve(); });
    expect(onOpen).toHaveBeenCalledWith('yesterday');
    const newButton = [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('New Chat'));
    await act(async () => { newButton?.click(); await Promise.resolve(); });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('renames a conversation through the main-owned history API', async () => {
    const { host: rendered, history } = setup();
    await settle();
    act(() => rendered.querySelector<HTMLButtonElement>('[aria-label="Rename Today chat"]')?.click());
    const input = rendered.querySelector<HTMLInputElement>('[aria-label="Conversation title"]');
    expect(input).not.toBeNull();
    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'Renamed');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      rendered.querySelector<HTMLButtonElement>('[aria-label="Save conversation title"]')?.click();
      await Promise.resolve();
    });
    expect(history.rename).toHaveBeenCalledWith('today', 'Renamed');
  });

  it('requires confirmation and supports cancelling a delete', async () => {
    const { host: rendered, history } = setup();
    await settle();
    act(() => rendered.querySelector<HTMLButtonElement>('[aria-label="Delete Today chat"]')?.click());
    expect(rendered.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')?.click());
    expect(history.delete).not.toHaveBeenCalled();
    expect(rendered.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('deletes only after confirmation and refreshes the active chat', async () => {
    const { host: rendered, history, onNew } = setup();
    await settle();
    act(() => rendered.querySelector<HTMLButtonElement>('[aria-label="Delete Today chat"]')?.click());
    await act(async () => {
      const confirm = [...rendered.querySelectorAll('button')].find((button) => button.textContent === 'Delete');
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(history.delete).toHaveBeenCalledWith('today');
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('confirms clearing chat history before invoking the bridge', async () => {
    const { host: rendered, history, onNew } = setup();
    await settle();
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent === 'Clear History')?.click());
    expect(history.clear).not.toHaveBeenCalled();
    await act(async () => {
      const confirm = [...(rendered.querySelector('[role="alertdialog"]')?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent === 'Clear History');
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(history.clear).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
