import 'server-only';
import { MeResponseSchema, type MeResponse } from '@wishlist/contracts';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { serverApi } from './api.server';

/**
 * The signed-in user, or a redirect to login that comes back here. The API decides; the proxy
 * only saw a cookie, which may be stale (spec §6.1, Plan 2b rule 8).
 */
export async function requireMe(returnTo: string): Promise<MeResponse> {
  try {
    return await (await serverApi()).get('/me', MeResponseSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}
