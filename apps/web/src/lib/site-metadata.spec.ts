import { describe, expect, it } from 'vitest';
import { TAGLINE } from './site';
import { PREVIEW_IMAGE, rootMetadata, shareMetadata } from './site-metadata';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

/** Every path to a key named `name`, at any depth. */
function pathsTo(name: string, value: unknown, at = ''): string[] {
  if (value === null || typeof value !== 'object' || value instanceof URL) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === name ? [`${at}.${key}`] : []),
    ...pathsTo(name, child, `${at}.${key}`),
  ]);
}

/** Every path to a string that contains `needle`, at any depth. */
function stringsContaining(needle: string, value: unknown, at = ''): string[] {
  if (typeof value === 'string') return value.includes(needle) ? [at] : [];
  if (value === null || typeof value !== 'object' || value instanceof URL) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    stringsContaining(needle, child, `${at}.${key}`),
  );
}

describe('site metadata', () => {
  it('the root metadata resolves against hanker.dev and previews with the tag image', () => {
    expect(String(rootMetadata.metadataBase)).toBe('https://hanker.dev/');
    expect(rootMetadata.title).toEqual({ default: 'Hanker', template: '%s | Hanker' });
    expect(rootMetadata.description).toBe(TAGLINE);
    expect(rootMetadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Hanker',
      title: 'Hanker',
      description: TAGLINE,
      images: [PREVIEW_IMAGE],
    });
    expect(rootMetadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('a share page previews its title, the owner and count, and its own image of the list', () => {
    const metadata = shareMetadata(
      { title: 'Sam’s wishlist', ownerDisplayName: 'Sam', itemCount: 12 },
      TOKEN,
    );
    const description = '12 things on Sam’s list. Pick a gift so nobody doubles up.';
    const images = [
      {
        url: `/s/${TOKEN}/preview.jpg`,
        width: 1200,
        height: 630,
        type: 'image/jpeg',
        alt: 'Sam’s wishlist: 12 things on the list',
      },
    ];
    expect(metadata.title).toBe('Sam’s wishlist');
    expect(metadata.description).toBe(description);
    expect(metadata.openGraph).toEqual({
      title: 'Sam’s wishlist',
      description,
      images,
      siteName: 'Hanker',
      type: 'website',
    });
    expect(metadata.twitter).toEqual({ card: 'summary_large_image', images });
  });

  it('no metadata names a URL for the page, so a token can never reach one', () => {
    const share = shareMetadata({ title: 'x', ownerDisplayName: 'Sam', itemCount: 1 }, TOKEN);
    for (const metadata of [rootMetadata, share]) {
      expect(pathsTo('url', metadata).filter((path) => !path.includes('.images.'))).toEqual([]);
      expect(pathsTo('alternates', metadata)).toEqual([]);
    }
    // Design §5.3: the image's URL carries the token on purpose. The app that fetches the image
    // already fetched the page at that token, so the token reaches no one new. Nothing else may.
    expect(stringsContaining(TOKEN, share)).toEqual([
      '.openGraph.images.0.url',
      '.twitter.images.0.url',
    ]);
  });
});
