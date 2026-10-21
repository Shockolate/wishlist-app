import { cn } from '@/lib/utils';

// The filter row's pills (design §4, mockup A "charcoal when active"): parchment off, espresso on,
// never terracotta. The button is the 44px hit area; the pill drawn inside it is 40px tall.

/** The button around a pill. Its focus ring follows the pill's round ends. */
export const PILL_HIT =
  'group inline-flex min-h-11 shrink-0 items-center rounded-full disabled:pointer-events-none disabled:opacity-50';

/** The pill itself, off or on. */
export function pillFace(on: boolean, outlined = false): string {
  return cn(
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium whitespace-nowrap transition-colors duration-150',
    on
      ? 'border-foreground bg-foreground text-background'
      : outlined
        ? 'border-input bg-transparent text-foreground'
        : 'border-input/30 bg-placeholder text-foreground',
  );
}

/** A pill's count: small, tabular, muted; lighter and warm on espresso. */
export function pillCount(on: boolean): string {
  return cn('text-xs tabular-nums', on ? 'text-placeholder/80' : 'text-muted-foreground');
}
