import { describe, expect, it } from 'vitest';
import { TAGLINE } from './site';
import { PREVIEW_IMAGE, rootMetadata, SHARE_DESCRIPTION, shareMetadata } from './site-metadata';

/** Every path to a key named `name`, at any depth. */
function pathsTo(name: string, value: unknown, at = ''): string[] {
  if (value === null || typeof value !== 'object' || value instanceof URL) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === name ? [`${at}.${key}`] : []),
    ...pathsTo(name, child, `${at}.${key}`),
  ]);
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

  it('a share page previews its title and one fixed line, nothing else from the list', () => {
    const metadata = shareMetadata('Sam’s wishlist');
    expect(metadata.title).toBe('Sam’s wishlist');
    expect(metadata.description).toBe(SHARE_DESCRIPTION);
    expect(SHARE_DESCRIPTION).toBe('Pick a gift so nobody doubles up.');
    expect(metadata.openGraph).toEqual({
      title: 'Sam’s wishlist',
      description: SHARE_DESCRIPTION,
      images: [PREVIEW_IMAGE],
      siteName: 'Hanker',
      type: 'website',
    });
  });

  it('no metadata names a URL for the page, so a token can never reach one', () => {
    for (const metadata of [rootMetadata, shareMetadata('x')]) {
      expect(pathsTo('url', metadata).filter((path) => !path.includes('.images.'))).toEqual([]);
      expect(pathsTo('alternates', metadata)).toEqual([]);
    }
  });
});
