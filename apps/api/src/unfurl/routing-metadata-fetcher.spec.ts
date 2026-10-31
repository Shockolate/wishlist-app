import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  FakeAmazonLookup,
  FakeEbayLookup,
  FakeErrorReporter,
  FakeEtsyLookup,
  FakeMetadataFetcher,
} from '../testing/fakes.js';
import type { AmazonLookup } from './amazon-lookup.js';
import type { EbayLookup } from './ebay-lookup.js';
import type { EtsyLookup } from './etsy-lookup.js';
import type { LookupResult } from './lookup-result.js';
import type { ResolvedLink } from './page-fetcher.js';
import {
  AMAZON_DEADLINE_MS,
  EBAY_DEADLINE_MS,
  ETSY_DEADLINE_MS,
  RoutingMetadataFetcher,
} from './routing-metadata-fetcher.js';

const PRODUCT = 'https://www.amazon.com/Cephalofair-Games-Frosthaven/dp/B08FK7B2SC/ref=x?tag=y';
const SHORT = 'https://amzn.to/3xYz';
const LISTING = 'https://www.etsy.com/uk/listing/1234567890/hand-thrown-mug?ref=hp_rv';
const ETSY_SHORT = 'https://etsy.me/3AbCdEf';
const EBAY_ITEM =
  'https://www.ebay.com/itm/Valve-Steam-Deck-OLED/960110182451?_skw=steam+deck&hash=item34b9597609%3Ag%3AuOMAAOSwLjtninPj&itmprp=enc%3AAQALAAAA';
const EBAY_OPTION = 'https://www.ebay.com/itm/226447947273?var=525635725002&itmmeta=01M69CBD2C7T';

/** A stand-in for PageFetcher.resolve: answers `next`, records what it was asked. */
class FakeLinks {
  next: ResolvedLink = { ok: false, reason: 'NO_METADATA' };
  readonly urls: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  readonly stopAts: ((url: URL) => boolean)[] = [];

  resolve(rawUrl: string, stopAt: (url: URL) => boolean, signal?: AbortSignal) {
    this.urls.push(rawUrl);
    this.signals.push(signal);
    this.stopAts.push(stopAt);
    return Promise.resolve(this.next);
  }
}

let pages: FakeMetadataFetcher;
let links: FakeLinks;
let amazon: FakeAmazonLookup;
let etsy: FakeEtsyLookup;
let ebay: FakeEbayLookup;
let reporter: FakeErrorReporter;
let log: MockInstance;

beforeEach(() => {
  pages = new FakeMetadataFetcher();
  pages.next = { title: 'From the page' };
  links = new FakeLinks();
  amazon = new FakeAmazonLookup();
  etsy = new FakeEtsyLookup();
  ebay = new FakeEbayLookup();
  reporter = new FakeErrorReporter();
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
});

const router = (
  lookups: {
    amazon?: AmazonLookup | null;
    etsy?: EtsyLookup | null;
    ebay?: EbayLookup | null;
  } = {},
  deadlines: { amazon?: number; etsy?: number; ebay?: number } = {},
) =>
  new RoutingMetadataFetcher(pages, links, { amazon, etsy, ebay, ...lookups }, reporter, {
    amazon: AMAZON_DEADLINE_MS,
    etsy: ETSY_DEADLINE_MS,
    ebay: EBAY_DEADLINE_MS,
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

  it('passes an Amazon description through to the response (Plan 9)', async () => {
    amazon.next = {
      ok: true,
      metadata: { title: 'Kettle', description: 'Home & Kitchen > Kettles. Pour-over kettle.' },
    };
    expect(await router().fetch(PRODUCT)).toEqual({
      title: 'Kettle',
      description: 'Home & Kitchen > Kettles. Pour-over kettle.',
    });
  });

  it('follows a short link to its product, then looks it up', async () => {
    amazon.next = found;
    links.next = { ok: true, url: new URL('https://www.amazon.com/dp/B0CB96ZFL8?ref=x') };
    expect(await router().fetch(SHORT)).toEqual({ title: 'Cephalofair Games: Frosthaven' });
    expect(links.urls).toEqual([SHORT]);
    expect(links.signals[0]).toBeInstanceOf(AbortSignal);
    expect(amazon.asins).toEqual(['B0CB96ZFL8']);
    // The hop stops at an Amazon product link, so that page is never requested.
    const stopAt = links.stopAts[0];
    expect(stopAt?.(new URL('https://www.amazon.com/dp/B0CB96ZFL8'))).toBe(true);
    expect(stopAt?.(new URL('https://www.etsy.com/listing/1234567890'))).toBe(false);
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
      // The hop stops at the listing link, so Etsy's listing page (behind DataDome) is never requested.
      const stopAt = links.stopAts[0];
      expect(stopAt?.(new URL('https://www.etsy.com/listing/1234567890/mug'))).toBe(true);
      expect(stopAt?.(new URL('https://www.amazon.com/dp/B08FK7B2SC'))).toBe(false);
      expect(stopAt?.(new URL('https://www.etsy.com/shop/Maker'))).toBe(false);
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

  describe('eBay (eBay lookups §5.2)', () => {
    it('sends eBay links to the page fetch while the keys are unset (dark)', async () => {
      expect(await router({ ebay: null }).fetch(EBAY_ITEM)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([EBAY_ITEM]);
    });

    it('looks up an eBay item by its number alone, not the rest of the link', async () => {
      ebay.next = found;
      expect(await router().fetch(EBAY_ITEM)).toEqual({ title: 'Cephalofair Games: Frosthaven' });
      expect(ebay.refs).toEqual(['960110182451']);
      expect(pages.urls).toEqual([]);
    });

    it('sends the option number too when the link names one (Review Focus 2)', async () => {
      ebay.next = found;
      await router().fetch(EBAY_OPTION);
      expect(ebay.refs).toEqual(['226447947273:525635725002']);
    });

    it.each([
      'https://www.ebay.com/sch/i.html?_nkw=steam+deck',
      'https://www.ebay.co.uk/itm/960110182451',
      'https://ebay.us/abc123',
      'https://www.ebay.com/itm/0960110182451',
    ])('sends %s to the page fetch, and follows nothing', async (url) => {
      expect(await router().fetch(url)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([url]);
      expect(ebay.refs).toEqual([]);
      expect(links.urls).toEqual([]);
    });

    it('reports a refused eBay lookup without the link, the item number or a key', async () => {
      ebay.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 403, misconfigured: true };
      expect(await router().fetch(EBAY_ITEM)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
      expect(reporter.warnings.map((w) => w.message)).toEqual([
        'eBay refused a lookup with status 403',
      ]);
      const logged = log.mock.calls.flat().join(' ');
      expect(logged).not.toContain('960110182451');
      expect(logged).not.toContain('Valve-Steam-Deck');
    });

    it('only logs an eBay outage, with provider=ebay', async () => {
      ebay.next = { ok: false, reason: 'LOOKUP_UNAVAILABLE', status: 429, misconfigured: false };
      expect(await router().fetch(EBAY_ITEM)).toEqual({ failureReason: 'LOOKUP_UNAVAILABLE' });
      expect(reporter.warnings).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        'unfurl LOOKUP_UNAVAILABLE host=www.ebay.com provider=ebay status=429',
      );
    });

    it('gives an eBay lookup its own deadline', async () => {
      const hanging: EbayLookup = {
        lookUp: (_ref, signal) =>
          new Promise((resolve) =>
            signal.addEventListener('abort', () => resolve({ ok: false, reason: 'TIMEOUT' })),
          ),
      };
      const started = Date.now();
      const fetching = router({ ebay: hanging }, { amazon: 30_000, ebay: 20 }).fetch(EBAY_ITEM);
      expect(await fetching).toEqual({ failureReason: 'TIMEOUT' });
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('allows eBay 5 seconds', () => {
      expect(EBAY_DEADLINE_MS).toBe(5_000);
    });
  });

  describe('never returns a description from eBay (tag suggestions D74, eBay lookups D111)', () => {
    const page = { title: 'From the page', description: 'eBay page description' };

    it.each([
      ['an item while the keys are unset', EBAY_ITEM, { ebay: null }],
      ['a search page', 'https://www.ebay.com/sch/i.html?_nkw=steam+deck', {}],
      ['a category page', 'https://www.ebay.com/b/Board-Games/180349', {}],
    ] as const)('drops it from the page fetch of %s', async (_name, url, lookups) => {
      pages.next = page;
      expect(await router(lookups).fetch(url)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([url]);
    });

    it('drops it even if the eBay lookup returned one', async () => {
      ebay.next = { ok: true, metadata: { title: 'Steam Deck', description: 'Seller text.' } };
      expect(await router().fetch(EBAY_ITEM)).toEqual({ title: 'Steam Deck' });
    });

    it.each([
      'https://notebay.com/itm/960110182451',
      'https://www.ebay.com.evil.test/itm/960110182451',
    ])('keeps it for a lookalike host, %s', async (url) => {
      pages.next = page;
      expect(await router().fetch(url)).toEqual(page);
    });
  });

  describe('never returns a description from Etsy (tag suggestions D74)', () => {
    const page = { title: 'From the page', description: 'Etsy page description' };

    it('drops it from the page fetch of a listing while the key is unset', async () => {
      pages.next = page;
      expect(await router({ etsy: null }).fetch(LISTING)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([LISTING]);
    });

    it.each([
      ['an Etsy shop page', 'https://www.etsy.com/shop/x', {}],
      ['an Etsy subdomain', 'https://help.etsy.com/hc/en-us', {}],
      ['an etsy.me link while the key is unset', ETSY_SHORT, { etsy: null }],
    ] as const)('drops it from the page fetch of %s', async (_name, url, lookups) => {
      pages.next = page;
      expect(await router(lookups).fetch(url)).toEqual({ title: 'From the page' });
      expect(pages.urls).toEqual([url]);
    });

    it('drops it even if the Etsy lookup returned one', async () => {
      etsy.next = { ok: true, metadata: { title: 'Hand-thrown mug', description: 'Glazed.' } };
      expect(await router().fetch(LISTING)).toEqual({ title: 'Hand-thrown mug' });
    });

    it.each(['https://notetsy.com/mug', 'https://www.etsy.com.evil.test/listing/1234567890'])(
      'keeps it for a lookalike host, %s',
      async (url) => {
        pages.next = page;
        expect(await router().fetch(url)).toEqual(page);
      },
    );
  });
});
