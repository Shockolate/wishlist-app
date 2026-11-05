'use client';

import { ErrorCode, WishlistSettingsResponseSchema } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateCachedList } from '@/components/query-provider';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { errorMessage, hasCode } from '@/lib/messages';
import { LOGIN_AGAIN } from './name-form';

/**
 * The price-conversion setting (price conversion design §5.1). Like `SuggestTagsCard` it saves
 * without a confirm dialog: turning it off changes only the next item added, never a saved price.
 */
export function ConvertPricesCard({ convertPrices }: { convertPrices: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(convertPrices);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setFormError(null);
    setOn(next);
    try {
      const settings = await browserApi.patch(
        '/wishlist',
        { convertPrices: next },
        WishlistSettingsResponseSchema,
      );
      // A field the API didn't send means its default, on, as on the settings page.
      const saved = settings.convertPrices !== false;
      setOn(saved);
      updateCachedList((list) => ({ ...list, convertPrices: saved }));
      setMessage((last) => ({
        text: saved
          ? 'Hanker will convert prices to dollars.'
          : 'Prices will stay in the shop’s currency.',
        id: (last?.id ?? 0) + 1,
      }));
      // Drops the router cache's copy of this page, so Back to Settings doesn't seed the old value.
      router.refresh();
    } catch (error) {
      if (hasCode(error, ErrorCode.UNAUTHENTICATED)) {
        window.location.replace(LOGIN_AGAIN);
        return;
      }
      // The server still has the old setting.
      setOn(!next);
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-labelledby="convert-prices-heading">
      <h2 id="convert-prices-heading" className="font-display text-3xl">
        Prices
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        When a shop lists a price in another currency, Hanker converts it to US dollars as you add
        the item, using that day’s exchange rate. Prices you’ve saved don’t change.
      </p>
      <div className="mt-4 flex min-h-11 items-center gap-3">
        <span id="convert-prices-switch-label" className="flex-1 text-[15px] font-semibold">
          Convert prices to dollars
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="convert-prices-switch-label"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) void save(!on);
          }}
          className="group inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border-[1.5px] border-input bg-card p-[3px] aria-disabled:opacity-60 aria-checked:border-foreground aria-checked:bg-foreground"
        >
          <span className="size-6 rounded-full bg-input transition-transform group-aria-checked:translate-x-5 group-aria-checked:bg-background motion-reduce:transition-none" />
        </button>
      </div>
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
