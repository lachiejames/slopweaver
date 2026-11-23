/**
 * One parked draft's attached HTML document, as a page the in-app viewer frames: `/api/draft-media/<sha256>/page`
 * answers the same verified blob `../route.ts` serves pictures from — the bytes the send uploads — when they are an
 * HTML document. Every check is `../../../../../lib/draftMediaServe.ts`'s.
 */
import { draftMediaStoreDir, serveDraftMediaPage } from "../../../../../lib/draftMediaServe";

/** Never prerendered: it reads the store every time. */
export const dynamic = "force-dynamic";

/**
 * Serve one stored attachment as a page.
 *
 * @param _request unused: the hash is the whole question
 * @param context the dynamic segment: the blob's SHA-256
 * @returns the page, or a 404 naming the hash
 */
export async function GET(_request: Request, context: { params: Promise<{ sha256: string }> }): Promise<Response> {
  const { sha256 } = await context.params;
  return serveDraftMediaPage({ sha256, storeDir: draftMediaStoreDir() });
}
