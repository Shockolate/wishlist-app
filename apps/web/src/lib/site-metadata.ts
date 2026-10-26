import type { Metadata } from 'next';
import { SITE_ORIGIN, TAGLINE } from './site';
import { SHARE_DESCRIPTION } from './share-preview';

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

/** A share page's preview: the list's own title and one fixed line, nothing else from the list. */
export function shareMetadata(listTitle: string): Metadata {
  return {
    title: listTitle,
    description: SHARE_DESCRIPTION,
    // A page's openGraph replaces the layout's whole object, so the image is restated, not inherited.
    openGraph: {
      type: 'website',
      siteName: 'Hanker',
      title: listTitle,
      description: SHARE_DESCRIPTION,
      images: [PREVIEW_IMAGE],
    },
  };
}
