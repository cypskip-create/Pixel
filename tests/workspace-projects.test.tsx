/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView } from '../src/shared/types';
import { WorkspaceProjects } from '../src/renderer/components/WorkspaceProjects';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function mount(projects: ProjectView[], onSelect = vi.fn()): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(WorkspaceProjects, { projects, draft: 'New space', setDraft: vi.fn(), onSelect })));
  return host;
}

const projects: ProjectView[] = [
  { id: 'active', name: 'Research', description: 'Local research notes', active: true },
  { id: 'work', name: 'Marketing', description: null, active: false },
];

describe('Workspace project browser', () => {
  it('searches actual project names and descriptions and switches layouts accessibly', () => {
    const rendered = mount(projects);
    expect(rendered.querySelectorAll('.workspace-project-card')).toHaveLength(2);
    expect(rendered.querySelector('.workspace-project-card[aria-current="true"] strong')?.textContent).toBe('Research');
    expect(rendered.querySelectorAll('.workspace-folder-art')).toHaveLength(2);

    const search = rendered.querySelector<HTMLInputElement>('[aria-label="Search projects"]');
    act(() => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'local research');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rendered.querySelectorAll('.workspace-project-card')).toHaveLength(1);
    expect(rendered.querySelector('.workspace-project-card strong')?.textContent).toBe('Research');

    act(() => rendered.querySelector<HTMLButtonElement>('[aria-label="List view"]')?.click());
    expect(rendered.querySelector('.workspace-project-grid')?.classList.contains('is-list')).toBe(true);
    expect(rendered.querySelector('[aria-label="List view"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens selected records and submits a project name through the existing switch/create flow', () => {
    const onSelect = vi.fn();
    const rendered = mount(projects, onSelect);
    act(() => [...rendered.querySelectorAll<HTMLButtonElement>('.workspace-project-card')].find((card) => card.textContent?.includes('Marketing'))?.click());
    expect(onSelect).toHaveBeenCalledWith('Marketing');
    act(() => rendered.querySelector<HTMLFormElement>('.workspace-create-project')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSelect).toHaveBeenLastCalledWith('New space');
  });
});
