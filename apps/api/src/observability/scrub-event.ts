import type { ErrorEvent } from '@sentry/node';
import { redactDeep } from '@wishlist/contracts';

/**
 * Sentry's beforeSend (spec §6.7). The request keeps only its URL, the user goes, and every string
 * left is redacted, so a token or an address can't ride in on a field nobody listed.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const { user: _user, request, ...rest } = event;
  const kept: ErrorEvent = { ...rest };
  if (request?.url) kept.request = { url: request.url };
  return redactDeep(kept);
}
