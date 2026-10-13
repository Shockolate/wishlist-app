import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[17px] leading-snug text-foreground aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
