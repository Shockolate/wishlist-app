import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client';
import { loadPreview, loadPreviewPhotos } from './share-preview.server';

vi.mock('server-only', () => ({}));

const ORIGIN = 'http://api.test';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const photoUrl = (id: string) => `${ORIGIN}/api/shared/${TOKEN}/photos/${id}`;

/** A solid PNG whose red channel names it, so a prepared photo can be traced back to its item. */
function solidPng(red: number): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: red, g: 0, b: 0 } } })
    .png()
    .toBuffer();
}

/** Which item each prepared photo came from: the photos are `solidPng(itemIndex * 25)`. */
async function itemsOf(photos: Buffer[]): Promise<string[]> {
  const reds = await Promise.all(
    photos.map(async (photo) => (await sharp(photo).stats()).channels[0]?.mean ?? -1),
  );
  return reds.map((red) => ids[Math.round(red / 25)] ?? `unknown red ${red}`);
}

type Answer = Response | Promise<Response> | 'hang' | 'throw';

/** A fake fetch that answers each photo URL as `answers` says, and an OK photo for any other. */
function fakeFetch(answers: Record<string, Answer | (() => Promise<Response>)> = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const index = ids.findIndex((id) => photoUrl(id) === url);
    const answer = answers[ids[index] ?? ''];
    if (answer === 'hang') return new Promise<Response>(() => {});
    if (answer === 'throw') throw new TypeError('fetch failed');
    if (typeof answer === 'function') return answer();
    if (answer) return answer;
    return new Response(new Uint8Array(await solidPng(index * 25)), {
      headers: { 'content-type': 'image/png' },
    });
  });
}

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('loadPreviewPhotos', () => {
  it('asks the API for every candidate at once, sends no cookie, and keeps list order when the second answers first', async () => {
    let firstStarted = false;
    let secondSawFirstStarted = false;
    const fetchFn = fakeFetch({
      [ids[0]!]: async () => {
        firstStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Response(new Uint8Array(await solidPng(0)));
      },
      [ids[1]!]: async () => {
        secondSawFirstStarted = firstStarted;
        return new Response(new Uint8Array(await solidPng(25)));
      },
    });

    const photos = await loadPreviewPhotos(TOKEN, ids.slice(0, 2), {
      fetchFn: fetchFn as typeof fetch,
    });

    expect(await itemsOf(photos)).toEqual([ids[0], ids[1]]);
    expect(secondSawFirstStarted).toBe(true);
    expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual([
      photoUrl(ids[0]!),
      photoUrl(ids[1]!),
    ]);
    for (const [, init] of fetchFn.mock.calls) {
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
    }
  });

  it('skips a 404, a body that isn’t an image and a failed request, and fills in from later candidates', async () => {
    const fetchFn = fakeFetch({
      [ids[1]!]: new Response(null, { status: 404 }),
      [ids[2]!]: new Response('not an image', { headers: { 'content-type': 'image/jpeg' } }),
      [ids[3]!]: 'throw',
    });

    const photos = await loadPreviewPhotos(TOKEN, ids.slice(0, 7), {
      fetchFn: fetchFn as typeof fetch,
    });

    expect(await itemsOf(photos)).toEqual([ids[0], ids[4], ids[5], ids[6]]);
  });

  it('never returns more than four photos, the first four in list order', async () => {
    const photos = await loadPreviewPhotos(TOKEN, ids, {
      fetchFn: fakeFetch() as typeof fetch,
    });

    expect(await itemsOf(photos)).toEqual(ids.slice(0, 4));
  });

  it('doesn’t wait for later candidates once the first four in list order are in, and cancels them', async () => {
    const fetchFn = fakeFetch({ [ids[4]!]: 'hang' });
    const started = Date.now();
    const photos = await loadPreviewPhotos(TOKEN, ids.slice(0, 5), {
      fetchFn: fetchFn as typeof fetch,
    });

    expect(photos).toHaveLength(4);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(fetchFn.mock.calls[4]?.[1]?.signal?.aborted).toBe(true);
  });

  // Review Focus 4: a photo request that hangs never holds the image past the budget.
  it('gives up on requests that never answer once the budget has passed', async () => {
    const started = Date.now();
    const photos = await loadPreviewPhotos(TOKEN, ids.slice(0, 3), {
      budgetMs: 50,
      fetchFn: vi.fn(() => new Promise<Response>(() => {})) as typeof fetch,
    });

    expect(photos).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps the photos that arrived in time and drops the one that didn’t', async () => {
    const photos = await loadPreviewPhotos(TOKEN, ids.slice(0, 2), {
      budgetMs: 100,
      fetchFn: fakeFetch({ [ids[0]!]: 'hang' }) as typeof fetch,
    });

    expect(await itemsOf(photos)).toEqual([ids[1]]);
  });
});

describe('loadPreview', () => {
  const preview = {
    title: 'Sam’s wishlist',
    ownerDisplayName: 'Sam',
    itemCount: 2,
    photoItemIds: [],
  };

  it('reads the preview from the API as a guest, with no cookie', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(preview));
    vi.stubGlobal('fetch', fetchFn);

    await expect(loadPreview(TOKEN)).resolves.toEqual(preview);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}/api/shared/${TOKEN}/preview`);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
  });

  it('is not found for a dead link, and never asks the API about a malformed token', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        {
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          code: 'SHARE_LINK_NOT_FOUND',
          requestId: 'r',
        },
        { status: 404, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchFn);

    await expect(loadPreview(TOKEN)).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    await expect(loadPreview('not-a-token')).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws any other failure, so it is reported (ruling 10)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );

    await expect(loadPreview(TOKEN)).rejects.toBeInstanceOf(ApiError);
  });
});
