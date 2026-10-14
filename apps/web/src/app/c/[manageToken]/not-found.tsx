import { ClaimGone } from '@/components/manage/claim-gone';
import { SiteHeader } from '@/components/site-header';

/** A manage link that's mistyped, or whose claim was cancelled or deleted (spec §2). */
export default function ClaimNotFound() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-xl px-4 py-24 sm:px-7">
        <ClaimGone />
      </main>
    </>
  );
}
