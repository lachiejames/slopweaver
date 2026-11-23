/**
 * The ways the Notion WRITE and MEDIA lanes cannot confirm what they just did.
 *
 * Its own small union per `.claude/rules/error-handling.md`, scoped to `./writeApi.ts` and `./mediaApi.ts`,
 * which share one client and one posture. A transport failure is not here — that arrives already typed
 * from `safeProviderCall` as an `IngestError` and is forwarded UNCHANGED. What IS here is the provider answering
 * without the thing a write is confirmed by: a response missing the page, id, url, bot id or block id the caller
 * records, and an upload Notion accepted but never finished. Kept apart because a missing field says the
 * response shape moved, while an unfinished upload says the bytes may still land and a retry could double them.
 *
 * Both lanes' public seams (`NotionWriteApi`, `NotionMediaApi`) fail with {@link NotionApiError}: the transport's
 * `IngestError` whole, so its `cause` still carries a refusal the write transport threw before the wire
 * (`../../outbound/notion/sendFailure.ts` reads it), or one of these. A caller displays `error.message`.
 *
 * Pure: every factory takes what it names.
 */
import type { IngestError } from "../../lib/ingestError.js";

/** The response lacked what confirms the write; `missing` names the part that was absent. */
export interface NotionResponseIncompleteError {
  readonly code: "RESPONSE_INCOMPLETE";
  readonly message: string;
  readonly missing: "page" | "page id or url" | "bot user id" | "block id";
}

/** Notion accepted an upload and left it in a status other than `uploaded`. */
export interface NotionUploadUnfinishedError {
  readonly code: "UPLOAD_UNFINISHED";
  readonly message: string;
  readonly uploadId: string;
  readonly filename: string;
  readonly status: string;
}

/** Every way a Notion write or media call returned without confirming itself. */
export type NotionWriteError = NotionResponseIncompleteError | NotionUploadUnfinishedError;

/** Every way a Notion write or media seam method fails: the transport's own error, or the response's. */
export type NotionApiError = IngestError | NotionWriteError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const NotionWriteErrors = {
  blockIdMissing: (): NotionResponseIncompleteError => ({
    code: "RESPONSE_INCOMPLETE",
    message: "Notion appended the block but returned no block id, so it cannot be recorded",
    missing: "block id",
  }),
  botUserIdMissing: (): NotionResponseIncompleteError => ({
    code: "RESPONSE_INCOMPLETE",
    message: "Notion returned no bot user id, so authorship cannot be checked",
    missing: "bot user id",
  }),
  notAPage: (): NotionResponseIncompleteError => ({
    code: "RESPONSE_INCOMPLETE",
    message: "Notion returned something that is not a page object, so the write cannot be confirmed",
    missing: "page",
  }),
  pageUnidentified: (): NotionResponseIncompleteError => ({
    code: "RESPONSE_INCOMPLETE",
    message: "Notion returned a page object with no id or url, so the write cannot be confirmed",
    missing: "page id or url",
  }),
  uploadUnfinished: ({
    uploadId,
    filename,
    status,
  }: {
    uploadId: string;
    filename: string;
    status: string;
  }): NotionUploadUnfinishedError => ({
    code: "UPLOAD_UNFINISHED",
    filename,
    message: `Notion left upload ${uploadId} for ${filename} in status ${JSON.stringify(status)} rather than "uploaded"`,
    status,
    uploadId,
  }),
} as const;
