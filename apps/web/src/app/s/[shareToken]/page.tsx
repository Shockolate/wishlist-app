import type { Metadata } from 'next';
import { SharePage } from '@/components/share/share-page';
import { SiteHeader } from '@/components/site-header';
import { loadSharedList } from '@/lib/shared-list.server';
import { shareMetadata } from '@/lib/site-metadata';

interface Props {
  params: Promise<{ shareToken: string }>;
}

/**
 * The list's title, owner and item count, which every viewer sees alike, and its preview image
 * (Plan 12). The token is in the image's URL alone (design §5.3).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareToken } = await params;
  const list = await loadSharedList(shareToken);
  return shareMetadata(
    { title: list.title, ownerDisplayName: list.ownerDisplayName, itemCount: list.items.length },
    shareToken,
  );
}

/** `/s/[shareToken]` (spec §7): the page a share link opens. */
export default async function SharedListPage({ params }: Props) {
  const { shareToken } = await params;
  const list = await loadSharedList(shareToken);
  return (
    <>
      <SiteHeader action={list.viewerIsOwner ? 'list' : 'none'} />
      <main className="mx-auto max-w-[680px] px-4 pt-10 pb-24 sm:px-7">
        <SharePage list={list} shareToken={shareToken} />
      </main>
    </>
  );
}
