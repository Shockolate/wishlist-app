import type { ReactNode } from 'react';
import { SiteHeader } from './site-header';

/** The frame for a signed-out page: the header with one account link, and the content. */
export function AuthPage({
  action,
  children,
}: {
  action: 'login' | 'signup' | 'none';
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader action={action} />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-7">{children}</main>
    </>
  );
}
