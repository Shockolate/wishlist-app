import type { Metadata } from 'next';
import { SITE_ORIGIN, TAGLINE } from './site';
import { previewAlt, previewDescription, SHARE_DESCRIPTION } from './share-preview';

// Defined in share-preview.ts, which builds the longer description; re-exported so this stays the
// one place the metadata's callers import it from.
export { SHARE_DESCRIPTION };

export const PREVIEW_IMAGE = {
  url: '/hanker-preview.png',
  width: 1200,
  height: 630,
  alt: `Hanker: ${TAGLINE}`,
};

/**
 * Link previews (D56). No `og:url` and no canonical, here or on any page: on a token page either
 * would carry the token to whatever app fetches the preview.
 */
export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: 'Hanker', template: '%s | Hanker' },
  description: TAGLINE,
  openGraph: {
    type: 'website',
    siteName: 'Hanker',
    title: 'Hanker',
    description: TAGLINE,
    images: [PREVIEW_IMAGE],
  },
  twitter: { card: 'summary_large_image' },
};

/**
 * A share page's preview (Plan 12, design §3.4): the list's title, a line naming the owner and how
 * many things are on it, and the list's own image. Only what every viewer of the link sees alike,
 * never a claim. The image's URL carries the token (design §5.3): whoever fetches the image already
 * fetched the page at that token.
 */
export function shareMetadata(
  list: { title: string; ownerDisplayName: string; itemCount: number },
  shareToken: string,
): Metadata {
  const description = previewDescription(list.ownerDisplayName, list.itemCount);
  const images = [
    {
      url: `/s/${shareToken}/preview.jpg`,
      // PREVIEW_SIZE's, as literals: importing it would pull sharp into every page's metadata.
      width: 1200,
      height: 630,
      type: 'image/jpeg',
      alt: previewAlt(list.title, list.itemCount),
    },
  ];
  return {
    title: list.title,
    description,
    // A page's openGraph replaces the layout's whole object, so everything is restated here.
    openGraph: { type: 'website', siteName: 'Hanker', title: list.title, description, images },
    twitter: { card: 'summary_large_image', images },
  };
}
