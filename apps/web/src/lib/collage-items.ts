export type CollageItem = {
  title: string;
  /** Pre-cropped to the card's photo strip; see public/collage/CREDITS.md. Null for an idea. */
  photo: string | null;
  price: string | null;
  /** A hostname, as the share page shows beside "See it at". Null for an idea. */
  shop: string | null;
  note: string | null;
};

/** Sample gifts for the landing and signup collage, as two staggered columns of share cards. */
export const COLLAGE_COLUMNS: readonly [readonly CollageItem[], readonly CollageItem[]] = [
  [
    {
      title: 'Hardcover cookbook',
      photo: '/collage/cookbook.webp',
      price: '$35',
      shop: 'example-shop.com',
      note: null,
    },
    {
      title: 'Pottery class for two',
      photo: null,
      price: null,
      shop: null,
      note: 'Somewhere with a wheel, not just hand-building.',
    },
    {
      title: 'Wool socks',
      photo: '/collage/socks.webp',
      price: '$24',
      shop: 'example-shop.com',
      note: null,
    },
  ],
  [
    {
      title: 'Fig tree',
      photo: '/collage/fig.webp',
      price: '$45',
      shop: 'example-shop.com',
      note: null,
    },
    {
      title: 'Camp mug',
      photo: '/collage/mug.webp',
      price: '$18',
      shop: 'example-shop.com',
      note: null,
    },
  ],
];
