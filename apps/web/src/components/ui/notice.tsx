import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A short message about what just happened. Success is sage with a check. An error is announced
 * at once (role="alert"); anything else politely (role="status").
 */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-control px-3.5 py-2.5 text-[15px] leading-snug',
        tone === 'success' && 'bg-success-wash font-medium text-success-foreground',
        tone === 'error' && 'border border-destructive bg-card font-medium text-destructive',
        tone === 'info' && 'border border-border bg-card',
        className,
      )}
    >
      {tone === 'success' ? (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-4 shrink-0">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            fill="none"
            stroke="var(--success)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <div>{children}</div>
    </div>
  );
}
