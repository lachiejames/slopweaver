/**
 * The scripted transport and fixtures the attach client's tests share: the page-read tests and the upload
 * pipeline's tests drive the same injected `fetch`, so both read one recording of what was sent.
 */

import { unwrap } from "../../../../lib/result.js";
import type { AttachFetch, AttachResponse } from "../../../../outbound/github/attachClient.js";
import { classifyAttachment } from "../../../../outbound/github/attachment.js";

/** One recorded request — what the fake transport was asked to send. */
export interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fieldNames: readonly string[];
  readonly fields: Readonly<Record<string, string>>;
}

/**
 * A scripted transport: a plain function per `testing.md`, never `vi.fn`.
 *
 * @param replies the answers handed back, in request order
 * @returns the transport and the list each request is recorded into
 */
export function fakeTransport({ replies }: { replies: readonly AttachResponse[] }): {
  readonly fetchImpl: AttachFetch;
  readonly sent: Recorded[];
} {
  const sent: Recorded[] = [];
  let index = 0;
  const fetchImpl: AttachFetch = ({ url, method, headers, body }) => {
    const entries = body === undefined ? [] : [...body.entries()];
    const fields: Record<string, string> = {};
    for (const [name, value] of entries) {
      fields[name] = typeof value === "string" ? value : `<file:${String(value.size)}>`;
    }
    sent.push({ fieldNames: entries.map(([name]) => name), fields, headers, method, url });
    const next = replies[index]!;
    index += 1;
    return Promise.resolve(next);
  };
  return { fetchImpl, sent };
}

/**
 * A reply the fake transport hands back.
 *
 * @param status the HTTP status code
 * @param body the response text, empty when omitted
 * @returns the response shape the client reads
 */
export function reply({ status, body = "" }: { status: number; body?: string }): AttachResponse {
  return { status, text: () => Promise.resolve(body) };
}

/** A presigned-policy answer naming the bucket, the finalize path and its token. */
export const POLICY_BODY = JSON.stringify({
  asset: { href: "https://github.com/user-attachments/assets/uuid-1", id: 999, name: "shot.png", size: 4 },
  asset_upload_authenticity_token: "finalize-token",
  asset_upload_url: "/upload/assets/999",
  form: { "X-Amz-Signature": "sig", key: "k", policy: "p" },
  upload_url: "https://github-production-user-asset-6210df.s3.amazonaws.com",
});

export const TARGET = { number: 485, owner: "slopweaver", repo: "slopweaver" };
export const CLASSIFIED = unwrap(classifyAttachment({ byteLength: 4, fileName: "shot.png" }));
export const CONTEXT = { authenticityToken: "page-token", repositoryId: "1226919613" };
export const BYTES = new Uint8Array([1, 2, 3, 4]);
