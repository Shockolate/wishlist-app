import Link from 'next/link';
import { EyeOffIcon } from '@/components/list/icons';

/** The owner on their own link (spec §2 Spoilers): what they're seeing, and where to change it. */
export function OwnerNote({ ownerSeesClaims }: { ownerSeesClaims: boolean }) {
  return (
    <div
      role="note"
      className="mt-4 flex items-start gap-2.5 rounded-control border border-border bg-card px-3.5 py-3 text-[15px] leading-snug"
    >
      {ownerSeesClaims ? null : <EyeOffIcon />}
      <p>
        This is your list as people you share it with see it.{' '}
        {ownerSeesClaims
          ? 'You’ve chosen to see how many are claimed, but never by whom.'
          : 'Claims are hidden from you, so nothing’s spoiled.'}{' '}
        <Link href="/settings" className="font-medium underline">
          Change this in Settings
        </Link>
        .
      </p>
    </div>
  );
}
