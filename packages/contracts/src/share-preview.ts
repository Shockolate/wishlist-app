import { z } from 'zod';

/** At most this many item ids are offered to the preview image, so it can skip photos that fail (Plan 12). */
export const PREVIEW_CANDIDATES = 8;

/** The preview image draws at most this many photos (Plan 12). */
export const PREVIEW_PHOTOS = 4;

/** The image types a preview photo may be; anything else is refused (Plan 12). */
export const PREVIEW_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PreviewPhotoType = (typeof PREVIEW_PHOTO_TYPES)[number];

/** A preview photo larger than this many bytes is refused (Plan 12). */
export const PREVIEW_PHOTO_MAX_BYTES = 2_097_152;

/**
 * What `GET /shared/:shareToken/preview` answers (Plan 12). It is `.strict()` so nothing else, claim
 * data above all, can ride along: the response is public to anyone holding the share link.
 */
export const SharePreviewResponseSchema = z
  .object({
    title: z.string(),
    ownerDisplayName: z.string(),
    itemCount: z.number().int().nonnegative(),
    photoItemIds: z.array(z.uuid()).max(PREVIEW_CANDIDATES),
  })
  .strict();
export type SharePreviewResponse = z.infer<typeof SharePreviewResponseSchema>;
