'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NoContentSchema } from '@/lib/api-client';
import { browserApi } from '@/lib/browser-api';
import { cn } from '@/lib/utils';

/** The signed-in header: the wordmark, the two account pages, and Log out. */
export function AccountHeader({ current }: { current: 'list' | 'settings' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    try {
      await browserApi.post('/auth/logout', {}, NoContentSchema);
    } finally {
      router.replace('/');
    }
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-7">
        <Link href="/list" className="font-display text-[30px] leading-none no-underline">
          Hanker
        </Link>
        <nav aria-label="Main" className="flex flex-1 gap-1.5 text-[15px] font-medium">
          <NavLink href="/list" current={current === 'list'}>
            Your list
          </NavLink>
          <NavLink href="/settings" current={current === 'settings'}>
            Settings
          </NavLink>
        </nav>
        <Button variant="secondary" size="compact" onClick={logOut} disabled={busy}>
          Log out
        </Button>
      </div>
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full px-4 no-underline',
        current ? 'bg-foreground text-background' : 'text-muted-foreground',
      )}
    >
      {children}
    </Link>
  );
}
