import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy' };

const Contact = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/** `/privacy` (D54). Every claim here was checked against the code and the services (Plan 6). */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="2026-10-23">
      <p>
        Hanker is a small wishlist site run by Ted Armstrong in Portland, Maine, USA. This page says
        what Hanker keeps about you, who else handles it, and for how long. Questions go to{' '}
        <Contact />.
      </p>

      <h2>If you make a list</h2>
      <p>
        Hanker keeps your email address, your display name, your password as a one-way hash (never
        the password itself), and your list: its title, items, links, prices, photo addresses, notes
        and tags. When you paste a shop link, Hanker’s server visits that page to fill in the title,
        price and photo, so the shop sees a visit from Hanker, not from you. For Amazon and Etsy
        product links, Hanker asks Bright Data (Amazon) or Etsy for the details instead, and sends
        only the product’s ID. Unless you turn it off in Settings, Hanker sends an item’s title,
        note, shop name and the shop’s product description, with your list’s tag names, to
        Cloudflare’s AI to suggest tags for it.
      </p>

      <h2>If you claim a gift</h2>
      <p>
        Hanker keeps the name you type and how many you’re getting. Anyone with the list’s link sees
        your name next to the item, so nobody doubles up. The list’s owner sees it only if they’ve
        turned that on. Your browser keeps your claim link so you can change or cancel your claim
        later; Hanker keeps only a scrambled copy of it.
      </p>

      <h2>What Hanker doesn’t do</h2>
      <p>
        No ads, no analytics, no tracking. Your information is never sold or shared for marketing.
      </p>

      <h2>Cookies and storage</h2>
      <p>
        One cookie, which keeps you logged in. Claim links, and the name you last claimed with, stay
        in your browser’s own storage. Cloudflare’s check on sign-ups and email-link requests keeps
        a small value in its own part of your browser’s storage. Nothing else, which is why there’s
        no cookie banner.
      </p>

      <h2>Who else handles your information</h2>
      <p>Hanker runs on a few services, and each sees only what it needs:</p>
      <ul>
        <li>
          Vercel hosts the site. Its logs record requests, including IP addresses, and keep them for
          a day or less.
        </li>
        <li>Neon stores the database.</li>
        <li>
          Resend sends Hanker’s emails, so it sees your email address and the message, and keeps a
          record for 30 days.
        </li>
        <li>
          Cloudflare checks that sign-ups and email-link requests (password resets and new
          confirmation links) come from a person, which means it sees your IP address and browser
          details. It also stores Hanker’s encrypted backups. Cloudflare’s AI reads the title, note
          and shop details of items you add or edit, and your list’s tag names, to suggest tags. It
          isn’t told who you are, doesn’t keep what it reads, and doesn’t train on it. You can turn
          this off in <Link href="/settings">Settings</Link>.
        </li>
        <li>
          Bright Data looks up Amazon product links. It sees the product’s ID, and nothing about who
          pasted it.
        </li>
        <li>
          Etsy looks up Etsy listing links. It sees the listing’s ID, and nothing about who pasted
          it.
        </li>
        <li>
          GitHub runs the nightly backup, which is encrypted before it leaves GitHub’s machine.
        </li>
        <li>
          Sentry receives error reports, with the secret parts of links, email addresses and IP
          addresses removed.
        </li>
        <li>
          Have I Been Pwned checks new passwords against known leaks. It receives the first five
          characters of a scrambled copy of your password, never the password.
        </li>
      </ul>

      <h2>Photos on lists</h2>
      <p>
        Item photos load straight from the shop’s website, so that shop can see the IP address of
        whoever views the list.
      </p>

      <h2>How long it’s kept</h2>
      <ul>
        <li>
          Delete your account in <Link href="/settings">Settings</Link>, and your account, your list
          and every claim on it are removed straight away.
        </li>
        <li>Cancel a claim from your claim link, and it’s removed straight away.</li>
        <li>Encrypted backups keep a copy for up to 30 days, and then it’s gone.</li>
        <li>Accounts whose email is never confirmed are deleted after 7 days.</li>
        <li>
          To slow down abuse, Hanker counts requests using a scrambled copy of your IP address or
          email, and deletes those counts within two days.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        Hanker is for people 13 and older, whether you make a list or claim a gift. If you think a
        child under 13 has given Hanker information, email <Contact /> and it will be deleted.
      </p>

      <h2>Changes</h2>
      <p>
        If this page changes, the date at the top changes too. The <Link href="/terms">terms</Link>{' '}
        cover the rest.
      </p>
    </LegalPage>
  );
}
