/**
 * The Slack private upload — `files.uploadV2` with no channel, and reading the file id off its result — split
 * out of `./writeApi.ts` purely to keep that file under `file-size-ratchet`'s cap. It is still part of the
 * one seam that mutates a workspace: `uploadPrivatelyCall` is wired into the SAME `SlackWriteTransport`
 * `writeApi.ts` builds and follows its exact `safeProviderCall`/`orThrow`/`scopeId` pattern.
 */
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { GuardedWebClient } from "./guardedWebClient.js";
import { optStr } from "./shape.js";
import type { SlackUpload } from "./writeTransport.js";

/**
 * The uploaded file's id off a `files.uploadV2` result. The SDK types that method's return as the
 * bare `WebAPICallResult` (no `files` field), so the result is widened to `unknown` and narrowed
 * structurally — no cast — and both nesting depths the method has used are tolerated. Ids only. Pure.
 *
 * @param result the raw `files.uploadV2` result, widened to unknown because the SDK's type omits `files`
 * @returns the file id, or undefined when neither nesting depth yields one
 */
export function uploadedFileId({ result }: { result: unknown }): string | undefined {
  if (!isRecord(result) || !Array.isArray(result["files"])) {
    return undefined;
  }
  for (const entry of result["files"]) {
    if (!isRecord(entry)) {
      continue;
    }
    const direct = optStr({ value: entry["id"] });
    if (direct !== undefined) {
      return direct;
    }
    const nested = Array.isArray(entry["files"]) ? entry["files"][0] : undefined;
    const id = isRecord(nested) ? optStr({ value: nested["id"] }) : undefined;
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/**
 * `files.uploadV2` with `channel_id` OMITTED — the whole private upload.
 *
 * @param upload the bytes and filename to upload
 * @returns the uploaded file's id
 */
export async function uploadPrivatelyCall({
  client,
  upload,
  scopeId,
}: {
  client: GuardedWebClient;
  upload: SlackUpload;
  scopeId: string;
}): Promise<string> {
  const res = orThrow({
    result: await safeProviderCall({
      execute: () => client.files.uploadV2({ file: Buffer.from(upload.bytes), filename: upload.filename }),
      operation: "slack.files.uploadV2",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
  const fileId = uploadedFileId({ result: res });
  if (fileId === undefined) {
    throw new Error(`slack.files.uploadV2 returned no file id for "${upload.filename}"`);
  }
  return fileId;
}
