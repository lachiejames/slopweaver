/**
 * One picture in a channel hover window, for the Workstreams page to draw inline: `/api/slack-channel-media/<sha256>`
 * answers the preview `slack channel-view` kept at `$SLOPWEAVER_HOME/live/slack/channel-media/<sha[0:2]>/<sha256>`.
 * Every check, and which home it reads, is `../../../../lib/draftMediaServe.ts`'s.
 */
import { serveDraftMedia, slackChannelMediaStoreDir } from "../../../../lib/draftMediaServe";

/** Never prerendered: it reads the store every time. */
export const dynamic = "force-dynamic";

/**
 * Serve one kept preview.
 *
 * @param _request unused: the hash is the whole question
 * @param context the dynamic segment: the blob's SHA-256
 * @returns the picture, or a 404 naming the hash
 */
export async function GET(_request: Request, context: { params: Promise<{ sha256: string }> }): Promise<Response> {
  const { sha256 } = await context.params;
  return serveDraftMedia({ sha256, storeDir: slackChannelMediaStoreDir() });
}
