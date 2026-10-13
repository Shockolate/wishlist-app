import 'server-only';
import { WishlistResponseSchema, type WishlistResponse } from '@wishlist/contracts';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * The owner's list, server to server. Call it only after requireMe has seen a verified email, since
 * the API refuses anyone else. A session lost in between goes to login, as requireMe would.
 */
export async function loadWishlist(returnTo: string): Promise<WishlistResponse> {
  try {
    return await (await serverApi()).get('/wishlist', WishlistResponseSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}
