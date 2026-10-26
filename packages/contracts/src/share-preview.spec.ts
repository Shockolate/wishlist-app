import { describe, expect, it } from 'vitest';
import { ErrorCode } from './error-codes.js';
import {
  PREVIEW_CANDIDATES,
  PREVIEW_PHOTO_MAX_BYTES,
  PREVIEW_PHOTO_TYPES,
  PREVIEW_PHOTOS,
  SharePreviewResponseSchema,
} from './share-preview.js';

const ID = '0199a3b2-0000-7000-8000-000000000001';

const preview = {
  title: 'Sam’s wishlist',
  ownerDisplayName: 'Sam',
  itemCount: 12,
  photoItemIds: [ID],
};

describe('limits (share preview design)', () => {
  it('are 8 candidates, 4 photos, three image types and 2 MiB', () => {
    expect(PREVIEW_CANDIDATES).toBe(8);
    expect(PREVIEW_PHOTOS).toBe(4);
    expect(PREVIEW_PHOTO_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(PREVIEW_PHOTO_MAX_BYTES).toBe(2_097_152);
  });
});

describe('SharePreviewResponseSchema', () => {
  it('parses a preview', () => {
    expect(SharePreviewResponseSchema.parse(preview)).toEqual(preview);
  });

  it('takes a list with no photos', () => {
    const bare = { ...preview, itemCount: 0, photoItemIds: [] };
    expect(SharePreviewResponseSchema.parse(bare)).toEqual(bare);
  });

  it("refuses any extra field, so claim data can't ride along", () => {
    expect(SharePreviewResponseSchema.safeParse({ ...preview, claims: [] }).success).toBe(false);
  });

  it('accepts exactly PREVIEW_CANDIDATES ids', () => {
    const photoItemIds = Array.from({ length: PREVIEW_CANDIDATES }, () => ID);
    expect(SharePreviewResponseSchema.safeParse({ ...preview, photoItemIds }).success).toBe(true);
  });

  it.each([
    [
      'more than PREVIEW_CANDIDATES ids',
      { photoItemIds: Array.from({ length: PREVIEW_CANDIDATES + 1 }, () => ID) },
    ],
    ['a negative count', { itemCount: -1 }],
    ['a fractional count', { itemCount: 1.5 }],
    ['an id that is not a uuid', { photoItemIds: ['not-a-uuid'] }],
  ])('refuses %s', (_name, change) => {
    expect(SharePreviewResponseSchema.safeParse({ ...preview, ...change }).success).toBe(false);
  });
});

describe('ErrorCode', () => {
  it('PHOTO_UNAVAILABLE is a stable code', () => {
    expect(ErrorCode.PHOTO_UNAVAILABLE).toBe('PHOTO_UNAVAILABLE');
  });
});
