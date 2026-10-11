import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountHeader } from '@/components/account-header';
import { Notice } from '@/components/ui/notice';
import { requireMe } from '@/lib/require-me';

export const metadata: Metadata = { title: 'Your list' };

/** The signed-in home until Plan 3 brings the list editor (rule 10). */
export default async function ListPage() {
  const me = await requireMe('/list');
  return (
    <>
      <AccountHeader current="list" />
      <main className="mx-auto max-w-[680px] px-4 pb-24 pt-14 sm:px-7">
        <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">
          Hello, {me.displayName}.
        </h1>
        {me.emailVerified ? null : (
          <Notice tone="info" className="mt-6">
            Confirm your email to start your list. We sent a link to <strong>{me.email}</strong>.{' '}
            <Link href="/verify-email" className="underline">
              Send a new link
            </Link>
          </Notice>
        )}
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Your list comes next: soon you’ll add the things you’d love here and share one link with
          family and friends. Until then, you can manage your account in{' '}
          <Link href="/settings" className="text-foreground underline">
            Settings
          </Link>
          .
        </p>
      </main>
    </>
  );
}
