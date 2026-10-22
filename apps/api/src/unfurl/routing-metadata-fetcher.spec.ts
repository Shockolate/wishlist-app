import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  FakeAmazonLookup,
  FakeErrorReporter,
  FakeEtsyLookup,
  FakeMetadataFetcher,
} from '../testing/fakes.js';
import type { AmazonLookup, LookupResult } from './amazon-lookup.js';
import type { EtsyLookup } from './etsy-lookup.js';
import type { ResolvedLink } from './page-fetcher.js';
import {
  AMAZON_DEADLINE_MS,
  ETSY_DEADLINE_MS,
  RoutingMetadataFetcher,
} from './routing-metadata-fetcher.js';

const PRODUCT = 'https://www.amazon.com/Cephalofair-Games-Frosthaven/dp/B08FK7B2SC/ref=x?tag=y';
const SHORT = 'https://amzn.to/3xYz';
const LISTING = 'https://www.etsy.com/uk/listing/1234567890/hand-thrown-mug?ref=hp_rv';
const ETSY_SHORT = 'https://etsy.me/3AbCdEf';

/** A stand-in for PageFetcher.resolve: answers `next`, records what it was asked. */
class FakeLinks {
  next: ResolvedLink = { ok: false, reason: 'NO_METADATA' };
  readonly urls: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];

  resolve(rawUrl: string, _stopAt: (url: URL) => boolean, signal?: AbortSignal) {
    this.urls.push(rawUrl);
    this.signals.push(signal);
    return Promise.resolve(this.next);
  }
}

let pages: FakeMetadataFetcher;
let links: FakeLinks;
let amazon: FakeAmazonLookup;
let etsy: FakeEtsyLookup;
let reporter: FakeErrorReporter;
let log: MockInstance;

beforeEach(() => {
  pages = new FakeMetadataFetcher();
  pages.next = { title: 'From the page' };
  links = new FakeLinks();
  amazon = new FakeAmazonLookup();
  etsy = new FakeEtsyLookup();
  reporter = new FakeErrorReporter();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

const router = (
  lookups: { amazon?: AmazonLookup | null; etsy?: EtsyLookup | null } = {},
  deadlines: { amazon?: number; etsy?: number } = {},
) =>
  new RoutingMetadataFetcher(pages, links, { amazon, etsy, ...lookups }, reporter, {
    amazon: AMAZON_DEADLINE_MS,
    etsy: ETSY_DEADLINE_MS,
    ...deadlines,
  });
const found: LookupResult = { ok: true, metadata: { title: 'Cephalofair Games: Frosthaven' } };

describe('RoutingMetadataFetcher (retailer lookups §5.1–§5.4)', () => {
  it('sends Amazon links to the page fetch while the key is unset (dark)', async () => {
    expect(await router({ amazon: null }).fetch(PRODUCT)).toEqual({ title: 'From the page' });
    expect(pages.urls).toEqual([PRODUCT]);
  });

  it.each([
    'https://shop.example/kettle',
    'https://www.amazon.com/s?k=frosthaven',
    'https://www.etsy.com/shop/Maker',
  ])('sends %s to the page fetch', async (url) => {
    expect(await router().fetch(url)).toEqual({ title: 'From the page' });
    expect(amazon.asins).toEqual([]);
    expect(etsy.listingIds).toEqual([]);
    expect(links.urls).toEqual([]);
  });

  it('looks up an Amazon product by its ASIN alone', async () => {
    amazon.next = found;
    expect(await router().fetch(PRODUCT)).toEqual({ title: 'Cephalofair Games: Frosthaven' });
    expect(amazon.asins).toEqual(['B08FK7B2SC']);
    expect(pages.urls).toEqual([]);
  });

  it('follows a short link to its product, then looks it up', async () => {
    amazon.next = found;
    links.next = { ok: true, url: new URL('https://www.amazon.com/dp/B0CB96ZFL8?ref=x') };
    expect(await router().fetch(SHORT)).toEqual({ title: 'Cephalofair Games: Frosthaven' });
    expect(links.urls).toEqual([SHORT]);
    expect(links.signals[0]).toBeInstanceOf(AbortSignal);
    expect(amazon.asins).toEqual(['B0CB96ZFL8']);
  });

  it('never looks up a short link that went astray (Review Focus 4)', async () => {
    links.next = { ok: false, reason: 'DISALLOWED_ADDRESS', host: 'amzn.to' };
    expect(await router().fetch(SHORT)).toEqual({ failureReason: 'DISALLOWED_ADDRESS' });
    expect(amazon.asins).toEqual([]);
  });

  it.each(['NO_METADATA', 'TIMEOUT'] as const)('passes on %s', async (reason) => {
    amazon.next = { ok: false, reason };
    expect(await router().fetch(PRODUCT)).toEqual({ failureReason: reason });
    expect(reporter.warnings).toEqual([]);
  });

  it('reports a misconfiguration once, without the link or the ASIN', async () => {
    amazon.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 401, misconfigured: true };
    expect(await router().fetch(PRODUCT)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
    expect(reporter.warnings).toHaveLength(1);
    const message = reporter.warnings[0]?.message ?? '';
    expect(message).toContain('401');
    expect(message).not.toContain('amazon.com/');
    expect(message).not.toContain('B08FK7B2SC');
  });

  it('only logs an expected outage, with the host, provider and status', async () => {
    amazon.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 503, misconfigured: false };
    expect(await router().fetch(PRODUCT)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
    expect(reporter.warnings).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      'unfurl LOOKUP_UNAVAILABLE host=www.amazon.com provider=amazon status=503',
    );
  });

  it('logs nothing on success', async () => {
    amazon.next = found;
    await router().fetch(PRODUCT);
    expect(log).not.toHaveBeenCalled();
  });

  it('gives up at the deadline (Review Focus 5)', async () => {
    const hanging: AmazonLookup = {
      lookUp: (_asin, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ ok: false, reason: 'TIMEOUT' })),
        ),
    };
    const started = Date.now();
    expect(await router({ amazon: hanging }, { amazon: 50 }).fetch(PRODUCT)).toEqual({
      failureReason: 'TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  describe('Etsy (retailer lookups §5.3)', () => {
    const listing: LookupResult = { ok: true, metadata: { title: 'Hand-thrown mug' } };

    it('sends Etsy links to the page fetch while the key is unset (dark)', async () => {
      expect(await router({ etsy: null }).fetch(LISTING)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([LISTING]);
    });

    it('looks up an Etsy listing by its ID alone', async () => {
      etsy.next = listing;
      expect(await router().fetch(LISTING)).toEqual({ title: 'Hand-thrown mug' });
      expect(etsy.listingIds).toEqual(['1234567890']);
      expect(amazon.asins).toEqual([]);
      expect(pages.urls).toEqual([]);
    });

    it('follows an etsy.me link to its listing, then looks it up', async () => {
      etsy.next = listing;
      links.next = {
        ok: true,
        url: new URL('https://www.etsy.com/listing/1234567890/mug?ref=share'),
      };
      expect(await router().fetch(ETSY_SHORT)).toEqual({ title: 'Hand-thrown mug' });
      expect(links.urls).toEqual([ETSY_SHORT]);
      expect(etsy.listingIds).toEqual(['1234567890']);
    });

    it('never looks up an etsy.me link that went astray (Review Focus 5)', async () => {
      links.next = { ok: true, url: new URL('https://www.etsy.com/shop/Maker') };
      expect(await router().fetch(ETSY_SHORT)).toEqual({ failureReason: 'NO_METADATA' });
      links.next = { ok: false, reason: 'DISALLOWED_ADDRESS', host: 'etsy.me' };
      expect(await router().fetch(ETSY_SHORT)).toEqual({ failureReason: 'DISALLOWED_ADDRESS' });
      expect(etsy.listingIds).toEqual([]);
      expect(pages.urls).toEqual([]);
    });

    it('reports a refused Etsy key without the link or the ID', async () => {
      etsy.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 403, misconfigured: true };
      expect(await router().fetch(LISTING)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
      expect(reporter.warnings.map((w) => w.message)).toEqual([
        'Etsy refused a listing lookup with status 403',
      ]);
      const logged = log.mock.calls.flat().join(' ');
      expect(logged).not.toContain('1234567890');
      expect(logged).not.toContain('hand-thrown-mug');
    });

    it('only logs an Etsy outage, with provider=etsy', async () => {
      etsy.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 429, misconfigured: false };
      expect(await router().fetch(LISTING)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
      expect(reporter.warnings).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        'unfurl LOOKUP_UNAVAILABLE host=www.etsy.com provider=etsy status=429',
      );
    });

    it('gives an Etsy lookup its own deadline', async () => {
      const hanging: EtsyLookup = {
        lookUp: (_id, signal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => resolve({ ok: false, reason: 'TIMEOUT' })),
          ),
      };
      const started = Date.now();
      const fetching = router({ etsy: hanging }, { amazon: 30_000, etsy: 20 }).fetch(LISTING);
      expect(await fetching).toEqual({ failureReason: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('allows Etsy 5 seconds', () => {
      expect(ETSY_DEADLINE_MS).toBe(5_000);
    });
  });
});
