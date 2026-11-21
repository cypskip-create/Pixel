/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskRecord } from '../src/shared/types';
import { WorkspaceTasks } from '../src/renderer/components/WorkspaceTasks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const completed: TaskRecord = {
  id: 'task_done', title: 'Read a public page', status: 'completed', projectId: 'project_a',
  steps: [{ id: 'step_1', title: 'Navigate', status: 'verified', toolName: 'browser_navigate' }],
  createdAt: 1, endedAt: 2,
};

function render(tasks: TaskRecord[], onRecord: (id: string) => void): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<WorkspaceTasks tasks={tasks} audit={[]} onAction={vi.fn()} onContinue={vi.fn()} onRecord={onRecord} />));
  return host;
}

describe('Workspace task recording control', () => {
  it('offers a draft action only for completed tasks without pending verification', () => {
    const onRecord = vi.fn();
    const pending: TaskRecord = { ...completed, id: 'task_pending', reobserveRequired: true };
    const rendered = render([completed, { ...completed, id: 'failed', status: 'failed' }, pending], onRecord);
    const buttons = [...rendered.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent?.includes('Save steps'));
    expect(buttons).toHaveLength(1);
    act(() => buttons[0]?.click());
    expect(onRecord).toHaveBeenCalledWith('task_done');
  });

  it('does not offer recording for completed tasks with no recorded steps', () => {
    const rendered = render([{ ...completed, steps: [] }], vi.fn());
    expect(rendered.textContent).not.toContain('Save steps as a skill draft');
  });
});
