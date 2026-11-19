import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PixelBoardService } from '../src/main/board/service';
import { createBoard } from '../src/shared/drawingBoard';

const roots: string[] = [];

function makeService(): { service: PixelBoardService; root: string; draft: string } {
  const root = mkdtempSync(join(tmpdir(), 'pixel-board-service-'));
  roots.push(root);
  const draft = join(root, 'active-board.json');
  return { service: new PixelBoardService(draft), root, draft };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('main-process Pixel Board service', () => {
  it('applies validated operations atomically and rejects stale revisions without changing state', () => {
    const { service, draft } = makeService();
    const created = service.create('Notes');
    const text = { id: 'note-1', kind: 'text' as const, points: [{ x: 30, y: 50 }], text: 'Hello', color: '#FFFFFF', width: 4 };
    const updated = service.apply([{ type: 'add', object: text }], created.revision);
    expect(updated.document.objects).toEqual([text]);
    expect(() => service.apply([{ type: 'clear' }], created.revision)).toThrow(/changed since it was loaded/i);
    expect(service.getSnapshot().document.objects).toEqual([text]);
    expect(JSON.parse(readFileSync(draft, 'utf8')).document.objects).toEqual([text]);
  });

  it('makes a complete auto-layout diagram one undoable group and recovers it on redo', () => {
    const { service } = makeService();
    const diagram = service.createDiagram('Network Architecture', ['PC', 'Switch', 'Router', 'Internet'], [
      { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 },
    ]);
    expect(diagram.document.title).toBe('Network Architecture');
    expect(diagram.document.objects).toHaveLength(12);
    expect(diagram.document.objects.filter((item) => item.kind === 'rectangle')).toHaveLength(4);
    expect(diagram.document.objects.filter((item) => item.kind === 'arrow')).toHaveLength(3);
    expect(diagram.document.objects.find((item) => item.kind === 'text')?.text).toContain('Network');
    expect(service.undo().document.objects).toHaveLength(0);
    expect(service.redo().document.objects).toHaveLength(12);
  });

  it('persists the shared draft and verifies editable save/open round trips', () => {
    const { service, draft, root } = makeService();
    service.createDiagram('DNS', ['Client', 'Resolver', 'Root', 'TLD'], [
      { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 },
    ]);
    const savedPath = join(root, 'dns.pixelboard');
    const saved = service.saveToFile(savedPath, 'pixelboard');
    expect(saved.verified).toBe(true);
    expect(() => service.saveToFile(savedPath, 'pixelboard')).toThrow(/already exists/i);

    const restored = new PixelBoardService(join(root, 'restored.json'));
    expect(restored.openFromFile(savedPath).document).toEqual(service.getSnapshot().document);
    expect(new PixelBoardService(draft).getSnapshot().document.objects).toHaveLength(12);
  });

  it('migrates an old renderer draft once without removing the source document', () => {
    const { service } = makeService();
    const legacy = createBoard('Recovered');
    legacy.objects.push({ id: 'old-text', kind: 'text', points: [{ x: 10, y: 40 }], text: 'old local draft', color: '#FFFFFF', width: 4 });
    expect(service.importLegacyDraft(legacy).document).toEqual(legacy);
    const newDraft = createBoard('Do not overwrite');
    expect(service.importLegacyDraft(newDraft).document).toEqual(legacy);
  });

  it('refuses to replace non-empty Board content without an explicit confirmation', () => {
    const { service } = makeService();
    service.apply([{ type: 'add', object: { id: 'shape', kind: 'rectangle', points: [{ x: 20, y: 20 }, { x: 50, y: 50 }], color: '#4299F5', width: 2 } }]);
    expect(() => service.create('new')).toThrow(/contains unsaved work/i);
    expect(service.getSnapshot().document.objects).toHaveLength(1);
    expect(service.create('new', true).document.objects).toHaveLength(0);
  });

  it('creates a new blank named Board after the active drawing is cleared', () => {
    const { service } = makeService();
    service.create('First board');
    service.apply([{ type: 'add', object: { id: 'note', kind: 'text', points: [{ x: 10, y: 20 }], text: 'Work to clear', color: '#FFFFFF', width: 4 } }]);
    service.apply([{ type: 'clear' }]);
    expect(service.create('Second board').document).toMatchObject({ title: 'Second board', objects: [] });
  });

  it('does not publish an in-memory mutation when durable draft replacement fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'pixel-board-readonly-'));
    roots.push(root);
    const path = join(root, 'occupied');
    mkdirSync(path);
    const service = new PixelBoardService(path);
    const object = { id: 'candidate', kind: 'text' as const, points: [{ x: 20, y: 30 }], text: 'transaction', color: '#FFFFFF', width: 4 };
    expect(() => service.apply([{ type: 'add', object }])).toThrow();
    expect(service.getSnapshot()).toMatchObject({ revision: 0, document: { objects: [] }, canUndo: false });
  });
});
