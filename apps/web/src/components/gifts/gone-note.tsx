'use client';

import { ErrorCode, type GoneGift } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { goneLine } from '@/lib/gifts-copy';
import { errorMessage, hasCode } from '@/lib/messages';

/** Where focus goes when a note clears and its button goes with it. */
export const GIFTS_HEADING_ID = 'gifts-heading';

/**
 * What is left of a claim that went (design §5.6): a dashed card with the item's title as Your
 * gifts last showed it, why it went, and Clear. A note not cleared goes by itself after 30 days.
 */
export function GoneNote({ note }: { note: GoneGift }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await browserApi.delete(`/me/gifts/${note.linkId}`, NoContentSchema);
    } catch (failure) {
      // Already cleared elsewhere: the refresh drops it all the same.
      if (!hasCode(failure, ErrorCode.NOT_FOUND)) {
        setError(errorMessage(failure));
        setBusy(false);
        return;
      }
    }
    // The card and its button are about to go, so focus moves somewhere that stays.
    document.getElementById(GIFTS_HEADING_ID)?.focus();
    router.refresh();
  }

  return (
    <li className="rounded-card border border-dashed border-border bg-background p-3.5">
      <h3 className="text-[17px] leading-snug font-semibold [overflow-wrap:anywhere]">
        {note.itemTitle}
      </h3>
      <p className="mt-0.5 text-[15px] font-medium text-destructive [overflow-wrap:anywhere]">
        {goneLine(note)}
      </p>
      <div className="mt-2 flex justify-end">
        <Button variant="secondary" size="compact" disabled={busy} onClick={() => void clear()}>
          Clear
          <span className="sr-only"> note about {note.itemTitle}</span>
        </Button>
      </div>
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </li>
  );
}
