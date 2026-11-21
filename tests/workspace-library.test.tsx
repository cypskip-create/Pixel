/** @vitest-environment jsdom */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentLibraryItem, DocumentLibraryRead } from '../src/shared/types';
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
}))) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(WorkspaceLibrary, { documents, loading: false, onRefresh: vi.fn(), onRead })));
  return { rendered: host, onRead };
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

  it('keeps an empty project honest and explains how indexed data appears', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(WorkspaceLibrary, { documents: [], loading: false, onRefresh: vi.fn(), onRead: vi.fn() })));
    expect(host.querySelector('.workspace-library-empty strong')?.textContent).toBe('No indexed documents yet');
    expect(host.textContent).toContain('Ask Pixel to index a folder you choose');
  });
});
