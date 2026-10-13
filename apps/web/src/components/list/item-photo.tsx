'use client';

import type { Item } from '@wishlist/contracts';
import { useCallback, useState } from 'react';
import { IdeaIcon, PhotoIcon } from './icons';

const TILE = 'flex size-14 shrink-0 items-center justify-center rounded-[10px]';

/** The item's photo, or a tile when there's none or it won't load (Plan 3b rule 10). */
export function ItemPhoto({ item }: { item: Pick<Item, 'url' | 'imageUrl'> }) {
  // The URL that failed, so a changed photo link gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null);
  const src = item.imageUrl;
  // An image that failed before hydration never fires onError; catch it as the element attaches.
  const catchEarlyFailure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(img.getAttribute('src'));
  }, []);

  if (src && src !== failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- photos come from any https host; next/image would fetch them through our server, which spec §2 rules out.
      <img
        ref={catchEarlyFailure}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`${TILE} bg-placeholder object-cover`}
      />
    );
  }
  if (item.url === null) {
    return (
      <div className={`${TILE} border-[1.5px] border-dashed border-input text-muted-foreground`}>
        <IdeaIcon />
      </div>
    );
  }
  return (
    <div className={`${TILE} bg-placeholder text-input`}>
      <PhotoIcon />
    </div>
  );
}
