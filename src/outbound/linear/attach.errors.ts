/**
 * The Linear ATTACHMENT domain's own typed error union — `linear attach`'s failures, and nothing else's.
 *
 * It is a union rather than the default `readonly string[]` because a caller genuinely branches: an
 * unsupported extension is a different correction from a file that will not open, which is different again
 * from Linear reserving an upload slot and the bytes then failing to land in its storage bucket. The last
 * one matters most and is the reason this file exists at all — a `fileUpload` mutation that succeeds hands
 * back an `assetUrl` that is a PROMISE rather than a fact, and a caller that embedded it without the PUT
 * having landed would publish a broken image.
 *
 * Deliberately NOT shared with `../github/attach.errors.ts`, whose shape it partly resembles. GitHub's
 * upload needs a browser session, a scraped page token and a two-stage policy handshake, so its union
 * carries five codes this one has no analogue for; Linear's is a plain API-key mutation plus one PUT. The
 * resemblance is a coincidence of both being uploads, which `.claude/rules/error-handling.md` names as
 * exactly the wrong reason to merge two domains' unions.
 */

/** The file's extension maps to no content type this door will send to Linear. */
export interface LinearUnsupportedMediaError {
  readonly code: "UNSUPPORTED_MEDIA";
  readonly message: string;
  readonly extension: string;
}

/** The local file could not be read at all. */
export interface LinearFileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Linear refused to reserve an upload slot, or reserved one whose payload was missing a required field. */
export interface LinearUploadRefusedError {
  readonly code: "UPLOAD_REFUSED";
  readonly message: string;
  readonly cause?: unknown;
}

/** The slot was reserved and the bytes did not land in Linear's storage bucket. */
export interface LinearAssetPutFailedError {
  readonly code: "ASSET_PUT_FAILED";
  readonly message: string;
  readonly status: number;
  readonly assetUrl: string;
}

/** The file's bytes carry a dead Datadog console host (`../invalidDatadogHost.ts`) — refused before any call. */
export interface LinearDeadDatadogHostError {
  readonly code: "DEAD_DATADOG_HOST";
  readonly message: string;
}

/**
 * The file's name or text-like bytes failed the outbound privacy check (`./writePrivacy.ts`) — refused before the
 * slot was reserved, or before the PUT. The message is the refusal exactly as rendered, never re-worded.
 */
export interface LinearPrivacyRefusedUploadError {
  readonly code: "PRIVACY_REFUSED";
  readonly message: string;
}

/** Every way `linear attach upload` can fail. */
export type LinearAttachError =
  | LinearAssetPutFailedError
  | LinearDeadDatadogHostError
  | LinearFileUnreadableError
  | LinearPrivacyRefusedUploadError
  | LinearUnsupportedMediaError
  | LinearUploadRefusedError;

/** The factory every producer of a {@link LinearAttachError} calls, so a message is written once. */
export const LinearAttachErrors = {
  deadDatadogHost: ({ refusal }: { refusal: readonly string[] }): LinearDeadDatadogHostError => ({
    code: "DEAD_DATADOG_HOST",
    message: refusal.join("\n"),
  }),
  assetPutFailed: ({ assetUrl, status }: { assetUrl: string; status: number }): LinearAssetPutFailedError => ({
    assetUrl,
    code: "ASSET_PUT_FAILED",
    message:
      `Linear reserved the upload slot and its storage bucket answered ${String(status)} to the PUT, so the ` +
      "asset URL exists but has no bytes behind it. Do not embed it — re-run the upload.",
    status,
  }),
  privacyRefused: ({ refusal }: { refusal: string }): LinearPrivacyRefusedUploadError => ({
    code: "PRIVACY_REFUSED",
    message: refusal,
  }),
  fileUnreadable: ({ path, cause }: { path: string; cause: unknown }): LinearFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `could not read ${path}: ${cause instanceof Error ? cause.message : "unknown"}`,
    path,
  }),
  unsupportedMedia: ({ extension }: { extension: string }): LinearUnsupportedMediaError => ({
    code: "UNSUPPORTED_MEDIA",
    extension,
    message:
      extension.length === 0
        ? "the file has no extension, and the extension is what picks the content type Linear stores"
        : `${extension} is not a content type this door uploads to Linear`,
  }),
  uploadRefused: ({ cause, reason }: { cause?: unknown; reason: string }): LinearUploadRefusedError => ({
    ...(cause === undefined ? {} : { cause }),
    code: "UPLOAD_REFUSED",
    message: `Linear refused to reserve an upload slot: ${reason}`,
  }),
} as const;
