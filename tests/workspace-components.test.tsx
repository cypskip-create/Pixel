/** @vitest-environment jsdom */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactModeSelector } from '../src/renderer/components/CompactModeSelector';
import { WorkspaceComposer } from '../src/renderer/components/WorkspaceComposer';
import { WorkspaceSidebar } from '../src/renderer/components/WorkspaceSidebar';
import { WorkspaceTaskActivity, WorkspaceTaskDetails } from '../src/renderer/components/WorkspaceTaskActivity';
import { PermissionCard } from '../src/renderer/components/PermissionCard';
import { WorkspaceConversationHeader } from '../src/renderer/components/WorkspaceConversationHeader';
import { MarkdownMessage } from '../src/renderer/components/MarkdownMessage';
import type { ConversationSummary, PermissionRequest, ProjectView, TaskRecord } from '../src/shared/types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

function cleanup(): void {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
}

afterEach(cleanup);

function conversation(id: string, title: string): ConversationSummary {
  return { id, title, createdAt: 1, updatedAt: 2, preview: `Preview ${title}`, persistence: 'persistent' };
}

function task(status: TaskRecord['status'] = 'running'): TaskRecord {
  return {
    id: 'task-1', title: 'Open the settings panel', status, createdAt: 1,
    steps: [{ id: 'step-1', title: 'Find settings control', status: 'running', toolName: 'find_ui_element' }],
    pendingVerifications: status === 'completed' ? [{ stepId: 'step-1', toolName: 'verify_ui_state' }] : [],
  };
}

describe('conversation-first Workspace controls', () => {
  it('keeps the mode trigger compact and opens a keyboard-operable menu only on demand', async () => {
    const onRequestMode = vi.fn();
    const rendered = mount(<CompactModeSelector current="hybrid" onRequestMode={onRequestMode} />);
    const trigger = rendered.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(trigger?.textContent).toContain('Hybrid');
    expect(rendered.querySelector('[role="menu"]')).toBeNull();

    act(() => trigger?.click());
    const menu = rendered.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(rendered.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    expect(rendered.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain('Hybrid');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
    expect(rendered.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    act(() => trigger?.click());
    const guide = rendered.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="false"]');
    act(() => guide?.click());
    expect(onRequestMode).toHaveBeenCalledWith(expect.stringMatching(/^(guide|agent)$/));
  });

  it('dismisses the mode menu after an outside click', () => {
    const rendered = mount(<CompactModeSelector current="guide" onRequestMode={vi.fn()} />);
    act(() => rendered.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click());
    expect(rendered.querySelector('[role="menu"]')).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(rendered.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps browser search in a contextual form and submits the chosen query', () => {
    const onSearchWeb = vi.fn();
    const rendered = mount(<WorkspaceConversationHeader
      title="Search planning" currentMode="guide" onRequestMode={vi.fn()}
      onSearchWeb={onSearchWeb} canSearch hasTaskDetails={false} onOpenTaskDetails={vi.fn()}
    />);
    expect(rendered.querySelector('.pix-mascot')).toBeNull();
    act(() => rendered.querySelector<HTMLButtonElement>('[aria-label="More conversation actions"]')?.click());
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Search the web'))?.click());
    const input = rendered.querySelector<HTMLInputElement>('#workspace-web-search-input');
    act(() => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'weather tomorrow');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => rendered.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSearchWeb).toHaveBeenCalledWith('weather tomorrow');
  });

  it('renders long conversation text and fenced code without truncating either', () => {
    const paragraph = 'A useful answer. '.repeat(80);
    const code = 'const answer = 42;\nconsole.log(answer);';
    const rendered = mount(<MarkdownMessage text={`${paragraph}\n\n\`\`\`ts\n${code}\n\`\`\``} />);
    expect(rendered.querySelector('p')?.textContent).toBe(paragraph);
    expect(rendered.querySelector('pre code')?.textContent).toBe(code);
    expect([...rendered.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === 'Copy code')).toBe(true);
  });

  it('keeps navigation and recent chat actions available in the sidebar', async () => {
    const onViewChange = vi.fn();
    const onOpenConversation = vi.fn();
    const onNewChat = vi.fn();
    const item = conversation('chat-1', 'A saved conversation');
    const project: ProjectView = { id: 'project-1', name: 'Research', description: null, active: true };
    const rendered = mount(
      <WorkspaceSidebar
        view="chat" onViewChange={onViewChange} collapsed={false} onToggleCollapsed={vi.fn()}
        history={[item]} selectedConversationId={item.id} historySearch="" onHistorySearchChange={vi.fn()}
        onOpenConversation={onOpenConversation} onNewChat={onNewChat}
        onRenameConversation={vi.fn(async () => true)} onDeleteConversation={vi.fn(async () => true)}
        currentProject={project} activeTaskCount={0} disabled={false}
      />,
    );

    expect(rendered.querySelector('[aria-label="Workspace navigation"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Pixel sections"]')).toBeNull();

    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('New chat'))?.click());
    expect(onNewChat).toHaveBeenCalledOnce();
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Activity'))?.click());
    expect(onViewChange).toHaveBeenCalledWith('tasks');
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Notes & Planning'))?.click());
    expect(onViewChange).toHaveBeenCalledWith('notes');
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Library'))?.click());
    expect(onViewChange).toHaveBeenCalledWith('library');
    expect(rendered.querySelector('.workspace-history-open[aria-current="page"]')?.textContent).toContain('A saved conversation');
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('A saved conversation'))?.click());
    expect(onOpenConversation).toHaveBeenCalledWith(item.id);
  });

  it('auto-expands the composer, sends on Enter, and keeps Stop reachable while streaming', () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    function Harness({ streaming = false }: { streaming?: boolean }): React.JSX.Element {
      const [draft, setDraft] = useState('');
      return <WorkspaceComposer
        draft={draft} onDraftChange={setDraft} onSubmit={onSubmit} onStop={onStop}
        streaming={streaming} disabled={false} attachments={[]} onAttach={vi.fn()}
        onRemoveAttachment={vi.fn()} onAttachScreenshot={vi.fn()} onToggleListening={vi.fn()}
        listening={false} onNotice={vi.fn()}
      />;
    }
    const rendered = mount(<Harness />);
    const textarea = rendered.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.style.height).toBe('42px');
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 104 });
    act(() => {
      if (!textarea) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'A longer prompt');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea?.style.height).toBe('104px');
    act(() => textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onSubmit).toHaveBeenCalledOnce();

    act(() => root?.render(<Harness streaming />));
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Stop'))?.click());
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('surfaces task progress inline and reports pending verification without claiming completion', () => {
    const active = task();
    const onOpenDetails = vi.fn();
    const rendered = mount(<WorkspaceTaskActivity task={active} onOpenDetails={onOpenDetails} />);
    expect(rendered.textContent).toContain('Working');
    expect(rendered.textContent).toContain('Find settings control');
    act(() => rendered.querySelector<HTMLButtonElement>('button')?.click());
    expect(onOpenDetails).toHaveBeenCalledOnce();

    const completed = task('completed');
    act(() => root?.render(<WorkspaceTaskDetails
      task={completed} onClose={vi.fn()} onOpenTasks={vi.fn()} onPause={vi.fn()}
      onResume={vi.fn()} onCancel={vi.fn()} onContinue={vi.fn()}
    />));
    expect(rendered.textContent).toContain('Awaiting verification');
    expect(rendered.textContent).toContain('has not been confirmed');
    expect(rendered.textContent).not.toContain('Completed');
  });

  it('keeps a pending approval visible and records an explicit denial', () => {
    const request: PermissionRequest = {
      id: 'approval-1', toolName: 'invoke_ui_element', action: 'Activate the Save button',
      target: 'Untitled - Notepad', changesData: true, risk: 'medium', duration: 'once',
      args: { selector: 'Save' }, createdAt: 1,
    };
    const onDecide = vi.fn();
    const rendered = mount(<PermissionCard request={request} onDecide={onDecide} compact />);
    expect(rendered.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(rendered.textContent).toContain('Activate the Save button');
    expect(rendered.textContent).toContain('Untitled - Notepad');
    expect(rendered.textContent).toContain('Allow Once');
    act(() => [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Deny'))?.click());
    expect(onDecide).toHaveBeenCalledWith({ requestId: 'approval-1', approved: false, duration: 'once' });
  });
});
