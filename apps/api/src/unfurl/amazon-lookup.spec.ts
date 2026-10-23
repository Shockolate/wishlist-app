import { describe, expect, it } from 'vitest';
import { BrightDataAmazonLookup } from './amazon-lookup.js';

const KEY = 'test-key-0000';
const ASIN = 'B08FK7B2SC';
const IMAGE = 'https://m.media-amazon.com/images/I/81huEJXkxfL._AC_SL1500_.jpg';

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
  new BrightDataAmazonLookup(KEY, fakeFetch(respond).fn).lookUp(ASIN, signal);

describe('BrightDataAmazonLookup (retailer lookups §5.2)', () => {
  it('asks the Amazon dataset for the canonical product URL, and nothing else', async () => {
    const { fn, calls } = fakeFetch(() => json([]));
    await new BrightDataAmazonLookup(KEY, fn).lookUp(ASIN, live());
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] ?? { url: '', init: {} };
    expect(url).toBe(
      'https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_l7q7dkf244hwjntr0&format=json',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      input: [{ url: 'https://www.amazon.com/dp/B08FK7B2SC' }],
    });
  });

  it('passes the deadline’s signal to the request', async () => {
    const signal = live();
    const { fn, calls } = fakeFetch(() => json([]));
    await new BrightDataAmazonLookup(KEY, fn).lookUp(ASIN, signal);
    expect(calls[0]?.init.signal).toBe(signal);
  });

  it('turns a record into a prefill', async () => {
    const record = {
      title: 'Cephalofair Games: Frosthaven',
      image_url: IMAGE,
      final_price: 240,
      currency: 'USD',
    };
    expect(await lookUp(() => json([record]))).toEqual({
      ok: true,
      metadata: { title: 'Cephalofair Games: Frosthaven', imageUrl: IMAGE, priceText: '$240.00' },
    });
  });

  describe('description (Plan 9 ruling 7, for tag suggestions only)', () => {
    it('joins categories with " > ", then ". ", then the description', async () => {
      const record = {
        title: 'Kettle',
        categories: ['Home & Kitchen', 'Kettles'],
        description: 'Pour-over kettle.',
      };
      expect(await lookUp(() => json([record]))).toEqual({
        ok: true,
        metadata: { title: 'Kettle', description: 'Home & Kitchen > Kettles. Pour-over kettle.' },
      });
    });

    it('skips categories that aren’t strings', async () => {
      const record = {
        title: 'Kettle',
        categories: ['Kettles', 7, null, ''],
        description: 'Nice.',
      };
      expect(await lookUp(() => json([record]))).toEqual({
        ok: true,
        metadata: { title: 'Kettle', description: 'Kettles. Nice.' },
      });
    });

    it('uses either part alone', async () => {
      expect(await lookUp(() => json([{ title: 'K', categories: ['A', 'B'] }]))).toEqual({
        ok: true,
        metadata: { title: 'K', description: 'A > B' },
      });
      expect(await lookUp(() => json([{ title: 'K', description: 'Only this.' }]))).toEqual({
        ok: true,
        metadata: { title: 'K', description: 'Only this.' },
      });
    });

    it('cuts the whole thing to 1000 characters', async () => {
      const record = { title: 'K', categories: ['A'], description: 'b'.repeat(1500) };
      const result = await lookUp(() => json([record]));
      expect(result.ok === true && result.metadata.description).toHaveLength(1000);
    });

    it('is NO_METADATA when a record has only a description', async () => {
      expect(
        await lookUp(() => json([{ categories: ['Kettles'], description: 'Pour-over kettle.' }])),
      ).toEqual({ ok: false, reason: 'NO_METADATA' });
    });
  });

  describe('sparse records (Review Focus 2)', () => {
    it('keeps a title when there is no price', async () => {
      expect(await lookUp(() => json([{ title: 'X', final_price: null }]))).toEqual({
        ok: true,
        metadata: { title: 'X' },
      });
    });

    it('takes the first of `images` when there is no image_url', async () => {
      expect(await lookUp(() => json([{ images: [IMAGE] }]))).toEqual({
        ok: true,
        metadata: { imageUrl: IMAGE },
      });
    });

    it.each([[[]], [[{}]], [{}], [null]])('finds nothing in %j', async (body) => {
      expect(await lookUp(() => json(body))).toEqual({ ok: false, reason: 'NO_METADATA' });
    });

    it('calls a body that isn’t JSON unavailable, not a crash', async () => {
      expect(await lookUp(() => new Response('<html>', { status: 200 }))).toEqual({
        ok: false,
        reason: 'LOOKUP_UNAVAILABLE',
        status: 200,
        misconfigured: false,
      });
    });
  });

  it('treats a 202 (still running past Bright Data’s minute) as a timeout (Review Focus 5)', async () => {
    expect(await lookUp(() => json({ snapshot_id: 's_1' }, 202))).toEqual({
      ok: false,
      reason: 'TIMEOUT',
    });
  });

  it.each([400, 401, 403, 404])('calls a %i our misconfiguration', async (status) => {
    expect(await lookUp(() => json({ error: 'x' }, status))).toEqual({
      ok: false,
      reason: 'LOOKUP_UNAVAILABLE',
      status,
      misconfigured: true,
    });
  });

  it.each([429, 503])('calls a %i an expected outage', async (status) => {
    expect(await lookUp(() => json({ error: 'x' }, status))).toEqual({
      ok: false,
      reason: 'LOOKUP_UNAVAILABLE',
      status,
      misconfigured: false,
    });
  });

  it('calls a network failure an outage, with no status', async () => {
    expect(
      await lookUp(() => {
        throw new TypeError('fetch failed');
      }),
    ).toEqual({ ok: false, reason: 'LOOKUP_UNAVAILABLE', misconfigured: false });
  });

  it('is a timeout when the deadline has already passed', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    expect(await lookUp(() => json([]), controller.signal)).toEqual({
      ok: false,
      reason: 'TIMEOUT',
    });
  });

  it('is a timeout when the deadline passes mid-request', async () => {
    const controller = new AbortController();
    const result = lookUp(
      (signal) =>
        // As fetch does: reject at once if the signal is already aborted, else when it aborts.
        new Promise<Response>((_, reject) => {
          if (signal?.aborted) reject(signal.reason as Error);
          signal?.addEventListener('abort', () => reject(signal.reason as Error));
        }),
      controller.signal,
    );
    controller.abort(new DOMException('deadline', 'TimeoutError'));
    expect(await result).toEqual({ ok: false, reason: 'TIMEOUT' });
  });
});
