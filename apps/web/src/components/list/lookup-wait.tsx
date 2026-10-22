'use client';

import { Button } from '@/components/ui/button';
import { AMAZON_WAIT_HINT, SKIP_LOOKUP } from '@/lib/messages';

/**
 * The add box's waiting panel for an Amazon link (retailer lookups §5.5, mockup B). The status line
 * above the box says what's happening; this says how long it can take and offers a way out. The
 * spinner is decoration (terracotta carries no text here), and it stays still for reduced motion.
 */
export function LookupWait({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-control bg-background p-3">
      <span
        aria-hidden="true"
        className="size-[22px] shrink-0 rounded-full border-[3px] border-muted-foreground/25 border-t-primary motion-safe:animate-spin"
      />
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{AMAZON_WAIT_HINT}</p>
      <Button type="button" variant="link" size="compact" onClick={onSkip}>
        {SKIP_LOOKUP}
      </Button>
    </div>
  );
}
