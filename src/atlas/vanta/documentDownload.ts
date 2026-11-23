/**
 * Fetching one policy document's bytes from the presigned URL the Manage API hands back.
 *
 * ## Why this is not the pinned transport
 *
 * `transport.ts` is bound to `api.vanta.com` and adds an OAuth bearer to every request. A knowledge-base
 * resource's `fileUrl` is neither: it is a presigned storage URL, signed for one hour, carrying its own
 * credential in the query string — presenting the Manage API token to it would be sending this
 * installation's bearer to a host that never asked for it.
 *
 * So the seam is separate and NARROW: it takes a URL this code did not assemble, follows no redirect, sends
 * no header of its own, and returns bytes. It is injected into `sync.ts` rather than reached for, which is
 * what lets `policyDocuments.ts` be tested over a plain function with no network.
 *
 * ## The URL is never stored
 *
 * It expires, so a stored one is a citation that stops resolving — `policyDocuments.ts` writes `fileUrl:
 * null` into the entity's detail and keeps the bytes instead. That is the whole reason the sync downloads
 * during the run rather than recording an address for later.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { VantaDocumentDownload } from "./policyDocuments.js";
import { VantaSyncErrors, vantaSyncErrorLines } from "./syncErrors.js";

/**
 * How large a single policy document may be before this refuses it.
 *
 * MEASURED across every knowledge-base resource the organisation holds, as the largest stored source
 * artifact's byte length — reproduce with
 * `slopweaver atlas vanta read --kind policy-document --json | jq '[.entities[].channels["manage-api"].source.artifacts[].byteLength] | max'`.
 * The cap sits well clear of the largest that command reports, so it bounds a pathological response without
 * being a limit any real policy approaches.
 */
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;

/** One GET of a presigned URL with redirects refused, answering only what the download reads. */
export type PresignedDocumentRequest = (args: {
  url: string;
  redirect: "error";
}) => Promise<Pick<Response, "arrayBuffer" | "ok" | "status">>;

/** The production request: the global `fetch`, sending no header of its own. */
const fetchPresigned: PresignedDocumentRequest = ({ url, redirect }) => fetch(url, { redirect });

/**
 * Fetch one presigned document's exact bytes over a given request.
 *
 * @param url the presigned URL the Manage API returned, used verbatim
 * @param request performs the GET; the global `fetch` unless a test answers it with a plain function
 * @returns the document's bytes, or why they could not be fetched
 */
export async function downloadPresignedDocumentVia({
  url,
  request = fetchPresigned,
}: {
  url: string;
  request?: PresignedDocumentRequest;
}): Promise<Result<Uint8Array>> {
  try {
    const response = await request({ redirect: "error", url });
    if (!response.ok) {
      return err(vantaSyncErrorLines({ error: VantaSyncErrors.documentHttpStatus({ status: response.status }) }));
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      return err(
        vantaSyncErrorLines({
          error: VantaSyncErrors.documentTooLarge({ byteLength: bytes.byteLength, cap: MAX_DOCUMENT_BYTES }),
        }),
      );
    }
    return ok(bytes);
  } catch (error: unknown) {
    return err(vantaSyncErrorLines({ error: VantaSyncErrors.documentUnfetchable({ cause: error }) }));
  }
}

/**
 * Fetch one presigned document's exact bytes.
 *
 * @param url the presigned URL the Manage API returned, used verbatim
 * @returns the document's bytes, or why they could not be fetched
 */
export const downloadPresignedDocument: VantaDocumentDownload = ({ url }) => downloadPresignedDocumentVia({ url });
