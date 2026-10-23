import { describe, expect, it } from 'vitest';
import { EtsyOpenApiLookup } from './etsy-lookup.js';

const KEY = 'ks:secret';
const LISTING_ID = '1234567890';
const IMAGE_1 = 'https://i.etsystatic.com/1/il_570xN.jpg';

const LISTING = {
  listing_id: 1234567890,
  state: 'active',
  title: 'Hand&#39;thrown mug &amp; saucer',
  price: { amount: 2450, divisor: 100, currency_code: 'USD' },
  images: [
    {
      rank: 2,
      url_570xN: 'https://i.etsystatic.com/2/il_570xN.jpg',
      url_fullxfull: 'https://i.etsystatic.com/2/il_full.jpg',
    },
    { rank: 1, url_570xN: IMAGE_1, url_fullxfull: 'https://i.etsystatic.com/1/il_full.jpg' },
  ],
};

function fakeFetch(respond: (signal?: AbortSignal | null) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve().then(() => respond(init.signal));
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const live = () => new AbortController().signal;
const lookUp = (respond: Parameters<typeof fakeFetch>[0], signal = live()) =>
  new EtsyOpenApiLookup(KEY, fakeFetch(respond).fn).lookUp(LISTING_ID, signal);
const unavailable = (status: number, misconfigured: boolean) => ({
  ok: false,
  reason: 'LOOKUP_UNAVAILABLE',
  status,
  misconfigured,
});

describe('EtsyOpenApiLookup (retailer lookups §5.3)', () => {
  it('asks for one listing with its images, sending the key and nothing else', async () => {
    const signal = live();
    const { fn, calls } = fakeFetch(() => json(LISTING));
    await new EtsyOpenApiLookup(KEY, fn).lookUp(LISTING_ID, signal);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] ?? { url: '', init: {} };
    expect(url).toBe('https://api.etsy.com/v3/application/listings/1234567890?includes=Images');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'x-api-key': KEY, accept: 'application/json' });
    expect(init.body).toBeUndefined();
    expect(init.signal).toBe(signal);
  });

  it('prefills the decoded title, the first image by rank and the price', async () => {
    expect(await lookUp(() => json(LISTING))).toEqual({
      ok: true,
      metadata: { title: "Hand'thrown mug & saucer", imageUrl: IMAGE_1, priceText: '$24.50' },
    });
  });

  it('never passes on a description, which Etsy’s terms keep to the one prefill (D69)', async () => {
    const result = await lookUp(() => json({ ...LISTING, description: 'A lovely handmade mug.' }));
    expect(result).toEqual({
      ok: true,
      metadata: { title: "Hand'thrown mug & saucer", imageUrl: IMAGE_1, priceText: '$24.50' },
    });
  });

  it('falls back to the full-size image when the listing size is missing', async () => {
    const images = [{ rank: 1, url_fullxfull: 'https://i.etsystatic.com/1/il_full.jpg' }];
    const result = await lookUp(() => json({ ...LISTING, images }));
    expect(result).toMatchObject({
      ok: true,
      metadata: { imageUrl: 'https://i.etsystatic.com/1/il_full.jpg' },
    });
  });

  it.each(['inactive', 'sold_out', 'draft', 'removed', 'expired'])(
    'a %s listing is NO_METADATA (Review Focus 3)',
    async (state) => {
      expect(await lookUp(() => json({ ...LISTING, state }))).toEqual({
        ok: false,
        reason: 'NO_METADATA',
      });
    },
  );

  it('a 404 is NO_METADATA', async () => {
    expect(await lookUp(() => json({ error: 'not found' }, 404))).toEqual({
      ok: false,
      reason: 'NO_METADATA',
    });
  });

  describe('still prefills a listing without images or a usable price (Review Focus 4)', () => {
    const title = "Hand'thrown mug & saucer";
    it.each([
      ['no images', { images: [] }],
      ['a zero divisor', { price: { amount: 2450, divisor: 0, currency_code: 'USD' } }],
      ['no price', { price: undefined }],
    ])('%s', async (_case, change) => {
      const result = await lookUp(() => json({ ...LISTING, ...change }));
      expect(result).toMatchObject({ ok: true, metadata: { title } });
    });
  });

  it('a listing with nothing usable is NO_METADATA', async () => {
    const empty = { ...LISTING, title: '   ', images: [], price: undefined };
    expect(await lookUp(() => json(empty))).toEqual({ ok: false, reason: 'NO_METADATA' });
  });

  it.each([400, 401, 403])('a %i is a misconfiguration', async (status) => {
    expect(await lookUp(() => json({ error: 'x' }, status))).toEqual(unavailable(status, true));
  });

  it.each([429, 500, 503])('a %i is an outage', async (status) => {
    expect(await lookUp(() => json({ error: 'x' }, status))).toEqual(unavailable(status, false));
  });

  it('a network failure is an outage, and an unreadable body keeps its status', async () => {
    expect(
      await lookUp(() => {
        throw new TypeError('fetch failed');
      }),
    ).toEqual({ ok: false, reason: 'LOOKUP_UNAVAILABLE', misconfigured: false });
    expect(await lookUp(() => new Response('<html>', { status: 200 }))).toEqual(
      unavailable(200, false),
    );
  });

  it('an abort, before or during the request, is TIMEOUT', async () => {
    const before = new AbortController();
    before.abort(new DOMException('deadline', 'TimeoutError'));
    expect(await lookUp(() => json(LISTING), before.signal)).toEqual({
      ok: false,
      reason: 'TIMEOUT',
    });

    const during = new AbortController();
    const result = lookUp(
      (signal) =>
        // As fetch does: reject at once if the signal is already aborted, else when it aborts.
        new Promise<Response>((_, reject) => {
          if (signal?.aborted) reject(signal.reason as Error);
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        }),
      during.signal,
    );
    during.abort(new DOMException('deadline', 'TimeoutError'));
    expect(await result).toEqual({ ok: false, reason: 'TIMEOUT' });
  });
});
