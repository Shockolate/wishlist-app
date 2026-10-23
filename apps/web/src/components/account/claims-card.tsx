'use client';

import { ErrorCode, WishlistSettingsResponseSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  hideCachedClaims,
  invalidateCachedList,
  updateCachedList,
} from '@/components/query-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/**
 * The spoiler setting (spec §2 Spoilers, D33). Turning it on asks first; turning it off doesn't,
 * and drops the claims this browser holds before the request returns (Plan 4b rule 12).
 */
export function ClaimsCard({ showClaimsToOwner }: { showClaimsToOwner: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(showClaimsToOwner);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  async function save(next: boolean) {
    setBusy(true);
    setFormError(null);
    setOn(next);
    if (!next) await hideCachedClaims();
    try {
      const settings = await browserApi.patch(
        '/wishlist',
        { showClaimsToOwner: next },
        WishlistSettingsResponseSchema,
      );
      const savedOn = settings.showClaimsToOwner === true;
      setOn(savedOn);
      if (savedOn) {
        updateCachedList((list) => ({ ...list, showClaimsToOwner: true }));
      }
      // On: fetch the totals. Off: fetch the list again, so it is the server's, not the strip's.
      invalidateCachedList();
      setMessage((last) => ({
        text: savedOn ? 'You’ll see how many are claimed.' : 'Claims are hidden from you again.',
        id: (last?.id ?? 0) + 1,
      }));
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      // The server still has the old setting: the refetch brings the list back in line with it.
      setOn(!next);
      invalidateCachedList();
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="claims-heading">
      <h2 id="claims-heading" className="font-display text-3xl">
        Claims
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        {on
          ? 'You can see how many of each item are claimed, on your list and on your share page, but never who claimed them. Gifters are told you can see the counts.'
          : 'Gifters claim items so nobody buys the same thing twice. You can’t see their claims, so your gifts stay a surprise.'}
      </p>
      <div className="mt-4 flex min-h-11 items-center gap-3">
        <span id="claims-switch-label" className="flex-1 text-[15px] font-semibold">
          Show how many are claimed
        </span>
        <button
          ref={toggle}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="claims-switch-label"
          // Not `disabled`: the confirm dialog hands focus back to this switch as it closes, which is
          // after "Show me" has set `busy`, and a disabled button can't take focus.
          aria-disabled={busy}
          onClick={() => {
            if (busy) return;
            if (on) void save(false);
            else setConfirming(true);
          }}
          className="group inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-[1.5px] border-input bg-card p-[3px] aria-disabled:opacity-60 aria-checked:border-foreground aria-checked:bg-foreground"
        >
          <span className="size-6 rounded-full bg-input transition-transform group-aria-checked:translate-x-5 group-aria-checked:bg-background motion-reduce:transition-none" />
        </button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            toggle.current?.focus();
          }}
        >
          <AlertDialogTitle>See how many are claimed?</AlertDialogTitle>
          <AlertDialogDescription>
            Your list and your share page will show how many of each item are claimed. You’ll never
            see who claimed them. Gifters will see a note that you can see the counts. You can turn
            this off again, but you can’t unsee what you’ve seen.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it a surprise</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save(true)}>Show me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div role="status">
        {message ? (
          <Notice key={message.id} tone="success" announce={false} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </div>
      {formError ? (
        <Notice tone="error" className="mt-4">
          {formError}
        </Notice>
      ) : null}
    </Card>
  );
}
