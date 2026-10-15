import type { Metadata } from 'next';
import { ManageClaim } from '@/components/manage/manage-claim';
import { SiteHeader } from '@/components/site-header';
import { loadClaim } from '@/lib/shared-list.server';

export const metadata: Metadata = { title: 'Your claim' };

interface Props {
  params: Promise<{ manageToken: string }>;
}

/** `/c/[manageToken]` (spec §7): one claim, by its private link. */
export default async function ManageClaimPage({ params }: Props) {
  const { manageToken } = await params;
  const details = await loadClaim(manageToken);
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-[680px] px-4 pt-10 pb-24 sm:px-7">
        <ManageClaim details={details} manageToken={manageToken} />
      </main>
    </>
  );
}
