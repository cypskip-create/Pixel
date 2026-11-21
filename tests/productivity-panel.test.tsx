/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CypsBridge, ProductivityNoteView, ProductivityTaskView } from '../src/shared/types';
import type { BridgeStatus } from '../src/renderer/lib/bridge';
import { BridgeContext } from '../src/renderer/hooks/useBridge';
import { ProductivityPanel } from '../src/renderer/components/ProductivityPanel';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | null = null; let host: HTMLDivElement | null = null;
function mount(bridge: BridgeStatus): HTMLDivElement { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root?.render(<BridgeContext.Provider value={bridge}><ProductivityPanel /></BridgeContext.Provider>)); return host; }
function cleanup(): void { if (root) act(() => root?.unmount()); root = null; host?.remove(); host = null; }
afterEach(cleanup);

describe('project productivity UI', () => {
  it('creates a persistent note through the typed bridge and opens it in the editor', async () => {
    let notes: ProductivityNoteView[] = []; const tasks: ProductivityTaskView[] = [];
    const api = {
      productivity: {
        listNotes: async () => notes,
        createNote: async (title: string, body: string) => { const note = { id: 'note_12345678', projectId: 'project-a', title, body, createdAt: 1, updatedAt: 1 }; notes = [note, ...notes]; return note; },
        updateNote: async (id: string, patch: { title?: string; body?: string }) => { const old = notes.find((note) => note.id === id); if (!old) return null; const updated = { ...old, ...patch, updatedAt: 2 }; notes = notes.map((note) => note.id === id ? updated : note); return updated; },
        deleteNote: async (id: string) => { notes = notes.filter((note) => note.id !== id); return true; },
        importMarkdown: async () => { const note = { id: 'note_imported', projectId: 'project-a', title: 'Imported', body: 'Imported body', createdAt: 2, updatedAt: 2 }; notes = [note, ...notes]; return note; },
        exportMarkdown: async () => ({ ok: true, verified: true }),
        listTasks: async () => tasks,
        listChecklists: async () => [],
        createTask: async (title: string, description = '') => ({ id: 'ptask_12345678', projectId: 'project-a', title, description, status: 'open' as const, dueAt: null, createdAt: 1, updatedAt: 1 }),
        updateTask: async () => null,
      },
    } as unknown as CypsBridge;
    const rendered = mount({ kind: 'ready', bridge: api });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(rendered.textContent).toContain('No notes in this project yet.');
    const newNoteButton = [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('New note'));
    await act(async () => { newNoteButton?.click(); await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(notes).toHaveLength(1);
    expect(rendered.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe('Untitled note');
    expect(rendered.textContent).toContain('Edit note');
  });

  it('routes Markdown import through the main-process bridge and opens the imported note', async () => {
    let imported = 0;
    const api = { productivity: {
      listNotes: async () => imported ? [{ id: 'note_imported', projectId: 'project-a', title: 'Imported', body: 'Imported body', createdAt: 2, updatedAt: 2 }] : [],
      createNote: async () => { throw new Error('unused'); }, updateNote: async () => null, deleteNote: async () => false,
      importMarkdown: async () => { imported++; return { id: 'note_imported', projectId: 'project-a', title: 'Imported', body: 'Imported body', createdAt: 2, updatedAt: 2 }; },
      exportMarkdown: async () => ({ ok: true, verified: true }), listTasks: async () => [], listChecklists: async () => [], createTask: async () => { throw new Error('unused'); }, updateTask: async () => null,
    } } as unknown as CypsBridge;
    const rendered = mount({ kind: 'ready', bridge: api });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    const importButton = [...rendered.querySelectorAll('button')].find((button) => button.textContent?.includes('Import .md'));
    await act(async () => { importButton?.click(); await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(imported).toBe(1);
    expect(rendered.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value).toBe('Imported');
  });

  it('creates tasks with descriptions and due dates through the typed bridge', async () => {
    let received: { title: string; description: string; dueAt?: string } | null = null;
    const api = { productivity: {
      listNotes: async () => [], createNote: async () => { throw new Error('unused'); }, updateNote: async () => null, deleteNote: async () => false,
      importMarkdown: async () => null, exportMarkdown: async () => ({ ok: true }), listTasks: async () => [], listChecklists: async () => [],
      createTask: async (title: string, description = '', dueAt?: string) => { received = { title, description, dueAt }; return { id: 'ptask_12345678', projectId: 'project-a', title, description, status: 'open' as const, dueAt: dueAt ? Date.parse(dueAt) : null, createdAt: 1, updatedAt: 1 }; },
      updateTask: async () => null,
    } } as unknown as CypsBridge;
    const rendered = mount({ kind: 'ready', bridge: api });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    const setValue = (selector: string, value: string): void => {
      const input = rendered.querySelector<HTMLInputElement>(selector);
      if (!input) throw new Error(`Missing ${selector}`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
    };
    setValue('[aria-label="New project task"]', 'Review design');
    setValue('[aria-label="New task description"]', 'Check the screenshots');
    setValue('[aria-label="New task due date"]', '2026-11-30T09:00');
    await act(async () => { rendered.querySelector<HTMLButtonElement>('[aria-label="Create task"]')?.click(); await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(received).toEqual({ title: 'Review design', description: 'Check the screenshots', dueAt: new Date('2026-11-30T09:00').toISOString() });
  });
});
