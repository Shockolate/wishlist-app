import 'server-only';
import {
  CAPABILITY_TOKEN_PATTERN,
  ClaimDetailsResponseSchema,
  ErrorCode,
  SharedWishlistResponseSchema,
  type ClaimDetailsResponse,
  type SharedWishlistResponse,
} from '@wishlist/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ApiError } from './api-client';
import { serverApi } from './api.server';
import { hasCode } from './messages';

/**
 * No such list or claim: any 404, and the router's 400 for an undecodable escape (Plan 4a's ruling
 * on Task 3). Anything else is a real failure, for error.tsx.
 */
function isDeadLink(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

/**
 * The list behind a share link, as this visitor may see it (spec §5.1). The cookie is forwarded,
 * so the API knows the owner. One call per request: the page and its metadata share it.
 */
export const loadSharedList = cache(async (shareToken: string): Promise<SharedWishlistResponse> => {
  // A token that can't be one never reaches the API (Plan 4b rule 10).
  if (!CAPABILITY_TOKEN_PATTERN.test(shareToken)) notFound();
  try {
    return await (await serverApi()).get(`/shared/${shareToken}`, SharedWishlistResponseSchema);
  } catch (error) {
    if (isDeadLink(error)) notFound();
    throw error;
  }
});

/**
 * A claim, by its manage link (spec §5): the claimer's own view. The list's own signed-in owner is
 * refused with `403 OWN_LIST_CLAIM` and gets no claim data (D82), which is `own-list` here.
 */
export const loadClaim = cache(
  async (
    manageToken: string,
  ): Promise<{ kind: 'claim'; details: ClaimDetailsResponse } | { kind: 'own-list' }> => {
    if (!CAPABILITY_TOKEN_PATTERN.test(manageToken)) notFound();
    try {
      const details = await (
        await serverApi()
      ).get(`/claims/${manageToken}`, ClaimDetailsResponseSchema);
      return { kind: 'claim', details };
    } catch (error) {
      if (hasCode(error, ErrorCode.OWN_LIST_CLAIM)) return { kind: 'own-list' };
      if (isDeadLink(error)) notFound();
      throw error;
    }
  },
);
