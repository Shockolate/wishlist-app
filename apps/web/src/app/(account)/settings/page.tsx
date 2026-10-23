import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { DeleteAccountForm } from '@/components/account/delete-account-form';
import { ClaimsCard } from '@/components/account/claims-card';
import { ListNameForm } from '@/components/account/list-name-form';
import { NameForm } from '@/components/account/name-form';
import { PasswordForm } from '@/components/account/password-form';
import { ShareLinkCard } from '@/components/account/share-link-card';
import { SuggestTagsCard } from '@/components/account/suggest-tags-card';
import { requireMe } from '@/lib/require-me';
import { loadWishlist } from '@/lib/wishlist.server';

export const metadata: Metadata = { title: 'Settings' };

/** Account and list settings (spec §7). The list's cards need a confirmed email, as the API does. */
export default async function SettingsPage() {
  const me = await requireMe('/settings');
  const list = me.emailVerified ? await loadWishlist('/settings') : null;
  return (
    <>
      <AccountHeader current="settings" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Settings</h1>
        <p className="mt-2.5 text-muted-foreground">Signed in as {me.email}</p>
        <div className="mt-10 flex flex-col gap-5">
          <NameForm displayName={me.displayName} />
          {list ? (
            <>
              <ListNameForm title={list.title} />
              <ShareLinkCard shareUrl={list.shareUrl} />
              <ClaimsCard showClaimsToOwner={list.showClaimsToOwner === true} />
              <SuggestTagsCard suggestTags={list.suggestTags !== false} />
            </>
          ) : null}
          <PasswordForm />
          <DeleteAccountForm />
        </div>
      </main>
    </>
  );
}
