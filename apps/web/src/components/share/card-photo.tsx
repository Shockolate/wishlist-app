'use client';

import { useCallback, useState } from 'react';

/** A card's photo, full width. One that won't load is left out (Plan 3b rule 10). */
export function CardPhoto({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  // An image that failed before hydration never fires onError; catch it as the element attaches.
  const catchEarlyFailure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- photos come from any https host; next/image would fetch them through our server, which spec §2 rules out.
    <img
      ref={catchEarlyFailure}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-[150px] w-full bg-placeholder object-cover"
    />
  );
}
