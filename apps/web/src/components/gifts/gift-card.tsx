'use client';

import { ErrorCode, GiftSchema, type Gift } from '@wishlist/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ExternalIcon, IdeaIcon, PhotoIcon } from '@/components/list/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { browserApi } from '@/lib/browser-api';
import { giftLine } from '@/lib/gifts-copy';
import { errorMessage, hasCode } from '@/lib/messages';
import { cn } from '@/lib/utils';
import { ChangeGiftForm } from './change-gift-form';

/**
 * One claim on Your gifts (design §5.7, mockup A): the item as the share page shows it, the
 * gifter's own line, the owner's note, Shop, and the private Bought tick. Bought saves at once, and
 * sage means it is on.
 */
export function GiftCard({ gift }: { gift: Gift }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What was asked, kept until the refresh brings the server's own answer in `gift.bought`. It
  // remembers which server value it was made against, so a newer one wins without an effect.
  const [asked, setAsked] = useState<{ from: boolean; bought: boolean } | null>(null);
  const [changing, setChanging] = useState(false);
  // Close and Save hand focus back to Change, which is only on the card while the form is shut.
  const change = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!changing && refocus.current) {
      refocus.current = false;
      change.current?.focus();
    }
  }, [changing]);
  const bought = asked?.from === gift.bought ? asked.bought : gift.bought;
  const { item } = gift;

  async function tick(next: boolean) {
    setSaving(true);
    setError(null);
    setAsked({ from: gift.bought, bought: next });
    try {
      await browserApi.patch(`/me/gifts/${gift.linkId}`, { bought: next }, GiftSchema);
      router.refresh();
    } catch (failure) {
      // The box goes back to what the server last said.
      setAsked(null);
      // A 404 means the claim went meanwhile (Plan 10b ruling 9): the refresh turns this card
      // into a note, which says so better than an error would.
      if (hasCode(failure, ErrorCode.NOT_FOUND)) router.refresh();
      else setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      className={cn(
        'rounded-card border p-3.5',
        bought ? 'border-success bg-success-wash' : 'border-border bg-card',
      )}
    >
      <div className="flex gap-3">
        <Thumb src={item.imageUrl} idea={item.url === null} />
        <div className="min-w-0">
          <h3 className="text-[17px] leading-snug font-semibold [overflow-wrap:anywhere]">
            {item.title}
          </h3>
          <p className="mt-0.5 text-[15px] text-muted-foreground [overflow-wrap:anywhere]">
            {giftLine(gift)}
          </p>
        </div>
      </div>
      {item.note ? (
        <p className="mt-2.5 rounded-control bg-background px-3 py-2 text-[15px] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">
          {item.note}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'primary', size: 'compact' })}
          >
            Shop
            <ExternalIcon />
          </a>
        ) : null}
        <label
          className={cn(
            'inline-flex min-h-11 cursor-pointer items-center gap-2 text-[15px] font-medium has-disabled:cursor-default',
            bought && 'text-success-foreground',
          )}
        >
          <input
            type="checkbox"
            checked={bought}
            disabled={saving}
            onChange={(event) => void tick(event.target.checked)}
            className="size-5 shrink-0 accent-success-foreground"
          />
          Bought
        </label>
        {changing ? null : (
          <Button
            ref={change}
            variant="secondary"
            size="compact"
            className="ml-auto"
            onClick={() => setChanging(true)}
          >
            Change
            <span className="sr-only"> {item.title}</span>
          </Button>
        )}
      </div>
      {changing ? (
        <ChangeGiftForm
          gift={gift}
          onClose={() => {
            refocus.current = true;
            setChanging(false);
          }}
        />
      ) : null}
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </li>
  );
}

/** The 64px photo, or a tile for an idea. A photo that won't load becomes the tile (Plan 3b rule 10). */
function Thumb({ src, idea }: { src: string | null; idea: boolean }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- photos come from any https host; next/image would fetch them through our server, which spec §2 rules out.
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-16 shrink-0 rounded-control bg-placeholder object-cover"
      />
    );
  }
  return (
    <div className="flex size-16 shrink-0 items-center justify-center rounded-control bg-placeholder text-muted-foreground">
      {idea ? <IdeaIcon /> : <PhotoIcon />}
    </div>
  );
}
