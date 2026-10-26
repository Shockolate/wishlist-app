import { PREVIEW_PHOTO_MAX_BYTES } from '@wishlist/contracts';
import { PUBLIC_HTTPS } from './address-policy.js';
import { PageFetcher, type FetchedPhoto } from './page-fetcher.js';

/** One photo's deadline, every hop included. The web's 3-second budget for all photos covers it. */
export const PHOTO_FETCH_TIMEOUT_MS = 2_500;

/** The share preview photo port (Plan 12). Never throws; a failure has a reason. */
export interface PhotoFetcher {
  fetch(url: string): Promise<FetchedPhoto>;
}

export const PHOTO_FETCHER = Symbol('PHOTO_FETCHER');

/**
 * The real photo fetch, under spec §6.8's rules as unfurl's: public addresses on port 443 only
 * (`PUBLIC_HTTPS`), https on every hop, and at most PREVIEW_PHOTO_MAX_BYTES both as sent and once
 * decoded.
 */
export class HttpPhotoFetcher implements PhotoFetcher {
  constructor(
    private readonly pages: PageFetcher = new PageFetcher({
      policy: PUBLIC_HTTPS,
      timeoutMs: PHOTO_FETCH_TIMEOUT_MS,
      maxBytes: PREVIEW_PHOTO_MAX_BYTES,
      maxRawBytes: PREVIEW_PHOTO_MAX_BYTES,
    }),
  ) {}

  fetch(url: string): Promise<FetchedPhoto> {
    return this.pages.fetchImage(url);
  }
}
