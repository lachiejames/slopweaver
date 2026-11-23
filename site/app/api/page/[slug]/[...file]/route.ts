/**
 * A published page, served by the console: `/api/page/<slug>/index.html` answers the page's document out of the
 * store's Storage, and any file the page serves beside it at the path a relative link names it by.
 *
 * Why a route at all: a card names a page by its `file://` address and Chrome will not follow a `file://` link
 * from an `http://` page, so neither a click nor a Command-click opened it (`../../../../../lib/localPageHref.ts`
 * carries the reason). Served under the page's own route, a relative `<img src="shot.png">` in the page resolves to
 * its neighbour here exactly as it did from disk. What is served, and the sandbox policy, are
 * `../../../../../lib/localPageServe.ts`'s; the way to the store is `../../../../../lib/pageStore.ts`'s.
 */
import { servePageFile } from "../../../../../lib/localPageServe";
import { storedPageBody, storedPagePresentation } from "../../../../../lib/pageStore";

/** Never prerendered: it asks the store every page open, so a republished page is what the owner sees. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * Serve one file of one published page.
 *
 * @param request its `?v=` alone is read: the version the viewer's frame asks for (`servePageFile`'s `pinned`)
 * @param context the dynamic segments: the page's slug and the file under it
 * @returns the file, a 404 saying which page file is not there, or a 503 when the store could not say
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; file: string[] }> },
): Promise<Response> {
  const { slug, file } = await context.params;
  const pinned = new URL(request.url).searchParams.get("v");
  const served = { fetchBody: storedPageBody, file, presentation: storedPagePresentation, slug };
  if (pinned === null) {
    return servePageFile(served);
  }
  return servePageFile({ ...served, pinned });
}
