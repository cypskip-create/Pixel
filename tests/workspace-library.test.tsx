/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentLibraryIndexResult, DocumentLibraryItem, DocumentLibraryOpenResult, DocumentLibraryRead } from '../src/shared/types';
import { WorkspaceLibrary } from '../src/renderer/components/WorkspaceLibrary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const documents: DocumentLibraryItem[] = [
  { id: 'doc_1', folderId: 'folder-a', folderName: 'Research', fileName: 'brief.md', title: 'brief', kind: 'markdown', sizeBytes: 900, modifiedAt: 100, indexedAt: 200, chunks: 3 },
  { id: 'doc_2', folderId: 'folder-a', folderName: 'Research', fileName: 'notes.txt', title: 'notes', kind: 'text', sizeBytes: 200, modifiedAt: 120, indexedAt: 210, chunks: 1 },
  { id: 'doc_3', folderId: 'folder-b', folderName: 'Plans', fileName: 'plan.csv', title: 'plan', kind: 'csv', sizeBytes: 1_200, modifiedAt: 130, indexedAt: 220, chunks: 2 },
];

function mount(onRead = vi.fn(async (): Promise<DocumentLibraryRead> => ({
  state: 'ready', title: 'brief', kind: 'markdown', startChunk: 0, chunkCount: 1, hasMore: false,
  passages: [{ ordinal: 0, content: 'User-indexed document content.', location: 'chars 0-34' }],
})), onIndexFolder = vi.fn(async (): Promise<DocumentLibraryIndexResult> => ({ ok: true, content: 'Indexed 2 documents.' })), onOpen = vi.fn(async (): Promise<DocumentLibraryOpenResult> => ({ ok: true, content: 'Windows accepted an open request.' })), onOpenFolder = vi.fn(async (): Promise<DocumentLibraryOpenResult> => ({ ok: true, content: 'Windows accepted a folder open request.' }))) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(WorkspaceLibrary, { documents, loading: false, onRefresh: vi.fn(), onIndexFolder, onRead, onOpen, onOpenFolder })));
  return { rendered: host, onRead, onIndexFolder, onOpen, onOpenFolder };
}

describe('Workspace Library', () => {
  it('shows real indexed folder groups and browses their file rows', () => {
    const { rendered } = mount();
    expect(rendered.querySelectorAll('.workspace-library-folder')).toHaveLength(2);
    expect(rendered.querySelector('.workspace-library-folder-copy strong')?.textContent).toBe('Plans');

    act(() => [...rendered.querySelectorAll<HTMLButtonElement>('.workspace-library-folder')].find((button) => button.textContent?.includes('Research'))?.click());
    expect(rendered.querySelector('h1')?.textContent).toBe('Research');
    expect(rendered.querySelectorAll('.workspace-library-row')).toHaveLength(2);
    expect(rendered.textContent).toContain('brief.md');
    expect(rendered.textContent).toContain('notes.txt');
  });

  it('filters indexed folder and file views by the actual document type', () => {
    const { rendered } = mount();
    const filter = rendered.querySelector<HTMLSelectElement>('[aria-label="Filter by file type"]');
    expect(filter).not.toBeNull();
    act(() => {
      if (!filter) return;
      filter.value = 'csv';
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(rendered.querySelectorAll('.workspace-library-folder')).toHaveLength(1);
    expect(rendered.querySelector('.workspace-library-folder-copy strong')?.textContent).toBe('Plans');
    expect(rendered.querySelectorAll('.workspace-library-row')).toHaveLength(1);
    expect(rendered.querySelector('.workspace-library-row')?.textContent).toContain('plan.csv');
    expect(rendered.textContent).not.toContain('brief.md');
  });

  it('offers an accessible real-folder action from the folder menu', async () => {
    const onOpenFolder = vi.fn(async () => ({ ok: true, content: 'Windows accepted an open request for the indexed folder.' }));
    const { rendered } = mount(undefined, undefined, undefined, onOpenFolder);
    const folderItem = [...rendered.querySelectorAll<HTMLElement>('.workspace-library-folder-item')]
      .find((item) => item.querySelector('.workspace-library-folder-copy strong')?.textContent === 'Research');
    const action = folderItem?.querySelector<HTMLButtonElement>('.workspace-library-folder-menu-popover button');
    expect(action?.textContent).toBe('Open in File Explorer');
    await act(async () => {
      action?.click();
      await Promise.resolve();
    });
    expect(onOpenFolder).toHaveBeenCalledWith('folder-a');
    expect(rendered.querySelector('[role="status"]')?.textContent).toContain('indexed folder');
  });

  it('loads a bounded untrusted-content preview for the selected indexed file', async () => {
    const onRead = vi.fn(async (): Promise<DocumentLibraryRead> => ({
      state: 'ready', title: 'brief', kind: 'markdown', startChunk: 0, chunkCount: 1, hasMore: false,
      passages: [{ ordinal: 0, content: 'User-indexed document content.', location: 'chars 0-34' }],
    }));
    const { rendered } = mount(onRead);
    act(() => [...rendered.querySelectorAll<HTMLButtonElement>('.workspace-library-folder')].find((button) => button.textContent?.includes('Research'))?.click());
    await act(async () => {
      rendered.querySelector<HTMLButtonElement>('.workspace-library-row')?.click();
      await Promise.resolve();
    });
    expect(onRead).toHaveBeenCalledWith('doc_1', 0);
    expect(rendered.textContent).toContain('untrusted document content');
    expect(rendered.textContent).toContain('User-indexed document content.');
  });

  it('opens the verified original only after an explicit user click', async () => {
    const onOpen = vi.fn(async () => ({ ok: true, content: 'Windows accepted an open request for the verified Library source.' }));
    const { rendered } = mount(undefined, undefined, onOpen);
    act(() => [...rendered.querySelectorAll<HTMLButtonElement>('.workspace-library-folder')].find((button) => button.textContent?.includes('Research'))?.click());
    await act(async () => {
      rendered.querySelector<HTMLButtonElement>('.workspace-library-row')?.click();
      await Promise.resolve();
    });
    expect(rendered.querySelector('.workspace-library-open')).not.toBeNull();
    await act(async () => {
      rendered.querySelector<HTMLButtonElement>('.workspace-library-open')?.click();
      await Promise.resolve();
    });
    expect(onOpen).toHaveBeenCalledWith('doc_1');
    expect(rendered.querySelector('[role="status"]')?.textContent).toContain('verified Library source');
  });

  it('keeps an empty project honest and explains how indexed data appears', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(WorkspaceLibrary, { documents: [], loading: false, onRefresh: vi.fn(), onIndexFolder: vi.fn(async () => ({ ok: true, content: '' })), onRead: vi.fn(), onOpen: vi.fn(async () => ({ ok: false, content: '' })), onOpenFolder: vi.fn(async () => ({ ok: false, content: '' })) })));
    expect(host.querySelector('.workspace-library-empty strong')?.textContent).toBe('No indexed documents yet');
    expect(host.querySelector('.workspace-library-add')?.textContent).toContain('Add folder');
  });

  it('invokes the explicit folder-index flow and reports its real result', async () => {
    const onIndexFolder = vi.fn(async () => ({ ok: true, indexed: 2, skipped: 1, failed: 0, documents: 2, chunks: 4, content: 'Indexed 2 documents; 1 unchanged, 0 failed.' }));
    const { rendered } = mount(undefined, onIndexFolder);
    await act(async () => {
      rendered.querySelector<HTMLButtonElement>('.workspace-library-add')?.click();
      await Promise.resolve();
    });
    expect(onIndexFolder).toHaveBeenCalledOnce();
    expect(rendered.querySelector('.workspace-library-result')?.textContent).toContain('Indexed 2 documents');
  });
});
