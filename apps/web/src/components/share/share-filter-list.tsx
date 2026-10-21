'use client';

import type { Tag } from '@wishlist/contracts';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { shownLine, tagChipLabel } from '@/lib/share-copy';
import {
  bandCount,
  listCurrency,
  matches,
  NO_FILTERS,
  orderTags,
  tagCount,
  type BandId,
  type FilterItem,
  type Filters,
} from '@/lib/share-filters';
import { cn } from '@/lib/utils';
import { PILL_HIT, pillCount, pillFace } from './filter-pill';
import { PricePanel, PricePill, usePriceMenu } from './share-price-menu';
import { CARD } from './share-card';

const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

const toggled = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * The share page's cards with the filter row above them (design §4, D62): tags narrow with AND,
 * price bands widen with OR. The row appears only once this island has hydrated, so without
 * JavaScript the page is the plain list. Filtered-out cards are hidden, not unmounted (Plan 7b
 * ruling 2), so a card's own state survives, and the filters live here, above the server render,
 * so the `router.refresh()` after a claim keeps them.
 */
export function ShareFilterList({
  label,
  tags,
  items,
  cards,
}: {
  /** The list's accessible name. */
  label: string;
  tags: readonly Tag[];
  /** In the same order as `cards`. */
  items: readonly FilterItem[];
  cards: readonly { id: string; node: ReactNode }[];
}) {
  const mounted = useSyncExternalStore(noSubscribe, onClient, onServer);
  const [picked, setPicked] = useState<Filters>(NO_FILTERS);
  const { open, panelId, pillRef, panelRef, toggle } = usePriceMenu();
  const rowRef = useRef<HTMLDivElement | null>(null);

  const currency = useMemo(() => listCurrency(items), [items]);
  const chips = useMemo(
    () =>
      orderTags(
        tags.filter((tag) => items.some((item) => item.tagIds?.includes(tag.id))),
        items,
      ),
    [tags, items],
  );
  // A refresh can take a tag, or the list's currency, away. A filter on something no longer
  // offered would hide cards with no chip left to undo it, so it's dropped.
  const filters: Filters = {
    tagIds: picked.tagIds.filter((id) => chips.some((tag) => tag.id === id)),
    bands: currency === null ? [] : picked.bands,
  };
  const shown = new Set(items.filter((item) => matches(item, filters, currency)).map((i) => i.id));
  const active = filters.tagIds.length > 0 || filters.bands.length > 0;
  const hasRow = mounted && (chips.length > 0 || currency !== null);

  const clear = () => {
    setPicked(NO_FILTERS);
    // The button pressed goes with the line; focus goes to the start of the row instead.
    rowRef.current?.querySelector('button')?.focus();
  };

  return (
    <>
      {hasRow ? (
        <div className="relative mt-5">
          <div
            ref={rowRef}
            role="group"
            aria-label="Filter the list"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-7 sm:px-7 [&::-webkit-scrollbar]:hidden"
          >
            {currency !== null ? (
              <PricePill
                ref={pillRef}
                open={open}
                panelId={panelId}
                onToggle={toggle}
                bands={filters.bands}
                currency={currency}
              />
            ) : null}
            {chips.map((tag) => {
              const count = tagCount(items, filters, currency, tag.id);
              const on = filters.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={tagChipLabel(tag.name, count)}
                  disabled={count === 0 && !on}
                  onClick={() => setPicked({ ...filters, tagIds: toggled(filters.tagIds, tag.id) })}
                  className={PILL_HIT}
                >
                  <span className={pillFace(on)}>
                    {tag.name}
                    <span className={pillCount(on)}>{count}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {currency !== null ? (
            <PricePanel
              ref={panelRef}
              open={open}
              panelId={panelId}
              bands={filters.bands}
              currency={currency}
              anyCount={bandCount(items, filters, currency, 'any')}
              countOf={(band: BandId) => bandCount(items, filters, currency, band)}
              onToggle={(band) => setPicked({ ...filters, bands: toggled(filters.bands, band) })}
              onAny={() => setPicked({ ...filters, bands: [] })}
            />
          ) : null}
        </div>
      ) : null}
      {hasRow ? (
        <div className={cn('flex flex-wrap items-center gap-x-3', active && 'mt-1')}>
          <p role="status" className="text-[15px] text-muted-foreground">
            {active ? shownLine(shown.size, items.length) : ''}
          </p>
          {active ? (
            <Button variant="link" className="min-h-11" onClick={clear}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
      {active && shown.size === 0 ? (
        <div className="mt-4 rounded-card border border-input/30 bg-placeholder p-5">
          <p className="text-[15px]">Nothing on the list matches these filters.</p>
          <Button variant="secondary" size="compact" className="mt-3" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : null}
      <ol aria-label={label} className={cn('flex flex-col gap-4', hasRow ? 'mt-4' : 'mt-6')}>
        {cards.map(({ id, node }) => (
          <li key={id} hidden={!shown.has(id)} className={CARD}>
            {node}
          </li>
        ))}
      </ol>
    </>
  );
}
