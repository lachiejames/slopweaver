/**
 * One parked draft's attached picture, for the queue card to draw inline: `/api/draft-media/<sha256>` answers the
 * blob `slack draft record --media` kept at `$SLOPWEAVER_HOME/queue/slack-draft-media/<sha[0:2]>/<sha256>`.
 * Every check, and which home it reads, is `../../../../lib/draftMediaServe.ts`'s. A document's words come from
 * `./text/route.ts` instead.
 */
import { draftMediaStoreDir, serveDraftMedia } from "../../../../lib/draftMediaServe";

/** Never prerendered: it reads the store every time. */
export const dynamic = "force-dynamic";

/**
 * Serve one stored attachment.
 *
 * @param _request unused: the hash is the whole question
 * @param context the dynamic segment: the blob's SHA-256
 * @returns the picture, or a 404 naming the hash
 */
export async function GET(_request: Request, context: { params: Promise<{ sha256: string }> }): Promise<Response> {
  const { sha256 } = await context.params;
  return serveDraftMedia({ sha256, storeDir: draftMediaStoreDir() });
}
