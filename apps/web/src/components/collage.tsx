import Image from 'next/image';
import { CARD } from '@/components/share/share-card';
import { COLLAGE_COLUMNS, type CollageItem } from '@/lib/collage-items';
import { cn } from '@/lib/utils';

function SampleCard({ item }: { item: CollageItem }) {
  return (
    <div className={CARD}>
      {item.photo ? (
        <Image
          src={item.photo}
          alt=""
          width={640}
          height={320}
          sizes="320px"
          className="h-[150px] w-full bg-placeholder object-cover"
        />
      ) : null}
      <div className="p-4">
        {item.photo === null ? (
          <p className="text-[13px] font-medium text-muted-foreground">An idea</p>
        ) : null}
        <h2
          className={cn('text-[17px] leading-snug font-semibold', item.photo === null && 'mt-1.5')}
        >
          {item.title}
        </h2>
        {item.price || item.shop ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[15px] text-muted-foreground">
            {item.price ? <span className="font-medium text-foreground">{item.price}</span> : null}
            {item.shop ? (
              <span className="text-foreground underline">See it at {item.shop}</span>
            ) : null}
          </p>
        ) : null}
        {item.note ? <p className="mt-1 text-[15px] leading-relaxed">{item.note}</p> : null}
      </div>
    </div>
  );
}

/**
 * Sample gifts drawn as share cards. Decoration only: hidden from assistive tech, and on phones.
 * The card is the share page's, so keep the two looking alike; the links are plain text because
 * a focusable link inside aria-hidden content is an accessibility error.
 */
export function Collage() {
  return (
    <div
      aria-hidden="true"
      className="hidden min-w-0 flex-[1_1_480px] grid-cols-2 items-start gap-3.5 md:grid"
    >
      {COLLAGE_COLUMNS.map((column, index) => (
        <div key={index} className={cn('flex flex-col gap-3.5', index === 1 && 'mt-11')}>
          {column.map((item) => (
            <SampleCard key={item.title} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
}
