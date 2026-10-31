import { describe, expect, it } from 'vitest';
import { EbayBrowseLookup, ebayRef, parseEbayRef } from './ebay-lookup.js';

const CLIENT_ID = 'app-id';
const CLIENT_SECRET = 'cert-id';
const ITEM_ID = '366025273219';
const VARIATION_ID = '525635725002';
const IMAGE = 'https://i.ebayimg.com/images/g/V~QAAeSw4cVpKcSg/s-l1600.jpg';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const ITEM_URL = 'https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id';
const GROUP_URL = 'https://api.ebay.com/buy/browse/v1/item/get_items_by_item_group';

/** A fixed-price listing, as the spike saw it (eBay lookups §3). */
const ITEM = {
  itemId: 'v1|366025273219|0',
  title: 'Frosthaven Board Game Cephalofair Games',
  shortDescription: 'Seller-written text that must never travel on.',
  image: { imageUrl: IMAGE },
  price: { value: '230.00', currency: 'USD' },
  buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }],
};
/** The live auction from the spike: `price` is the current bid. */
const AUCTION = {
  ...ITEM,
  price: { value: '567.00', currency: 'USD' },
  currentBidPrice: { value: '567.00', currency: 'USD' },
  buyingOptions: ['AUCTION'],
};
const PRIMED = {
  title: ITEM.title,
  imageUrl: IMAGE,
  priceText: '$230.00',
};

const OPTION_A = { ...ITEM, title: 'iPhone 14', price: { value: '287.99', currency: 'USD' } };
const OPTION_B = {
  ...OPTION_A,
  image: { imageUrl: 'https://i.ebayimg.com/images/g/B/s-l1600.jpg' },
};
const GROUP_SAME = { items: [OPTION_A, OPTION_A] };
const GROUP_DIFFERENT = {
  items: [OPTION_A, { ...OPTION_B, price: { value: '289.99', currency: 'USD' } }],
};

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errors = (status: number, errorId: number) =>
  json({ errors: [{ errorId, message: 'x' }] }, status);
const token: Route = () => json({ access_token: 'tok', expires_in: 7200 });

/** A stub `fetch` that answers by endpoint and records every call. */
function fakeFetch(routes: { token?: Route; item?: Route; group?: Route }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = ((input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push({ url, init });
    const route = url.href.startsWith(TOKEN_URL)
      ? (routes.token ?? token)
      : url.href.startsWith(ITEM_URL)
        ? routes.item
        : url.href.startsWith(GROUP_URL)
          ? routes.group
          : undefined;
    if (!route) throw new Error(`unexpected call to ${input}`);
    return Promise.resolve().then(() => route(url, init));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const live = () => new AbortController().signal;
const lookUp = (routes: Parameters<typeof fakeFetch>[0], ref = ITEM_ID, signal = live()) => {
  const stub = fakeFetch(routes);
  return new EbayBrowseLookup(CLIENT_ID, CLIENT_SECRET, stub.fn)
    .lookUp(ref, signal)
    .then((result) => ({ result, calls: stub.calls }));
};
const unavailable = (status: number, misconfigured: boolean) => ({
  ok: false,
  reason: 'LOOKUP_UNAVAILABLE',
  status,
  misconfigured,
});
const noMetadata = { ok: false, reason: 'NO_METADATA' };

describe('ebayRef and parseEbayRef', () => {
  it('round-trip with and without an option number', () => {
    expect(ebayRef({ itemId: ITEM_ID })).toBe(ITEM_ID);
    expect(ebayRef({ itemId: ITEM_ID, variationId: VARIATION_ID })).toBe(
      `${ITEM_ID}:${VARIATION_ID}`,
    );
    expect(parseEbayRef(ITEM_ID)).toEqual({ itemId: ITEM_ID });
    expect(parseEbayRef(`${ITEM_ID}:${VARIATION_ID}`)).toEqual({
      itemId: ITEM_ID,
      variationId: VARIATION_ID,
    });
  });
});

describe('EbayBrowseLookup (eBay lookups §5.2)', () => {
  it('asks for a token with Basic auth and the api_scope, then for the item with a Bearer token and the US marketplace', async () => {
    const { result, calls } = await lookUp({ item: () => json(ITEM) });
    expect(result).toEqual({ ok: true, metadata: PRIMED });
    expect(calls).toHaveLength(2);

    const [tokenCall, itemCall] = calls;
    expect(tokenCall?.url.href).toBe(TOKEN_URL);
    expect(tokenCall?.init.method).toBe('POST');
    expect(tokenCall?.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(Object.fromEntries(new URLSearchParams(tokenCall?.init.body as string))).toEqual({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    });

    expect(itemCall?.url.href).toBe(`${ITEM_URL}?legacy_item_id=${ITEM_ID}`);
    expect(itemCall?.init.headers).toMatchObject({
      authorization: 'Bearer tok',
      'x-ebay-c-marketplace-id': 'EBAY_US',
    });
  });

  it('sends legacy_variation_id when the reference carries an option number', async () => {
    const { result, calls } = await lookUp(
      { item: () => json({ ...ITEM, title: 'iPhone 14' }) },
      ebayRef({ itemId: ITEM_ID, variationId: VARIATION_ID }),
    );
    expect(result).toMatchObject({ ok: true, metadata: { title: 'iPhone 14' } });
    expect(calls[1]?.url.href).toBe(
      `${ITEM_URL}?legacy_item_id=${ITEM_ID}&legacy_variation_id=${VARIATION_ID}`,
    );
  });

  it('never passes on a description (D69, D74)', async () => {
    const { result } = await lookUp({ item: () => json(ITEM) });
    expect(result).toEqual({ ok: true, metadata: PRIMED });
    expect(JSON.stringify(result)).not.toContain('Seller-written');
  });

  describe('prices (§5.3, Review Focus 3)', () => {
    it('keeps a fixed price, with or without Best Offer', async () => {
      const plain = { ...ITEM, buyingOptions: ['FIXED_PRICE'] };
      for (const item of [ITEM, plain]) {
        const { result } = await lookUp({ item: () => json(item) });
        expect(result).toEqual({ ok: true, metadata: PRIMED });
      }
    });

    it('gives an auction no price, whatever price says, and still fills in the rest', async () => {
      const { result } = await lookUp({ item: () => json(AUCTION) });
      expect(result).toEqual({ ok: true, metadata: { title: ITEM.title, imageUrl: IMAGE } });
    });

    it('gives a mixed auction (AUCTION and FIXED_PRICE) no price', async () => {
      const mixed = { ...AUCTION, buyingOptions: ['AUCTION', 'FIXED_PRICE'] };
      const { result } = await lookUp({ item: () => json(mixed) });
      expect(result).toEqual({ ok: true, metadata: { title: ITEM.title, imageUrl: IMAGE } });
    });

    it('gives an item that says nothing about buyingOptions no price', async () => {
      const { buyingOptions: _dropped, ...bare } = ITEM;
      const { result } = await lookUp({ item: () => json(bare) });
      expect(result).toEqual({ ok: true, metadata: { title: ITEM.title, imageUrl: IMAGE } });
    });
  });

  describe('a listing with options and no option number (§5.2 step 3)', () => {
    const toGroup = (group: Route) => ({ item: () => errors(400, 11006), group });

    it('falls through to the group lookup with the item number', async () => {
      const { result, calls } = await lookUp(toGroup(() => json(GROUP_SAME)));
      expect(result).toMatchObject({ ok: true });
      expect(calls.map((call) => call.url.href.split('?')[0])).toEqual([
        TOKEN_URL,
        ITEM_URL,
        GROUP_URL,
      ]);
      expect(calls[2]?.url.href).toBe(`${GROUP_URL}?item_group_id=${ITEM_ID}`);
      expect(calls[2]?.init.headers).toMatchObject({
        authorization: 'Bearer tok',
        'x-ebay-c-marketplace-id': 'EBAY_US',
      });
    });

    it('keeps the price when every option costs the same', async () => {
      const { result } = await lookUp(toGroup(() => json(GROUP_SAME)));
      expect(result).toEqual({
        ok: true,
        metadata: { title: 'iPhone 14', imageUrl: IMAGE, priceText: '$287.99' },
      });
    });

    it('has no price when options differ (287.99 and 289.99 USD), and takes the first option’s title and photo', async () => {
      const { result } = await lookUp(toGroup(() => json(GROUP_DIFFERENT)));
      expect(result).toEqual({ ok: true, metadata: { title: 'iPhone 14', imageUrl: IMAGE } });
    });

    it('takes the photo from the first option that has one', async () => {
      const first = { ...OPTION_A, image: undefined };
      const { result } = await lookUp(toGroup(() => json({ items: [first, OPTION_B] })));
      expect(result).toMatchObject({
        ok: true,
        metadata: { imageUrl: 'https://i.ebayimg.com/images/g/B/s-l1600.jpg' },
      });
    });

    it('has no price when any option is an auction', async () => {
      const group = { items: [OPTION_A, { ...OPTION_A, buyingOptions: ['AUCTION'] }] };
      const { result } = await lookUp(toGroup(() => json(group)));
      expect(result).toEqual({ ok: true, metadata: { title: 'iPhone 14', imageUrl: IMAGE } });
    });

    it('has no price when an option has none', async () => {
      const group = { items: [OPTION_A, { ...OPTION_A, price: undefined }] };
      const { result } = await lookUp(toGroup(() => json(group)));
      expect(result).toEqual({ ok: true, metadata: { title: 'iPhone 14', imageUrl: IMAGE } });
    });

    it('is NO_METADATA for a group with no items', async () => {
      expect((await lookUp(toGroup(() => json({ items: [] })))).result).toEqual(noMetadata);
      expect((await lookUp(toGroup(() => json({})))).result).toEqual(noMetadata);
    });

    it('is NO_METADATA for a group that is not found, and reports a 400 from the group call', async () => {
      expect((await lookUp(toGroup(() => errors(404, 11003)))).result).toEqual(noMetadata);
      expect((await lookUp(toGroup(() => errors(400, 1)))).result).toEqual(unavailable(400, true));
    });
  });

  describe('a stale option number (ruling 2, Review Focus 4)', () => {
    const ref = ebayRef({ itemId: ITEM_ID, variationId: VARIATION_ID });

    it.each([400, 404])(
      'an item call that answers %i falls through to the group lookup',
      async (status) => {
        const { result, calls } = await lookUp(
          { item: () => errors(status, 11006), group: () => json(GROUP_SAME) },
          ref,
        );
        expect(result).toMatchObject({ ok: true, metadata: { title: 'iPhone 14' } });
        expect(calls[2]?.url.href).toBe(`${GROUP_URL}?item_group_id=${ITEM_ID}`);
      },
    );

    it('reports nothing when the group call then says the item is gone', async () => {
      const { result } = await lookUp(
        { item: () => errors(404, 11003), group: () => errors(404, 11003) },
        ref,
      );
      expect(result).toEqual(noMetadata);
    });
  });

  describe('listings that are not for sale, or have nothing usable (Review Focus 4)', () => {
    it('a 404 (errorId 11003) is NO_METADATA', async () => {
      expect((await lookUp({ item: () => errors(404, 11003) })).result).toEqual(noMetadata);
    });

    it('an OUT_OF_STOCK item is NO_METADATA (ruling 3)', async () => {
      const ended = {
        ...ITEM,
        estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }],
      };
      expect((await lookUp({ item: () => json(ended) })).result).toEqual(noMetadata);
    });

    it('a 200 with none of the three fields is NO_METADATA', async () => {
      const empty = { ...ITEM, title: '   ', image: undefined, price: undefined };
      expect((await lookUp({ item: () => json(empty) })).result).toEqual(noMetadata);
      expect((await lookUp({ item: () => json([]) })).result).toEqual(noMetadata);
    });

    it('still prefills a listing with no image or no price', async () => {
      const noImage = { ...ITEM, image: undefined };
      const noPrice = { ...ITEM, price: undefined };
      expect((await lookUp({ item: () => json(noImage) })).result).toMatchObject({
        ok: true,
        metadata: { title: ITEM.title },
      });
      expect((await lookUp({ item: () => json(noPrice) })).result).toMatchObject({
        ok: true,
        metadata: { title: ITEM.title, imageUrl: IMAGE },
      });
    });
  });

  describe('failures', () => {
    it.each([400, 401, 403])('a refused token (%i) is a misconfiguration', async (status) => {
      const { result, calls } = await lookUp({ token: () => json({ error: 'x' }, status) });
      expect(result).toEqual(unavailable(status, true));
      expect(calls).toHaveLength(1);
    });

    it('a token answer without a token is an outage, not a misconfiguration', async () => {
      const { result } = await lookUp({ token: () => json({ expires_in: 7200 }) });
      expect(result).toEqual(unavailable(200, false));
    });

    it.each([401, 403])('a refused item (%i) is a misconfiguration', async (status) => {
      expect((await lookUp({ item: () => errors(status, 1100) })).result).toEqual(
        unavailable(status, true),
      );
    });

    it('a 400 for any reason but 11006, with no option number, is a misconfiguration', async () => {
      expect((await lookUp({ item: () => errors(400, 1) })).result).toEqual(unavailable(400, true));
    });

    it.each([429, 500, 503])('a %i from the token or the item is an outage', async (status) => {
      expect((await lookUp({ token: () => json({}, status) })).result).toEqual(
        unavailable(status, false),
      );
      expect((await lookUp({ item: () => json({}, status) })).result).toEqual(
        unavailable(status, false),
      );
    });

    it('a network failure is an outage, and an unreadable body keeps its status', async () => {
      const down = await lookUp({
        item: () => {
          throw new TypeError('fetch failed');
        },
      });
      expect(down.result).toEqual({
        ok: false,
        reason: 'LOOKUP_UNAVAILABLE',
        misconfigured: false,
      });
      const garbled = await lookUp({ item: () => new Response('<html>', { status: 200 }) });
      expect(garbled.result).toEqual(unavailable(200, false));
    });

    it('an abort, before or during any call, is TIMEOUT', async () => {
      const before = new AbortController();
      before.abort(new DOMException('deadline', 'TimeoutError'));
      const early = await lookUp({ item: () => json(ITEM) }, ITEM_ID, before.signal);
      expect(early.result).toEqual({ ok: false, reason: 'TIMEOUT' });
      expect(early.calls).toHaveLength(0);

      // As fetch does: reject at once if the signal is already aborted, else when it aborts.
      const hangs: Route = (_url, init) =>
        new Promise<Response>((_, reject) => {
          const signal = init.signal;
          if (signal?.aborted) reject(signal.reason as Error);
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        });
      for (const routes of [{ token: hangs }, { item: hangs }]) {
        const during = new AbortController();
        const pending = lookUp(routes, ITEM_ID, during.signal);
        setTimeout(() => during.abort(new DOMException('deadline', 'TimeoutError')), 5);
        expect((await pending).result).toEqual({ ok: false, reason: 'TIMEOUT' });
      }
    });
  });
});
