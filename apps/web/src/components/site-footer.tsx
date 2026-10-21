import Link from 'next/link';
import { CONTACT_EMAIL, SOURCE_URL } from '@/lib/site';

const LINK = 'inline-flex min-h-11 items-center text-foreground underline';

const LINKS = [
  { label: 'Source on GitHub', href: SOURCE_URL, external: true },
  { label: 'Privacy', href: '/privacy', external: false },
  { label: 'Terms', href: '/terms', external: false },
  { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}`, external: true },
];

/**
 * Every page's footer: the source, the legal pages and the contact address (Plan 6, D54).
 * Each link carries its own leading dot, and the row is pulled left under a clipping edge, so the
 * dot of whichever link starts a line is hidden and no line ends or starts with a stray "·".
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1200px] px-4 sm:px-7">
      <div className="overflow-hidden border-t border-foreground/15 px-1 py-3">
        <p className="-ml-4 flex flex-wrap text-[15px] text-muted-foreground">
          {LINKS.map(({ label, href, external }) => (
            <span key={href} className="relative inline-flex items-center pl-4">
              <span aria-hidden="true" className="absolute left-1.5">
                ·
              </span>
              {external ? (
                <a href={href} className={LINK}>
                  {label}
                </a>
              ) : (
                <Link href={href} className={LINK}>
                  {label}
                </Link>
              )}
            </span>
          ))}
        </p>
      </div>
    </footer>
  );
}
