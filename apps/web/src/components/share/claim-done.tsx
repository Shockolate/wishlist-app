'use client';

import type { CreateClaimResponse } from '@wishlist/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { CopyIcon, ShareIcon } from '@/components/list/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { SheetClose } from '@/components/ui/sheet';
import { SEE_GIFTS } from '@/lib/gifts-copy';
import { useCanShare } from '@/lib/use-can-share';

/** After a claim (spec §7 step 2): the manage link, to copy or share, and the way back. */
export function ClaimDone({
  claim,
  itemTitle,
  ownerName,
}: {
  claim: CreateClaimResponse;
  itemTitle: string;
  ownerName: string;
}) {
  const canShare = useCanShare();
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const say = (text: string) => setMessage((last) => ({ text, id: (last?.id ?? 0) + 1 }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(claim.manageUrl);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${claim.manageUrl}`);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `Your claim: ${itemTitle}`, url: claim.manageUrl });
    } catch (error) {
      // Closing the share sheet rejects with AbortError: the person chose not to share.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await copy();
    }
  }

  return (
    <>
      <p className="mt-5 text-base font-semibold">Save this link to change or cancel your claim.</p>
      <p className="mt-2 rounded-control border-[1.5px] border-input bg-card px-3.5 py-3 text-[15px] [overflow-wrap:anywhere]">
        {claim.manageUrl}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="compact" onClick={() => void copy()}>
          <CopyIcon />
          Copy link
        </Button>
        {canShare ? (
          <Button variant="secondary" size="compact" onClick={() => void share()}>
            <ShareIcon />
            Share
          </Button>
        ) : null}
        {claim.onYourGifts ? (
          <Link href="/gifts" className={buttonVariants({ variant: 'secondary', size: 'compact' })}>
            {SEE_GIFTS}
          </Link>
        ) : null}
      </div>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-3">
            {message.text}
          </Notice>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-snug text-muted-foreground">
        This browser remembers your claim too, but only the link works on another phone or computer.
        Send it to yourself, or keep it with your notes.
      </p>
      <SheetClose asChild>
        <Button variant="secondary" className="mt-6 w-full">
          Back to {ownerName}’s list
        </Button>
      </SheetClose>
    </>
  );
}
