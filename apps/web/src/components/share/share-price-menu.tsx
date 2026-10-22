'use client';

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronDownIcon } from '@/components/list/icons';
import { tagChipLabel } from '@/lib/share-copy';
import { BANDS, bandLabel, joinedBandLabel, type BandId } from '@/lib/share-filters';
import { cn } from '@/lib/utils';
import { PILL_HIT, pillCount, pillFace } from './filter-pill';

// The price pill and its menu (Plan 7b ruling 3): a hand-rolled disclosure, since no popover is
// installed. The pill sits in the row, which scrolls sideways and so would clip anything hanging
// out of it; the panel is therefore a sibling of the row, and focus moves into it on opening so
// Tab doesn't skip past it to the chips.

export interface PriceMenu {
  open: boolean;
  panelId: string;
  pillRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  toggle(): void;
}

/** The menu's open state. Escape and the pill close it and give focus back to the pill; a click
 * or focus anywhere else closes it and leaves focus where it went. */
export function usePriceMenu(): PriceMenu {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback(() => {
    setOpen((was) => !was);
    pillRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (panelRef.current?.contains(target) === true || pillRef.current?.contains(target) === true);
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      pillRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, panelId, pillRef, panelRef, toggle };
}

/** "Any price ▾", outlined; once a band is on, the joined band label on espresso. */
export function PricePill({
  ref,
  open,
  panelId,
  onToggle,
  bands,
  currency,
}: {
  ref: RefObject<HTMLButtonElement | null>;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  bands: readonly BandId[];
  currency: string;
}) {
  const on = bands.length > 0;
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={PILL_HIT}
    >
      <span className={cn(pillFace(on, true), 'pr-3')}>
        {on ? (
          <>
            <span className="sr-only">Price: </span>
            {joinedBandLabel(bands, currency)}
          </>
        ) : (
          'Any price'
        )}
        <span className="transition-transform duration-150 group-aria-expanded:rotate-180">
          <ChevronDownIcon />
        </span>
      </span>
    </button>
  );
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-[15px] hover:bg-placeholder';

/**
 * The menu: "Any price" (clears the bands), then each band as a checkbox with its count. It stays
 * open while bands are ticked.
 */
export function PricePanel({
  ref,
  open,
  panelId,
  bands,
  currency,
  anyCount,
  countOf,
  onToggle,
  onAny,
}: {
  ref: RefObject<HTMLDivElement | null>;
  open: boolean;
  panelId: string;
  bands: readonly BandId[];
  currency: string;
  anyCount: number;
  countOf: (band: BandId) => number;
  onToggle: (band: BandId) => void;
  onAny: () => void;
}) {
  const titleId = useId();
  const anyRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div
      ref={ref}
      id={panelId}
      hidden={!open}
      role="group"
      aria-labelledby={titleId}
      className="absolute top-full left-0 z-20 mt-1 w-72 max-w-full rounded-card border border-input/30 bg-card p-2 shadow-[0_12px_32px_rgba(30,27,24,0.16)]"
    >
      <p id={titleId} className="px-3 pt-1 pb-1.5 text-[13px] font-semibold text-muted-foreground">
        Price
      </p>
      <button
        ref={anyRef}
        type="button"
        aria-pressed={bands.length === 0}
        aria-label={tagChipLabel('Any price', anyCount)}
        onClick={onAny}
        className={cn(ROW, bands.length === 0 && 'font-semibold')}
      >
        {/* The space keeps the visible text within the aria-label (WCAG 2.5.3). */}
        <span className="flex-1">Any price</span>{' '}
        <span className={pillCount(false)}>{anyCount}</span>
      </button>
      <ul>
        {BANDS.map(({ id }) => {
          const count = countOf(id);
          const on = bands.includes(id);
          const label = bandLabel(id, currency);
          return (
            <li key={id}>
              <label
                className={cn(
                  ROW,
                  'cursor-pointer has-disabled:cursor-default has-disabled:opacity-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={count === 0 && !on}
                  aria-label={tagChipLabel(label, count)}
                  onChange={() => {
                    // A band a refresh has emptied is disabled once it's off, which would drop
                    // focus to the page; "Any price" is always enabled.
                    if (on && count === 0) anyRef.current?.focus();
                    onToggle(id);
                  }}
                  className="size-5 shrink-0 accent-foreground"
                />
                <span className="flex-1">{label}</span>
                <span className={pillCount(false)}>{count}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
