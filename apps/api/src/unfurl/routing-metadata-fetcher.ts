import { Logger } from '@nestjs/common';
import {
  amazonProductOf,
  isAmazonShortLink,
  type UnfurlFailureReason,
  type UnfurlResponse,
} from '@wishlist/contracts';
import type { ErrorReporter } from '../observability/error-reporter.js';
import type { AmazonLookup } from './amazon-lookup.js';
import type { MetadataFetcher } from './metadata-fetcher.js';
import type { PageFetcher } from './page-fetcher.js';

/** One Amazon lookup, short-link hops included: the waiting panel promises half a minute. */
export const AMAZON_DEADLINE_MS = 30_000;

/**
 * Unfurl's front door (retailer lookups §5.1–§5.4). An amazon.com product link, or a short link
 * that leads to one, is looked up through `amazon`, sending only its ASIN. Every other link, and
 * every Amazon link while `amazon` is null (no key), takes the page fetch exactly as before.
 * Never throws; like the page fetch, it logs a failure's host and reason, never the URL.
 */
export class RoutingMetadataFetcher implements MetadataFetcher {
  private readonly logger = new Logger('Unfurl');

  constructor(
    private readonly pages: MetadataFetcher,
    private readonly links: Pick<PageFetcher, 'resolve'>,
    private readonly amazon: AmazonLookup | null,
    private readonly reporter: ErrorReporter,
    private readonly deadlineMs: number = AMAZON_DEADLINE_MS,
  ) {}

  async fetch(url: string): Promise<UnfurlResponse> {
    const product = amazonProductOf(url);
    if (!this.amazon || !(product || isAmazonShortLink(url))) return this.pages.fetch(url);
    const host = new URL(url).hostname;
    const deadline = AbortSignal.timeout(this.deadlineMs);

    let asin = product?.asin;
    if (!asin) {
      const resolved = await this.links.resolve(
        url,
        (hop) => amazonProductOf(hop) !== null,
        deadline,
      );
      if (resolved.ok === false) return this.failed(resolved.reason, resolved.host ?? host);
      asin = amazonProductOf(resolved.url)?.asin;
      if (!asin) return this.failed('NO_METADATA', host);
    }

    const result = await this.amazon.lookUp(asin, deadline);
    // `=== true`, not truthiness: Vercel's builder type-checks without strictNullChecks (see metadata-fetcher.ts).
    if (result.ok === true) return result.metadata;
    if (result.reason !== 'LOOKUP_UNAVAILABLE') return this.failed(result.reason, host);
    if (result.misconfigured) {
      // An operator has to act: the key, the account or the dataset is wrong. No URL, no ASIN.
      this.reporter.captureWarning(
        `Bright Data refused an Amazon lookup with status ${result.status ?? 'none'}`,
      );
    }
    this.logger.log(
      `unfurl LOOKUP_UNAVAILABLE host=${host} provider=amazon status=${result.status ?? 'none'}`,
    );
    return { failureReason: 'LOOKUP_UNAVAILABLE' };
  }

  private failed(reason: UnfurlFailureReason, host: string): UnfurlResponse {
    this.logger.log(`unfurl ${reason} host=${host}`);
    return { failureReason: reason };
  }
}
