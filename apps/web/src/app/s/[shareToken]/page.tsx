import type { Metadata } from 'next';
import { SharePage } from '@/components/share/share-page';
import { SiteHeader } from '@/components/site-header';
import { loadSharedList } from '@/lib/shared-list.server';

interface Props {
  params: Promise<{ shareToken: string }>;
}

/** The list's own title, never the token (Global Constraints). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const list = await loadSharedList((await params).shareToken);
  return { title: list.title };
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
