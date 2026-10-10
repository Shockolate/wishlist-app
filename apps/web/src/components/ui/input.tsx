import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-control border-[1.5px] border-input bg-card px-3.5 text-[17px] text-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
