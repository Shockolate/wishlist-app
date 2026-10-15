'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;

/**
 * A modal dialog that rises from the bottom of the screen (spec §7 Claim flow). Radix traps focus,
 * closes on Escape, and marks the rest of the page inert.
 */
export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[calc(100dvh-2rem)] w-full max-w-[680px] overflow-y-auto rounded-t-card border-t border-border bg-background px-4 pt-2 pb-6 sm:px-7',
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-input" />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        'font-display text-[32px] leading-tight [overflow-wrap:anywhere] focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1.5 text-[15px] leading-snug text-muted-foreground', className)}
      {...props}
    />
  );
}
