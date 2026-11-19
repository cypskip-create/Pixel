import { describe, expect, it } from 'vitest';
import { boardSvg, createBoard, validateBoardDocument } from '../src/shared/drawingBoard';

describe('Pixel Board document boundary', () => {
  it('creates an editable versioned board and round trips supported objects', () => {
    const board = createBoard('Network notes');
    board.objects.push({ id: 'arrow-1', kind: 'arrow', points: [{ x: 10, y: 20 }, { x: 300, y: 200 }], color: '#4299F5', width: 4 });
    const loaded = validateBoardDocument(JSON.parse(JSON.stringify(board)));
    expect(loaded).toEqual(board);
    expect(boardSvg(loaded!)).toContain('<path');
  });

  it('rejects malformed coordinates, unbounded object counts and invalid colors', () => {
    const board = createBoard();
    board.objects = [{ id: 'bad', kind: 'pen', points: [{ x: 1001, y: 10 }], color: '#000000', width: 4 }];
    expect(validateBoardDocument(board)).toBeNull();
    board.objects = Array.from({ length: 501 }, (_, index) => ({ id: String(index), kind: 'text' as const, points: [{ x: 0, y: 0 }], text: 'x', color: '#000000', width: 4 }));
    expect(validateBoardDocument(board)).toBeNull();
    board.objects = [{ id: 'bad', kind: 'text', points: [{ x: 0, y: 0 }], text: 'x', color: 'url(javascript:alert(1))', width: 4 } as never];
    expect(validateBoardDocument(board)).toBeNull();
  });

  it('escapes user text in SVG exports', () => {
    const board = createBoard();
    board.objects = [{ id: 'text-1', kind: 'text', points: [{ x: 10, y: 20 }], text: '<script>alert("x")</script>', color: '#ffffff', width: 4 }];
    const svg = boardSvg(board);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});
