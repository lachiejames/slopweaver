/**
 * `/api/page-version/<slug>`: which version of one published page the store holds now, so the viewer can offer a
 * newer one than it loaded (`../../../../lib/pageVersion.ts`). Its own prefix, because every path under
 * `/api/page/<slug>/` names a file the page serves.
 *
 * One fresh ask of the store per call, through the same kept source the page route serves by, so the viewer's own
 * page open and a check within a few seconds of it are one child (`../../../../lib/pageStoreSource.ts`).
 */
import { isPageSlug } from "../../../../lib/localPageHref";
import { storedPagePresentation } from "../../../../lib/pageStore";
import { pageVersionOf } from "../../../../lib/pageVersion";

/** Never prerendered: every call asks the store. */
export const dynamic = "force-dynamic";

/** No ISR window either. */
export const revalidate = 0;

/**
 * Answer one page's current version.
 *
 * @param _request unused: the slug is the whole question
 * @param context the dynamic segment: the page's slug
 * @returns the version as JSON, a 404 for a slug that is not one or a page that is not there, or a 503 when the store
 *   could not say
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  const headers = { "cache-control": "no-store" };
  if (!isPageSlug({ slug })) {
    return Response.json({ kind: "not-found" }, { headers, status: 404 });
  }
  const version = pageVersionOf({ read: await storedPagePresentation({ fresh: true, slug }) });
  if (version.kind === "not-found") {
    return Response.json(version, { headers, status: 404 });
  }
  if (version.kind === "unknown") {
    return Response.json(version, { headers, status: 503 });
  }
  return Response.json(version, { headers });
}
