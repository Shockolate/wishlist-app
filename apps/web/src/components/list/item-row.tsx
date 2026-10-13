import type { Item } from '@wishlist/contracts';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode, Ref } from 'react';
import { shopName } from '@/lib/item-display';
import { cn } from '@/lib/utils';
import { ChevronDownIcon, ChevronUpIcon, GripIcon } from './icons';
import { ItemPhoto } from './item-photo';

const ARROW = 'inline-flex size-11 items-center justify-center rounded-control disabled:opacity-30';

/**
 * One row of the list (D37). The handle drags it, and only the handle: touch-action is off there
 * alone, so a thumb can still scroll the page anywhere else (Plan 3b rule 12). The arrows move it
 * one place. While its form is open, it can't be dragged.
 */
export function ItemRow({
  item,
  index,
  count,
  open,
  onToggle,
  onMove,
  titleButtonRef,
  arrowRef,
  children,
}: {
  item: Item;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onMove: (step: -1 | 1) => void;
  titleButtonRef: Ref<HTMLButtonElement>;
  arrowRef: (which: 'up' | 'down') => Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: open });
  const formId = `edit-${item.id}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative border-t border-foreground/15 bg-card first:border-t-0',
        open && 'bg-background shadow-[inset_3px_0_0_var(--foreground)]',
        isDragging && 'z-10 shadow-[0_8px_18px_rgba(30,27,24,0.16)]',
      )}
    >
      <div className="flex items-center gap-1 py-2 pr-1 pl-0.5">
        {open ? (
          <span className="size-11 shrink-0" />
        ) : (
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag “${item.title}” to reorder`}
            className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted-foreground"
          >
            <GripIcon />
          </button>
        )}
        <ItemPhoto item={item} />
        <button
          ref={titleButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? formId : undefined}
          onClick={onToggle}
          className="min-h-14 min-w-0 flex-1 rounded-control px-1.5 text-left"
        >
          <ItemSummary item={item} />
        </button>
        <div className="flex shrink-0 flex-col">
          <button
            ref={arrowRef('up')}
            type="button"
            aria-label={`Move “${item.title}” up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className={ARROW}
          >
            <ChevronUpIcon />
          </button>
          <button
            ref={arrowRef('down')}
            type="button"
            aria-label={`Move “${item.title}” down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            className={ARROW}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>
      {open ? <div id={formId}>{children}</div> : null}
    </li>
  );
}

/** The title and its details: price, how many, the shop, or what the idea is. */
export function ItemSummary({ item }: { item: Item }) {
  const shop = shopName(item.url);
  return (
    <>
      <span className="block text-base leading-snug font-semibold [overflow-wrap:anywhere]">
        {item.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
        {item.priceText ? <span className="text-foreground">{item.priceText}</span> : null}
        {item.quantity > 1 ? (
          <span className="rounded-full border border-border px-2 text-[13px] text-foreground">
            {item.quantity} wanted
          </span>
        ) : null}
        {shop ? <span className="[overflow-wrap:anywhere]">{shop}</span> : null}
        {item.url === null ? (
          <span className="block w-full truncate">
            {item.note ? `An idea: ${item.note}` : 'An idea'}
          </span>
        ) : null}
      </span>
    </>
  );
}
