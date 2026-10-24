import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { ConfirmEmailNotice } from '@/components/confirm-email-notice';
import { ListEditor } from '@/components/list/list-editor';
import { QueryProvider } from '@/components/query-provider';
import { requireMe } from '@/lib/require-me';
import { loadWishlist } from '@/lib/wishlist.server';

export const metadata: Metadata = { title: 'Your list' };

const MAIN = 'mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7';

/** The owner's list (spec §7). An unconfirmed email gets the notice instead: the API would refuse. */
export default async function ListPage() {
  const me = await requireMe('/list');
  if (!me.emailVerified) {
    return (
      <>
        <AccountHeader current="list" />
        <main className={MAIN}>
          <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">
            Hello, {me.displayName}.
          </h1>
          <ConfirmEmailNotice email={me.email} to="to start your list" />
        </main>
      </>
    );
  }
  const list = await loadWishlist('/list');
  return (
    <>
      <AccountHeader current="list" />
      <main className={MAIN}>
        <QueryProvider userId={me.id}>
          <ListEditor initial={list} />
        </QueryProvider>
      </main>
    </>
  );
}
