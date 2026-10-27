import { describe, expect, it } from 'vitest';
import {
  countLine,
  previewAlt,
  previewDescription,
  SHARE_DESCRIPTION,
  tilesFor,
  titleSizeFor,
} from './share-preview';

describe('countLine', () => {
  it('says nothing yet for an empty list', () => {
    expect(countLine(0)).toBe('Nothing on the list yet');
  });

  it('is singular for one item', () => {
    expect(countLine(1)).toBe('1 thing on the list');
  });

  it('is plural from two items', () => {
    expect(countLine(2)).toBe('2 things on the list');
    expect(countLine(12)).toBe('12 things on the list');
  });
});

describe('previewDescription', () => {
  it('has no call to action when the list is empty', () => {
    expect(previewDescription('Sam', 0)).toBe('Nothing on Sam’s list yet.');
  });

  it('adds the fixed share line to a count', () => {
    expect(previewDescription('Sam', 1)).toBe(
      '1 thing on Sam’s list. Pick a gift so nobody doubles up.',
    );
    expect(previewDescription('Sam', 12)).toBe(
      '12 things on Sam’s list. Pick a gift so nobody doubles up.',
    );
    expect(previewDescription('James', 3)).toBe(
      '3 things on James’s list. Pick a gift so nobody doubles up.',
    );
  });

  it('uses the shared description for its second sentence', () => {
    expect(SHARE_DESCRIPTION).toBe('Pick a gift so nobody doubles up.');
    expect(previewDescription('Sam', 5).endsWith(` ${SHARE_DESCRIPTION}`)).toBe(true);
  });
});

describe('previewAlt', () => {
  it('is the title, a colon and the count line', () => {
    expect(previewAlt('Sam’s wishlist', 0)).toBe('Sam’s wishlist: Nothing on the list yet');
    expect(previewAlt('Sam’s wishlist', 1)).toBe('Sam’s wishlist: 1 thing on the list');
    expect(previewAlt('Sam’s wishlist', 12)).toBe('Sam’s wishlist: 12 things on the list');
  });
});

describe('tilesFor', () => {
  it('lays four photos out as a 2×2 grid in reading order', () => {
    expect(tilesFor(4)).toEqual([
      { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
      { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
      { photo: 2, column: 1, row: 2, columnSpan: 1, rowSpan: 1 },
      { photo: 3, column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
    ]);
  });

  it('gives three photos one tall tile and two stacked', () => {
    expect(tilesFor(3)).toEqual([
      { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
      { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
      { photo: 2, column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
    ]);
  });

  it('gives two photos a tall tile each', () => {
    expect(tilesFor(2)).toEqual([
      { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
      { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 2 },
    ]);
  });

  it('fills the grid with one photo', () => {
    expect(tilesFor(1)).toEqual([{ photo: 0, column: 1, row: 1, columnSpan: 2, rowSpan: 2 }]);
  });

  it('has no tiles without photos', () => {
    expect(tilesFor(0)).toEqual([]);
  });

  it('never draws more than four', () => {
    expect(tilesFor(7)).toEqual(tilesFor(4));
  });
});

describe('titleSizeFor', () => {
  it('steps down with the title length beside a grid', () => {
    expect(titleSizeFor('x'.repeat(20), true)).toEqual({ fontSize: 72, lineClamp: 3 });
    expect(titleSizeFor('x'.repeat(21), true)).toEqual({ fontSize: 56, lineClamp: 3 });
    expect(titleSizeFor('x'.repeat(40), true)).toEqual({ fontSize: 56, lineClamp: 3 });
    expect(titleSizeFor('x'.repeat(41), true)).toEqual({ fontSize: 44, lineClamp: 3 });
  });

  it('is 1.25× larger, rounded, when there is no grid', () => {
    expect(titleSizeFor('x'.repeat(20), false)).toEqual({ fontSize: 90, lineClamp: 3 });
    expect(titleSizeFor('x'.repeat(40), false)).toEqual({ fontSize: 70, lineClamp: 3 });
    expect(titleSizeFor('x'.repeat(41), false)).toEqual({ fontSize: 55, lineClamp: 3 });
  });

  it('gives a very long title the smallest size', () => {
    expect(titleSizeFor('x'.repeat(200), true).fontSize).toBe(44);
    expect(titleSizeFor('x'.repeat(200), false).fontSize).toBe(55);
  });

  it('measures in UTF-16 units', () => {
    // Each emoji is two units, so ten of them are 20 and eleven are 22.
    expect(titleSizeFor('🎂'.repeat(10), true).fontSize).toBe(72);
    expect(titleSizeFor('🎂'.repeat(11), true).fontSize).toBe(56);
  });
});
