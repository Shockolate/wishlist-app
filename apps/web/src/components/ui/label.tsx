import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-[15px] font-semibold', className)} {...props} />;
}
