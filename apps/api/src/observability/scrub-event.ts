import type { ErrorEvent } from '@sentry/node';
import { redactDeep } from '@wishlist/contracts';

/**
 * Sentry's beforeSend (spec §6.7). The request keeps only its URL, the user goes, and every string
 * left is redacted, so a token or an address can't ride in on a field nobody listed.
 *
 * Two things redaction can't catch are cut first. drizzle-orm puts every bound parameter after
 * "\nparams: " in a failed query's message, and a hash or a name isn't a token or an email; the
 * cause chain and unhandled rejections reach here with that message intact. And the SDK files a
 * thrown non-Error object's fields under extra.__serialized__.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  const { user: _user, request, ...rest } = event;
  const kept: ErrorEvent = { ...rest };
  if (request?.url) kept.request = { url: request.url };
  if (kept.exception?.values) {
    kept.exception = {
      ...kept.exception,
      values: kept.exception.values.map((entry) =>
        entry.value === undefined
          ? entry
          : { ...entry, value: entry.value.replace(/\nparams: [\s\S]*$/, '') },
      ),
    };
  }
  if (kept.extra) {
    const { __serialized__: _serialized, ...extra } = kept.extra;
    kept.extra = extra;
  }
  return redactDeep(kept);
}
