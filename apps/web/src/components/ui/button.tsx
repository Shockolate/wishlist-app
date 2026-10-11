import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Terracotta for the main action, with espresso text (5.5:1); white on terracotta fails AA. */
const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control px-5 text-[15px] font-semibold no-underline transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[0_8px_18px_rgba(30,27,24,0.16)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 motion-reduce:hover:translate-y-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground',
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
