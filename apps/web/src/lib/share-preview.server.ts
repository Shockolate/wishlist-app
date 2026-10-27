import 'server-only';
import {
  CAPABILITY_TOKEN_PATTERN,
  PREVIEW_PHOTOS,
  SharePreviewResponseSchema,
  type SharePreviewResponse,
} from '@wishlist/contracts';
import { notFound } from 'next/navigation';
import { ApiError, createApiClient } from './api-client';
import { preparePhoto } from './share-preview-image';

/** How long the image waits for all of its photos together (design §5.1). */
export const PHOTO_BUDGET_MS = 3_000;

function apiOrigin(): string {
  const origin = process.env.API_ORIGIN;
  if (!origin) throw new Error('API_ORIGIN is not configured');
  return origin;
}

/**
 * What a share link's preview image draws (Plan 12 ruling 2). Always asked as a guest: no cookie
 * is forwarded, never `serverApi()`, so nothing the owner or a signed-in gifter could see reaches
 * the image (design §5.4). A dead link is `notFound()`, as on the share page; any other failure
 * throws, so it's reported (ruling 10).
 */
export async function loadPreview(shareToken: string): Promise<SharePreviewResponse> {
  // A token that can't be one never reaches the API (Plan 4b rule 10).
  if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) notFound();
  try {
    return await createApiClient({ baseUrl: apiOrigin(), headers: {} }).get(
      `/shared/${shareToken}/preview`,
      SharePreviewResponseSchema,
    );
  } catch (error) {
    // Any 404, and the router's 400 for an undecodable escape, as loadSharedList.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
}

/**
 * The photos for a preview, ready to draw: the first `PREVIEW_PHOTOS` of `itemIds` whose photo
 * arrives and decodes within the budget, in `itemIds` order, not arrival order (ruling 3). Every
 * ID is asked for at once, from the API, which alone fetches from shops (design §5.1). A photo
 * that fails in any way is skipped; this never throws for one (design §5.6).
 */
export async function loadPreviewPhotos(
  shareToken: string,
  itemIds: string[],
  options: { budgetMs?: number; fetchFn?: typeof fetch } = {},
): Promise<Buffer[]> {
  const { budgetMs = PHOTO_BUDGET_MS, fetchFn = fetch } = options;
  const origin = apiOrigin();
  // One deadline for all of them. `done` cancels the requests still running once the photos to
  // draw are known.
  const done = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(budgetMs), done.signal]);
  // Settles with null at the deadline, so a request that ignores its signal can't hold the image.
  const deadline = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null);
    signal.addEventListener('abort', () => resolve(null), { once: true });
  });

  async function photo(itemId: string): Promise<Buffer | null> {
    try {
      const res = await fetchFn(`${origin}/api/shared/${shareToken}/photos/${itemId}`, {
        signal,
        cache: 'no-store',
        // The API never redirects; something in front of it answering instead isn't a photo.
        redirect: 'manual',
      });
      if (res.status !== 200) return null;
      return await preparePhoto(new Uint8Array(await res.arrayBuffer()));
    } catch {
      return null;
    }
  }

  const pending = itemIds.map((itemId) => Promise.race([photo(itemId), deadline]));
  const photos: Buffer[] = [];
  try {
    // In list order, so a fast photo never jumps the queue, and it stops waiting as soon as the
    // first PREVIEW_PHOTOS in that order are known.
    for (const next of pending) {
      const prepared = await next;
      if (prepared) photos.push(prepared);
      if (photos.length === PREVIEW_PHOTOS) break;
    }
  } finally {
    done.abort();
  }
  return photos;
}
