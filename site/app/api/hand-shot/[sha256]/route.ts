/**
 * One hand step's picture, for its queue card to draw with the red boxes over it: `/api/hand-shot/<sha256>` answers
 * the blob `hand post --shot` kept at `$SLOPWEAVER_HOME/hand-steps/shots/<sha[0:2]>/<sha256>`. Every check — the
 * name is a SHA-256, no linked directory, `O_NOFOLLOW`, the bytes re-hashed, a picture type read off the bytes — is
 * `../../../../lib/draftMediaServe.ts`'s, the same guard the draft-media route ships.
 */
import { handShotStoreDir, serveDraftMedia } from "../../../../lib/draftMediaServe";

/** Never prerendered: it reads the store every time. */
export const dynamic = "force-dynamic";

/**
 * Serve one stored step picture.
 *
 * @param _request unused: the hash is the whole question
 * @param context the dynamic segment: the blob's SHA-256
 * @returns the picture, or a 404 naming the hash
 */
export async function GET(_request: Request, context: { params: Promise<{ sha256: string }> }): Promise<Response> {
  const { sha256 } = await context.params;
  return serveDraftMedia({ sha256, storeDir: handShotStoreDir() });
}
