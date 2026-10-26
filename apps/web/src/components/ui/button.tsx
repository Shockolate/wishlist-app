import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Terracotta for the main action, with white text (6.3:1), darkening to rust on hover and press.
 *
 * A focused primary button gets a dual-layer ring (D89): a white band against the button, then the
 * espresso ring. The band keeps the ring off terracotta wherever the button sits. The shadow
 * replaces the base outline, which stays as a transparent outline at the same place, because
 * forced-colors mode drops shadows and draws the outline in a system color.
 *
 * Hovering lifts a button 1px, and only while hovered an empty strip (`after:`) fills the gap the
 * lift opens below it. So the hovered button covers everywhere the resting one did: otherwise a
 * pointer on the bottom edge would hover, lift the edge off itself, unhover and drop it, every
 * frame. A strip that was always there would only move that edge 1px lower. It's 2px because
 * `top-full` starts inside the bottom border: 1px of it covers a bordered button's border.
 */
const variants = cva(
  'relative inline-flex items-center justify-center gap-2 rounded-control px-5 text-[15px] font-semibold no-underline transition-[background-color,box-shadow,transform] duration-200 after:absolute after:inset-x-0 after:top-full hover:-translate-y-px hover:after:h-0.5 hover:shadow-[0_8px_18px_rgba(30,27,24,0.16)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:shadow-[0_0_0_2px_var(--primary-foreground),0_0_0_4px_var(--ring)] focus-visible:outline-transparent active:bg-primary-hover',
        secondary: 'border border-border bg-card text-foreground',
        strong: 'bg-foreground text-background',
        link: 'px-0 font-medium underline hover:translate-y-0 hover:shadow-none',
      },
      size: {
        default: 'min-h-12',
        compact: 'min-h-11 px-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export type ButtonVariantProps = VariantProps<typeof variants>;

/** Class names for a button-styled element; conflicting classes resolve the way the variant intends. */
export function buttonVariants(props?: ButtonVariantProps): string {
  return cn(variants(props));
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ComponentProps<'button'> & ButtonVariantProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
