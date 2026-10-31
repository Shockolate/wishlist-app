import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy' };

const Contact = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/** `/privacy` (D54). Every claim here was checked against the code and the services (Plan 6). */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="2026-10-27">
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
        price and photo, so the shop sees a visit from Hanker, not from you. For Amazon, Etsy and
        eBay product links, Hanker asks Bright Data (Amazon), Etsy or eBay for the details instead,
        and sends only the product’s ID (and, for eBay, the option’s ID when the link names one).
        Unless you turn it off in Settings, Hanker sends an item’s title, note, the shop’s web
        address (not the full link) and the shop’s product description, with your list’s tag names,
        to Cloudflare’s AI to suggest tags for it.
      </p>
      <p>
        When you share your list’s link, Hanker’s server fetches photos of up to eight of your items
        from the shops to draw up to four in the link’s preview picture, and keeps none of them.
        Apps that show the preview, like Messages, Slack or Discord, keep their own copy.
      </p>

      <h2>If you claim a gift</h2>
      <p>
        Hanker keeps the name you type and how many you’re getting. Anyone with the list’s link sees
        your name next to the item, so nobody doubles up. Hanker never shows it to the list’s owner
        while they’re signed in. If they’ve turned it on, they see only how many have been claimed.
        Your browser keeps your claim link so you can change or cancel your claim later; Hanker
        keeps only a scrambled copy of it.
      </p>

      <h2>If you’re signed in when you claim</h2>
      <p>
        If your email is confirmed, Hanker can keep your claims on Your gifts, a page that follows
        you to any device you sign in on. Hanker never shows anyone else whose gifts a claim is on,
        whether they own the list or are another gifter.
      </p>
      <ul>
        <li>
          When you claim while signed in, or open a claim’s link while signed in and the page has
          loaded, Hanker links that claim to your account so it appears on Your gifts. Not mine
          takes it off again and leaves the claim alone.
        </li>
        <li>Bought ticks are stored and seen only by you.</li>
        <li>
          When a claim disappears (the list’s owner removes the item, the list or their account, or
          someone cancels it through its link), Hanker keeps the item’s title and its owner’s name
          on Your gifts for about 30 days, or until you clear it.
        </li>
        <li>
          Deleting your account deletes these links, ticks and notes. Your claims stay, so the
          people you’re buying for aren’t affected.
        </li>
      </ul>

      <h2>What Hanker doesn’t do</h2>
      <p>
        No ads, no analytics, no tracking. Your information is never sold or shared for marketing.
      </p>

      <h2>Cookies and storage</h2>
      <p>
        One cookie, which keeps you signed in. Claim links, and the name you last claimed with, stay
        in your browser’s own storage. Cloudflare’s security check on sign-ups and email-link
        requests keeps a small value in its own part of your browser’s storage. Nothing else, which
        is why there’s no cookie banner.
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
          details. It also stores Hanker’s encrypted backups. Cloudflare’s AI reads the title and
          note of items you add or edit, the shop’s web address and product description, and your
          list’s tag names, to suggest tags. It isn’t told who you are, doesn’t keep what it reads,
          and doesn’t train on it. You can turn this off in <Link href="/settings">Settings</Link>.
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
          eBay looks up eBay item links. It sees the item’s ID, and the option’s when the link names
          one, and nothing about who pasted it.
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
          and every claim on it are removed straight away. A gifter who had one of your items on
          Your gifts keeps a note with its title and your display name for about 30 days, or until
          they clear it.
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
