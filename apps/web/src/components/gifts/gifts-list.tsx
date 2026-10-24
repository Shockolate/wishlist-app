import type { GiftsResponse } from '@wishlist/contracts';
import { groupByList } from '@/lib/gift-groups';
import { NOTHING_YET, summaryLine } from '@/lib/gifts-copy';
import { GiftCard } from './gift-card';
import { GoneNote, GIFTS_HEADING_ID } from './gone-note';

/**
 * Your gifts (design §5.7, mockup A): the heading and summary, a group per list in the API's order,
 * then notes about claims that went. The cards and notes are the client islands that write.
 */
export function GiftsList({ gifts, gone }: GiftsResponse) {
  const groups = groupByList(gifts);
  return (
    <>
      <h1
        id={GIFTS_HEADING_ID}
        tabIndex={-1}
        className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none focus:outline-none"
      >
        Your gifts
      </h1>
      {gifts.length > 0 ? (
        <p className="mt-2.5 text-muted-foreground">{summaryLine(gifts)}</p>
      ) : null}
      {gifts.length === 0 && gone.length === 0 ? (
        <p className="mt-8 rounded-card border border-dashed border-border p-5 text-[15px] leading-relaxed">
          {NOTHING_YET}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-8">
        {groups.map((group, index) => (
          <section key={`${group.shareUrl}-${index}`} aria-labelledby={`gifts-group-${index}`}>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-1.5">
              <h2
                id={`gifts-group-${index}`}
                className="font-display text-2xl leading-tight [overflow-wrap:anywhere]"
              >
                {group.ownerDisplayName}
              </h2>
              <a
                href={group.shareUrl}
                className="inline-flex min-h-11 shrink-0 items-center text-[15px] underline"
              >
                Open list
                <span className="sr-only"> for {group.ownerDisplayName}</span>
              </a>
            </div>
            <ul className="mt-2.5 flex flex-col gap-2.5">
              {group.gifts.map((gift) => (
                <GiftCard key={gift.linkId} gift={gift} />
              ))}
            </ul>
          </section>
        ))}
        {gone.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {gone.map((note) => (
              <GoneNote key={note.linkId} note={note} />
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
