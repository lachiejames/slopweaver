/**
 * The three calls that move one file into GitHub's user-attachment storage: ask for a presigned policy, post the
 * bytes to the bucket it names, and finalize the asset. `attachClient.ts` reads the page the upload token comes
 * off; this file starts from that token. Every decision lives in the pure `attachment.ts`, and every request goes
 * through `attachRequest`, which judges each write for a dead Datadog host.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { invalidDatadogHostRefusalLines } from "../invalidDatadogHost.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";
import { type AttachFetch, attachRequest } from "./attachClient.js";
import {
  type ClassifiedAttachment,
  GITHUB_ORIGIN,
  GITHUB_USER_AGENT,
  GITHUB_XHR_HEADERS,
  parseUploadPolicy,
  policyFormFields,
  policyRefusalDetail,
  UPLOAD_POLICY_PATH,
  type UploadContext,
  type UploadPolicy,
} from "./attachment.js";

/** One completed upload. `uploadName` is GITHUB's sanitised name, read back rather than guessed. */
export interface UploadedAsset {
  readonly href: string;
  readonly assetId: number;
  readonly contentType: string;
  readonly byteLength: number;
  readonly uploadName: string;
}

/** Call 1 — ask GitHub for a presigned upload policy. */
async function requestPolicy({
  fetchImpl,
  cookieHeader,
  classified,
  context,
  refererUrl,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  classified: ClassifiedAttachment;
  context: UploadContext;
  refererUrl: string;
}): Promise<Result<UploadPolicy, GithubAttachError>> {
  const body = new FormData();
  for (const [key, value] of policyFormFields({ classified, context })) {
    body.append(key, value);
  }
  const url = `${GITHUB_ORIGIN}${UPLOAD_POLICY_PATH}`;
  const response = await attachRequest({
    body,
    fetchImpl,
    headers: { ...GITHUB_XHR_HEADERS, cookie: cookieHeader, origin: GITHUB_ORIGIN, referer: refererUrl },
    method: "POST",
    url,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  const text = response.value.body;
  if (response.value.status !== 201) {
    return err(
      GithubAttachErrors.policyRefused({
        detail: policyRefusalDetail({ body: text }),
        status: response.value.status,
      }),
    );
  }
  return parseUploadPolicy({ body: text });
}

/** Call 2 — the only call that moves the file, with `file` appended last. */
async function putBytes({
  fetchImpl,
  policy,
  classified,
  bytes,
}: {
  fetchImpl: AttachFetch;
  policy: UploadPolicy;
  classified: ClassifiedAttachment;
  bytes: Uint8Array;
}): Promise<Result<true, GithubAttachError>> {
  const body = new FormData();
  for (const [key, value] of Object.entries(policy.form)) {
    body.append(key, value);
  }
  // Copy out the EXACT view, never `bytes.slice().buffer`. `readFileSync` returns a Buffer, and
  // `Buffer.prototype.slice` is an alias for `subarray` — it returns a VIEW, not a copy, unlike
  // `Uint8Array.prototype.slice`. Reading `.buffer` off that view yields Node's whole pooled allocation
  // rather than the file, and the presigned policy pins `content-length-range` to the EXACT declared size
  // (measured: `["content-length-range",1529,1529]` for a 1,529-byte file), so a single stray byte is a
  // 400. `ArrayBuffer.prototype.slice` genuinely copies, and copies once.
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  body.append("file", new Blob([exact], { type: classified.contentType }), classified.fileName);
  const response = await attachRequest({
    body,
    bodyUnreadOn: 204,
    fetchImpl,
    headers: { origin: GITHUB_ORIGIN, referer: `${GITHUB_ORIGIN}/`, "user-agent": GITHUB_USER_AGENT },
    method: "POST",
    url: policy.uploadUrl,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  if (response.value.status === 204) {
    return ok(true);
  }
  // Carry the bucket's own words out. S3 answers a rejected presigned POST with an XML body naming the
  // exact reason, and swallowing it turns a diagnosable failure into a bare status code.
  return err(
    GithubAttachErrors.bytesRefused({
      detail: policyRefusalDetail({ body: response.value.body }),
      status: response.value.status,
    }),
  );
}

/** Call 3 — finalize, with the token call 1 handed back rather than a second page scrape. */
async function finalize({
  fetchImpl,
  cookieHeader,
  policy,
  refererUrl,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  policy: UploadPolicy;
  refererUrl: string;
}): Promise<Result<true, GithubAttachError>> {
  const body = new FormData();
  body.append("authenticity_token", policy.assetUploadAuthenticityToken);
  const response = await attachRequest({
    body,
    bodyUnreadOn: 200,
    fetchImpl,
    headers: { ...GITHUB_XHR_HEADERS, cookie: cookieHeader, origin: GITHUB_ORIGIN, referer: refererUrl },
    method: "PUT",
    url: `${GITHUB_ORIGIN}${policy.assetUploadUrl}`,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  return response.value.status === 200
    ? ok(true)
    : err(GithubAttachErrors.finalizeRefused({ assetId: policy.assetId, status: response.value.status }));
}

/**
 * Run the whole pipeline for one already-classified file: policy, bytes, finalize.
 *
 * Reported successful only after call 3 answers `200`. The asset's `href` exists from call 1 onward, which
 * makes it tempting to return early — but an asset whose bytes were refused, or which was never finalized,
 * still has an `href` that resolves to nothing, and printing that URL would hand the caller a link to embed
 * that renders as a broken image. The same read-back discipline `github push` and `github ready` apply.
 *
 * @param fetchImpl the injected transport
 * @param cookieHeader the assembled github.com `Cookie` header
 * @param classified the file's sanitised name, size and content type
 * @param context the scraped CSRF token and repository id
 * @param bytes the file's contents
 * @param pixelText the lines recognised in a picture's pixels; empty for a recording, which has none read
 * @param refererUrl the page the upload is attributed to
 * @returns the finalized asset, or the first failure in the chain
 */
export async function uploadAttachment({
  fetchImpl,
  cookieHeader,
  classified,
  context,
  bytes,
  pixelText,
  refererUrl,
}: {
  fetchImpl: AttachFetch;
  cookieHeader: string;
  classified: ClassifiedAttachment;
  context: UploadContext;
  bytes: Uint8Array;
  pixelText: readonly string[];
  refererUrl: string;
}): Promise<Result<UploadedAsset, GithubAttachError>> {
  // An SVG is text, and any file can carry a link: its bytes, its name and the text its pixels show are judged for a
  // dead Datadog host before call 1, so a console URL drawn in a screenshot is refused like one typed into it.
  const refusal = invalidDatadogHostRefusalLines({
    command: `github attach ${classified.fileName}`,
    payload: { file: bytes, fileName: classified.fileName, pixelText: pixelText.join("\n") },
  });
  if (refusal !== undefined) {
    return err(GithubAttachErrors.deadDatadogHost({ refusal }));
  }
  const policy = await requestPolicy({ classified, context, cookieHeader, fetchImpl, refererUrl });
  if (policy.isErr()) {
    return err(policy.error);
  }
  const sent = await putBytes({ bytes, classified, fetchImpl, policy: policy.value });
  if (sent.isErr()) {
    return err(sent.error);
  }
  const confirmed = await finalize({ cookieHeader, fetchImpl, policy: policy.value, refererUrl });
  if (confirmed.isErr()) {
    return err(confirmed.error);
  }
  return ok({
    assetId: policy.value.assetId,
    byteLength: classified.byteLength,
    contentType: classified.contentType,
    href: policy.value.assetHref,
    uploadName: policy.value.assetName,
  });
}
