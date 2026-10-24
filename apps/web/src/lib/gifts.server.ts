import 'server-only';
import { GiftsResponseSchema, type GiftsResponse } from '@wishlist/contracts';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * The signed-in gifter's claims and the notes about ones that went, server to server. Call it only
 * after requireMe has seen a verified email, since the API refuses anyone else. A session lost in
 * between goes to login, as requireMe would.
 */
export async function loadGifts(returnTo: string): Promise<GiftsResponse> {
  try {
    return await (await serverApi()).get('/me/gifts', GiftsResponseSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}
