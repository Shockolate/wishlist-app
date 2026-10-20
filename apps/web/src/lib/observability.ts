import type { BrowserOptions, ErrorEvent } from '@sentry/browser';
import { redactDeep } from '@wishlist/contracts';

/**
 * Everything the SDK would collect on its own, switched off (spec §6.7). v11's defaults collect
 * cookies, headers, bodies and stack-frame variables. Node and the browser share the type.
 */
export const DATA_COLLECTION_OFF = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  frameContextLines: 0,
} satisfies NonNullable<BrowserOptions['dataCollection']>;

/**
 * Sentry's beforeSend, in the browser and on the web server (spec §6.7). The request keeps only
 * its URL, the user goes, and every string left is redacted, so a token or an address can't ride
 * in on a field nobody listed.
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

/** The origin browsers post reports to, for connect-src (D51). Only an https DSN counts. */
export function sentryIngestOrigin(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * error.tsx reports what it catches, except an error with a digest: that one came from a server
 * render, which onRequestError already reported, and its message is a placeholder.
 */
export function shouldReportBoundaryError(error: { digest?: string }): boolean {
  return !error.digest;
}
