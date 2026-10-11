import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { geist, instrumentSerif } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Hanker', template: '%s | Hanker' },
  description: 'One list. One link. No doubled-up gifts.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, so each gets the proxy's nonce (rule 5).
  await connection();
  return (
    <html lang="en" className={`${geist.variable} ${instrumentSerif.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
