// The words and layout rules of a share link's preview (Plan 12). Pure, so the image route and the
// page's metadata say the same thing, and the rules can be tested without rendering anything.

/** A share link's preview line. Fixed, so it's true whether or not the owner sees claims. */
export const SHARE_DESCRIPTION = 'Pick a gift so nobody doubles up.';

/** How many photos the image draws. */
const MAX_TILES = 4;

/** "12 things on the list". `itemCount` counts items, never quantities. */
export function countLine(itemCount: number): string {
  if (itemCount === 0) return 'Nothing on the list yet';
  return `${itemCount} ${itemCount === 1 ? 'thing' : 'things'} on the list`;
}

/** The page's `description`. An empty list has nothing to pick from, so no call to action. */
export function previewDescription(ownerDisplayName: string, itemCount: number): string {
  if (itemCount === 0) return `Nothing on ${ownerDisplayName}’s list yet.`;
  const things = itemCount === 1 ? 'thing' : 'things';
  return `${itemCount} ${things} on ${ownerDisplayName}’s list. ${SHARE_DESCRIPTION}`;
}

/** The image's alt text: the list's title, then the count line. */
export function previewAlt(title: string, itemCount: number): string {
  return `${title}: ${countLine(itemCount)}`;
}

/**
 * The title's size steps down with its length, in UTF-16 units (`string.length`), so a long title
 * never overflows. Every size is clamped to three lines with an ellipsis, but only a title past 40
 * units can reach the clamp. With no photo grid the title has the whole width, so each step is
 * 1.25× larger.
 */
export function titleSizeFor(
  title: string,
  hasGrid: boolean,
): { fontSize: number; lineClamp: number } {
  const size = title.length <= 20 ? 72 : title.length <= 40 ? 56 : 44;
  return { fontSize: hasGrid ? size : Math.round(size * 1.25), lineClamp: 3 };
}

/** One photo's place on the 2×2 grid. `photo` indexes the photos array; placement is CSS-grid. */
export type Tile = { photo: number; column: 1 | 2; row: 1 | 2; columnSpan: 1 | 2; rowSpan: 1 | 2 };

/** Where each photo goes, so the grid is always square and full: 1 fills it, 2 split it, 3 and 4 tile it. */
export function tilesFor(photoCount: number): Tile[] {
  switch (Math.min(photoCount, MAX_TILES)) {
    case 1:
      return [{ photo: 0, column: 1, row: 1, columnSpan: 2, rowSpan: 2 }];
    case 2:
      return [
        { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
        { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 2 },
      ];
    case 3:
      return [
        { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 2 },
        { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
        { photo: 2, column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
      ];
    case 4:
      return [
        { photo: 0, column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
        { photo: 1, column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
        { photo: 2, column: 1, row: 2, columnSpan: 1, rowSpan: 1 },
        { photo: 3, column: 2, row: 2, columnSpan: 1, rowSpan: 1 },
      ];
    default:
      return [];
  }
}
