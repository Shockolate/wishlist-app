import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLLAGE_COLUMNS } from './collage-items';

const publicDir = fileURLToPath(new URL('../../public', import.meta.url));
const items = COLLAGE_COLUMNS.flat();
const photos = items.flatMap((item) => (item.photo ? [item.photo] : []));

describe('collage items', () => {
  it('shows five cards, one of them an idea with no photo', () => {
    expect(items).toHaveLength(5);
    expect(items.filter((item) => item.photo === null && item.shop === null)).toHaveLength(1);
  });

  it('points every photo at a file in public/collage', () => {
    expect(photos).toHaveLength(4);
    for (const photo of photos) {
      expect(photo).toMatch(/^\/collage\/[a-z-]+\.webp$/);
      expect(existsSync(join(publicDir, photo)), photo).toBe(true);
    }
  });

  it('credits every photo: the photographer, the source and the licence', () => {
    const credits = readFileSync(join(publicDir, 'collage', 'CREDITS.md'), 'utf8');
    for (const photo of photos) {
      const entry = credits.split(/^## /m).find((section) => section.startsWith(basename(photo)));
      expect(entry, `${photo} has no entry in CREDITS.md`).toBeDefined();
      expect(entry).toMatch(/https:\/\/(unsplash|www\.pexels)\.com\//);
      expect(entry).toMatch(/Unsplash License|Pexels License/);
    }
  });
});
