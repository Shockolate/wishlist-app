import { renderSharePreview } from '@/lib/share-preview-image';
import { loadPreview, loadPreviewPhotos } from '@/lib/share-preview.server';

// Drawn per request from the list as it is now; the CDN keeps it for up to ten minutes (design §5.5).
export const dynamic = 'force-dynamic';

/**
 * `/s/[shareToken]/preview.jpg`: the share link's preview image (Plan 12 ruling 1). A dead link is
 * `404`; a photo that fails is left out, never a failure (design §5.6). It calls nothing but the
 * API.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/s/[shareToken]/preview.jpg'>,
): Promise<Response> {
  const { shareToken } = await params;
  const preview = await loadPreview(shareToken);
  const photos = await loadPreviewPhotos(shareToken, preview.photoItemIds);
  const jpeg = await renderSharePreview({
    title: preview.title,
    itemCount: preview.itemCount,
    photos,
  });
  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=0, s-maxage=600',
    },
  });
}
