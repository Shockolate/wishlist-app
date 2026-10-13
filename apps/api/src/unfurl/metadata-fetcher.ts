import { Logger } from '@nestjs/common';
import type { UnfurlFailureReason, UnfurlResponse } from '@wishlist/contracts';
import { extractMetadata } from './metadata.js';
import { PageFetcher } from './page-fetcher.js';

/** The unfurl port (spec §8): a prefill for a product link. Never throws; a failure has a reason. */
export interface MetadataFetcher {
  fetch(url: string): Promise<UnfurlResponse>;
}

export const METADATA_FETCHER = Symbol('METADATA_FETCHER');

/** The real unfurl: fetch the page under spec §6.8's rules, then read what it says. */
export class HttpMetadataFetcher implements MetadataFetcher {
  private readonly logger = new Logger('Unfurl');

  constructor(private readonly pages: PageFetcher = new PageFetcher()) {}

  async fetch(url: string): Promise<UnfurlResponse> {
    const page = await this.pages.fetch(url);
    // `=== false`, not `!page.ok`: Vercel's builder type-checks without strictNullChecks, where `!ok` doesn't narrow.
    if (page.ok === false) return this.failed(page.reason, page.host);
    const metadata = extractMetadata(page.html, page.url);
    if (!metadata.title && !metadata.imageUrl && !metadata.priceText) {
      return this.failed('NO_METADATA', page.url.hostname);
    }
    return metadata;
  }

  /** Logs the reason and the host only: a path or a query string can carry personal data. */
  private failed(reason: UnfurlFailureReason, host?: string): UnfurlResponse {
    this.logger.log(host ? `unfurl ${reason} host=${host}` : `unfurl ${reason}`);
    return { failureReason: reason };
  }
}
