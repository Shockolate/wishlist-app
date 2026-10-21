import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { rootMetadata } from '@/lib/site-metadata';
import { geist, instrumentSerif } from './fonts';
import './globals.css';

export const metadata: Metadata = rootMetadata;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, so each gets the proxy's nonce (Plan 2b rule 5).
  await connection();
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
