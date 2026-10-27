import Link from 'next/link';

const LINK = 'inline-flex min-h-11 items-center text-[15px] underline';

/** The header outside the account pages: the wordmark, and the one link the page needs. */
export function SiteHeader({
  action = 'login',
}: {
  action?: 'login' | 'signup' | 'list' | 'none';
}) {
  return (
    <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 pt-6 sm:px-7">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-display text-[34px] leading-none no-underline"
      >
        Hanker
      </Link>
      {action === 'login' ? (
        <Link href="/login" className={LINK}>
          Sign in
        </Link>
      ) : null}
      {action === 'signup' ? (
        <Link href="/signup" className={LINK}>
          Create your list
        </Link>
      ) : null}
      {action === 'list' ? (
        <Link href="/list" className={LINK}>
          Edit your list
        </Link>
      ) : null}
    </header>
  );
}
