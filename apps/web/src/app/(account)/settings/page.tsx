import type { Metadata } from 'next';
import { AccountHeader } from '@/components/account-header';
import { DeleteAccountForm } from '@/components/account/delete-account-form';
import { NameForm } from '@/components/account/name-form';
import { PasswordForm } from '@/components/account/password-form';
import { requireMe } from '@/lib/require-me';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const me = await requireMe('/settings');
  return (
    <>
      <AccountHeader current="settings" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Settings</h1>
        <p className="mt-2.5 text-muted-foreground">Signed in as {me.email}</p>
        <div className="mt-10 flex flex-col gap-5">
          <NameForm displayName={me.displayName} />
          <PasswordForm />
          <DeleteAccountForm />
        </div>
      </main>
    </>
  );
}
