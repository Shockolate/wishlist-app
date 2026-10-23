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
 * The tag-suggestion setting (tag suggestions design §5.2, Plan 9 ruling 8). Unlike `ClaimsCard`
 * it saves without a confirm dialog, because suggestions spoil nothing, and so there's no
 * claim cache to drop either.
 */
export function SuggestTagsCard({ suggestTags }: { suggestTags: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(suggestTags);
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
        { suggestTags: next },
        WishlistSettingsResponseSchema,
      );
      // A field the API didn't send means its default, on, as on the settings page.
      const saved = settings.suggestTags !== false;
      setOn(saved);
      updateCachedList((list) => ({ ...list, suggestTags: saved }));
      setMessage((last) => ({
        text: saved ? 'Hanker will suggest tags.' : 'Tag suggestions are off.',
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
    <Card aria-labelledby="suggest-tags-heading">
      <h2 id="suggest-tags-heading" className="font-display text-3xl">
        Tag suggestions
      </h2>
      <p className="mt-1.5 text-[15px] text-muted-foreground">
        When you add or edit an item, Hanker asks Cloudflare’s AI to suggest tags from its title,
        note and shop details. Cloudflare doesn’t keep or learn from them.
      </p>
      <div className="mt-4 flex min-h-11 items-center gap-3">
        <span id="suggest-tags-switch-label" className="flex-1 text-[15px] font-semibold">
          Suggest tags
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="suggest-tags-switch-label"
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
