import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = { title: 'Terms' };

/** `/terms` (D54, D55). */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="2026-10-21">
      <p>
        Hanker is a free wishlist site that Ted Armstrong runs as a personal project. Using it means
        agreeing to these terms.
      </p>

      <h2>Provided as-is</h2>
      <p>
        Hanker is free and comes with no guarantee. It may be down, change or close. Backups exist,
        but don’t keep the only copy of anything important here. As far as the law allows, Ted isn’t
        liable for any loss from using Hanker.
      </p>

      <h2>Who can use it</h2>
      <p>Hanker is for people 13 and older, whether you make a list or claim a gift.</p>

      <h2>Be decent</h2>
      <p>
        Don’t use Hanker for anything illegal, abusive or spammy, or to get at other people’s lists
        or information. Ted can remove content or accounts that break these terms.
      </p>

      <h2>Your list is yours</h2>
      <p>
        You own what you put on your list. You give Hanker only the right to store it and show it to
        anyone with your link.
      </p>

      <h2>Shops and gifts</h2>
      <p>
        Hanker links to shops it doesn’t run. It isn’t responsible for them, their prices, or
        anything anyone buys.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change, and the date at the top shows when. The{' '}
        <Link href="/privacy">privacy page</Link> says what Hanker keeps about you.
      </p>

      <h2>The legal bits</h2>
      <p>
        Maine law applies. Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
