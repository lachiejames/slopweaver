/**
 * The real HTTP transport for an attachment, and the only place in this connector that opens a socket to
 * something other than Notion's API.
 *
 * Signed attachment urls point at object storage rather than at `api.notion.com`, so they are deliberately
 * NOT given the Notion SDK: that client would pace them against the API's ~3 req/s allowance, which is not
 * the limit that governs a file download. Pacing for these calls comes from the crawl's own per-item budget
 * instead, one call at a time behind the item that owns them.
 *
 * The ranged probe is a GET rather than a HEAD, and that is measured: HEAD on one of these urls returns 403,
 * because the signature covers GET. See `attachments.ts#totalFromContentRange`.
 */
import type { AttachmentTransport } from "./attachmentFetch.js";

/**
 * Build the live transport.
 *
 * `rangeBytes` must be positive: the only caller passes the probe's own constant, and a zero or negative
 * value would build an invalid `bytes=0--1` header rather than being refused here.
 *
 * @param request the one HTTP call; production is the global `fetch`, a test passes a plain fake answering a
 *   real `Response` so no socket is opened
 * @returns a transport that issues a ranged GET when asked for a size, and a full GET when asked for bytes
 */
export function makeAttachmentTransport({
  request = ({ url, init }) => fetch(url, init),
}: {
  request?: (call: { url: string; init: { headers: Record<string, string>; method: "GET" } }) => Promise<Response>;
} = {}): AttachmentTransport {
  return async ({ url, rangeBytes }) => {
    const response = await request({
      init: {
        headers: rangeBytes === undefined ? {} : { Range: `bytes=0-${String(rangeBytes - 1)}` },
        method: "GET",
      },
      url,
    });
    const contentRange = response.headers.get("content-range");
    const contentType = response.headers.get("content-type");
    if (rangeBytes !== undefined) {
      return { contentRange, contentType, ok: response.ok, status: response.status };
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentRange,
      contentType,
      ok: response.ok,
      status: response.status,
    };
  };
}
