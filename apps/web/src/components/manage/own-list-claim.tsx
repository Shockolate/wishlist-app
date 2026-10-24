import Link from 'next/link';

/**
 * `/c/[manageToken]` for the list's own signed-in owner (D82). The API refuses them the claim, so
 * this shows nothing about it, and unlike `ManageClaim` it saves no record to `hanker:claims`.
 */
export function OwnListClaim() {
  return (
    <>
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] leading-none">Your claim</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        This link is for a claim on your own list, so Hanker keeps it hidden from you.
      </p>
      <p className="mt-8">
        <Link href="/list" className="inline-flex min-h-11 items-center underline">
          Back to your list
        </Link>
      </p>
    </>
  );
}
