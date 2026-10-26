import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drawableText,
  preparePhoto,
  PREVIEW_MAX_BYTES,
  PREVIEW_SIZE,
  renderSharePreview,
} from './share-preview-image';

/** A photo-like JPEG: gaussian noise compresses about as badly as a real photo, so sizes are honest. */
function noisyJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 800,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function expectPreviewJpeg(out: Buffer) {
  const { format, width, height } = await sharp(out).metadata();
  expect({ format, width, height }).toEqual({
    format: 'jpeg',
    width: PREVIEW_SIZE.width,
    height: PREVIEW_SIZE.height,
  });
}

let photos: Buffer[];

beforeAll(async () => {
  const prepared = await Promise.all(
    [noisyJpeg(), noisyJpeg(), noisyJpeg(), noisyJpeg()].map(async (bytes) =>
      preparePhoto(await bytes),
    ),
  );
  photos = prepared.map((photo) => {
    if (!photo) throw new Error('fixture photo did not prepare');
    return photo;
  });
});

describe('renderSharePreview', () => {
  // Every render must stay offline (Review Focus 2). Yoga's wasm loads from an inline `data:` URI
  // on the first render, so those go to the real fetch; anything else is recorded and refused.
  const network = vi.fn<(url: string) => void>();

  beforeEach(() => {
    const realFetch = globalThis.fetch;
    network.mockReset();
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('data:')) return realFetch(input, init);
      network(url);
      throw new Error('no network');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
  });

  it('draws a 1200×630 JPEG under 300 KB with four photos', async () => {
    const out = await renderSharePreview({ title: 'Sam’s wishlist', itemCount: 12, photos });

    await expectPreviewJpeg(out);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_MAX_BYTES);
  });

  it('draws with 3, 2, 1 and 0 photos and an empty list', async () => {
    for (const count of [3, 2, 1, 0]) {
      await expectPreviewJpeg(
        await renderSharePreview({
          title: 'Sam’s wishlist',
          itemCount: 7,
          photos: photos.slice(0, count),
        }),
      );
    }
    await expectPreviewJpeg(
      await renderSharePreview({ title: 'Sam’s wishlist', itemCount: 0, photos: [] }),
    );
  });

  it('draws a 200-character title', async () => {
    const title = 'A very long wishlist title '.repeat(8).slice(0, 200);

    await expectPreviewJpeg(await renderSharePreview({ title, itemCount: 3, photos }));
  });

  it('wraps a title with no spaces rather than drawing it under the grid', async () => {
    const out = await renderSharePreview({ title: 'W'.repeat(120), itemCount: 2, photos });

    // The 56px gap between the text column and the grid, inset from JPEG ringing at its edges.
    const { data } = await sharp(out)
      .extract({ left: 586, top: 64, width: 40, height: 502 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const background = [0xfb, 0xf9, 0xf5];
    const furthest = Math.max(...data.map((value, i) => Math.abs(value - background[i % 3]!)));
    expect(furthest).toBeLessThan(16);
  });

  it('draws emoji and Persian titles without asking the network', async () => {
    // Cyrillic is in Geist but not Instrument Serif, so the title falls back to Geist, not a fetch.
    // `W̶i̶s̶h̶` and `x̣` carry combining marks only Geist has, after letters Instrument Serif has.
    for (const title of ['🎂 Sam’s birthday', 'فهرست آرزو', 'Список желаний', 'W̶i̶s̶h̶', 'x̣']) {
      await expectPreviewJpeg(await renderSharePreview({ title, itemCount: 2, photos }));
    }
    expect(network).not.toHaveBeenCalled();
  });
});

describe('drawableText', () => {
  it('keeps what either font draws', async () => {
    await expect(drawableText('Zoë’s café – 2026 wishlist…')).resolves.toBe(
      'Zoë’s café – 2026 wishlist…',
    );
    await expect(drawableText('Список желаний')).resolves.toBe('Список желаний');
  });

  it('drops emoji and scripts neither font has, and tidies the spaces left behind', async () => {
    await expect(drawableText('🎂 Sam’s  birthday 👨‍👩‍👧')).resolves.toBe('Sam’s birthday');
    await expect(drawableText('فهرست آرزو')).resolves.toBe('');
  });

  it('drops a letter whose mark is only in the font the letter is not drawn from', async () => {
    // next/og draws each grapheme from the first font with its first code point: here Instrument
    // Serif, which lacks U+0336 and U+0323, so the whole grapheme would be fetched from elsewhere.
    await expect(drawableText('Sam’s W̶i̶s̶h̶ list')).resolves.toBe('Sam’s list');
    await expect(drawableText('x̣')).resolves.toBe('');
  });
});

describe('preparePhoto', () => {
  it('shrinks a photo to a 502×502 JPEG tile', async () => {
    const tile = await preparePhoto(await noisyJpeg());

    expect(tile).not.toBeNull();
    const { format, width, height } = await sharp(tile!).metadata();
    expect({ format, width, height }).toEqual({ format: 'jpeg', width: 502, height: 502 });
  });

  it('skips bytes that are not an image', async () => {
    await expect(preparePhoto(Buffer.from('not an image'))).resolves.toBeNull();
  });

  it('skips an image sharp can read that is not a JPEG, PNG or WebP', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="red"/></svg>',
    );
    const gif = await sharp({
      create: { width: 800, height: 800, channels: 3, background: '#808080' },
    })
      .gif()
      .toBuffer();

    await expect(preparePhoto(svg)).resolves.toBeNull();
    await expect(preparePhoto(gif)).resolves.toBeNull();
  });

  it('skips an image over the pixel limit without decoding it', async () => {
    const huge = await sharp({
      create: { width: 20_000, height: 20_000, channels: 3, background: '#ffffff' },
      limitInputPixels: false,
    })
      .png()
      .toBuffer();

    await expect(preparePhoto(huge)).resolves.toBeNull();
  }, 20_000);
});
