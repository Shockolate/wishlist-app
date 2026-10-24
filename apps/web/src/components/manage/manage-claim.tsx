'use client';

import type { ClaimDetailsResponse } from '@wishlist/contracts';
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, EyeOffIcon } from '@/components/list/icons';
import { CARD, ItemCardBody } from '@/components/share/share-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveRecord, updateRecords } from '@/lib/claim-records';
import { ownerSeesLine, yourClaimLine } from '@/lib/share-copy';
import { useFocusOnMount } from '@/lib/use-focus-on-mount';
import { cn } from '@/lib/utils';
import { CancelClaim } from './cancel-claim';
import { ChangeClaimForm } from './change-claim-form';
import { ClaimGone } from './claim-gone';
import { ClaimLink } from './claim-link';

/** One claim, by its manage link (spec §2, §7, the Plan 4b mockups). */
export function ManageClaim({
  details,
  manageToken,
}: {
  details: ClaimDetailsResponse;
  manageToken: string;
}) {
  const [state, setState] = useState<'open' | 'cancelled' | 'gone'>('open');

  // This device now knows the claim, so its share page shows it too (D45).
  useEffect(() => {
    updateRecords((all) =>
      saveRecord(all, { itemId: details.item.id, manageToken, claimId: details.claim.id }),
    );
  }, [details.item.id, details.claim.id, manageToken]);

  if (state === 'cancelled') return <ClaimCancelled details={details} />;
  if (state === 'gone') return <GoneNow />;
  return (
    <>
      <ClaimLink manageToken={manageToken} link={details.link} />
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Your claim</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        On{' '}
        <a
          href={details.shareUrl}
          className="inline-flex min-h-11 items-center font-medium text-foreground underline [overflow-wrap:anywhere]"
        >
          {details.wishlistTitle}
        </a>
      </p>
      <article aria-labelledby={`item-${details.item.id}`} className={cn(CARD, 'mt-3')}>
        <ItemCardBody
          item={details.item}
          footer={
            <p className="mt-3 flex items-center gap-2 rounded-control bg-success-wash px-3.5 py-2.5 text-[15px] font-medium text-success-foreground">
              <CheckIcon />
              {yourClaimLine(
                details.claim.quantity,
                details.item.quantity,
                details.ownerDisplayName,
              )}
            </p>
          }
        />
      </article>
      <ChangeClaimForm
        details={details}
        manageToken={manageToken}
        onGone={() => setState('gone')}
      />
      <p className="mt-5 flex items-start gap-2 text-sm leading-snug text-muted-foreground">
        {details.ownerSeesClaims ? null : <EyeOffIcon />}
        {ownerSeesLine(details.ownerDisplayName, details.ownerSeesClaims)}
      </p>
      <PageLink manageToken={manageToken} />
      <CancelClaim
        details={details}
        manageToken={manageToken}
        onCancelled={() => setState('cancelled')}
        onGone={() => setState('gone')}
      />
    </>
  );
}

/** Copy this page's own link: the only way back from another device (spec §7). */
function PageLink({ manageToken }: { manageToken: string }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const say = (text: string) => setMessage((last) => ({ text, id: (last?.id ?? 0) + 1 }));
  async function copy() {
    const url = `${window.location.origin}/c/${manageToken}`;
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied.');
    } catch {
      say(`Copy this link: ${url}`);
    }
  }
  return (
    <section aria-labelledby="page-link-heading" className="mt-6">
      <h2 id="page-link-heading" className="text-[15px] font-semibold">
        This page’s link
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        It’s the only way back to your claim from another phone or computer.
      </p>
      <Button variant="secondary" size="compact" className="mt-3" onClick={() => void copy()}>
        <CopyIcon />
        Copy link
      </Button>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-3">
            {message.text}
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

/** Shown in the browser: a refresh would fetch a link that no longer works (spec §7). */
function ClaimCancelled({ details }: { details: ClaimDetailsResponse }) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="pt-6">
      <h1
        ref={heading}
        tabIndex={-1}
        className="font-display text-[clamp(2.5rem,6vw,3.5rem)] leading-tight focus:outline-none"
      >
        Your claim is cancelled.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {details.item.title} is back on {details.ownerDisplayName}’s list for someone else to get.
        This page’s link no longer works.
      </p>
      <a
        href={details.shareUrl}
        className={cn(
          buttonVariants({ variant: 'secondary' }),
          'mt-7 w-full [overflow-wrap:anywhere]',
        )}
      >
        Back to {details.wishlistTitle}
      </a>
    </div>
  );
}

function GoneNow() {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="pt-6">
      <ClaimGone headingRef={heading} />
    </div>
  );
}
