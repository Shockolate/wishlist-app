import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { ConfirmEmailNotice } from '@/components/confirm-email-notice';
import { GiftsList } from '@/components/gifts/gifts-list';
import { loadGifts } from '@/lib/gifts.server';
import { requireMe } from '@/lib/require-me';

export const metadata: Metadata = { title: 'Your gifts' };

const MAIN = 'mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7';

/**
 * What a signed-in gifter is getting, across lists (design §5.7). An unconfirmed email gets the
 * notice instead: the API would refuse, and a claim only links for a confirmed one.
 */
export default async function GiftsPage() {
  const me = await requireMe('/gifts');
  if (!me.emailVerified) {
    return (
      <>
        <AccountHeader current="gifts" />
        <main className={MAIN}>
          <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Your gifts</h1>
          <ConfirmEmailNotice email={me.email} to="to see your gifts" />
        </main>
      </>
    );
  }
  const { gifts, gone } = await loadGifts('/gifts');
  return (
    <>
      <AccountHeader current="gifts" />
      <main className={MAIN}>
        <GiftsList gifts={gifts} gone={gone} />
      </main>
    </>
  );
}
