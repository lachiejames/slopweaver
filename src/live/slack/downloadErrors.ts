/**
 * Typed discriminated-union domain errors for Slack ATTACHMENT BYTES — `download.ts`'s authenticated GET and
 * `fileDownloads.ts`'s per-thread stage. Same shape and same rules as `./errors.ts`
 * (`.claude/rules/error-handling.md`); a SEPARATE file because that one sits at the size ratchet's ceiling,
 * and because the byte path is the one part of this domain with its own security properties to state.
 */
import { errorMessage } from "../../lib/errorMessage.js";

// ---------------------------------------------------------------------------------------------------------
// download.ts + fileDownloads.ts — fetching one attachment's bytes and the per-thread download stage
// ---------------------------------------------------------------------------------------------------------

/** The `url_private_download` Slack supplied was not a URL. */
export interface FileDownloadInvalidUrlError {
  readonly code: "INVALID_DOWNLOAD_URL";
  readonly message: string;
}

/** The URL resolved to a host other than `*.slack.com` — refuse rather than forward the bearer token. */
export interface FileDownloadUntrustedHostError {
  readonly code: "UNTRUSTED_HOST";
  readonly message: string;
}

/** The underlying `fetch`, routed through `safeProviderCall`, failed. */
export interface FileDownloadTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly filename: string;
  readonly cause?: unknown;
}

/** The response was a redirect, a non-2xx, or an HTML page where bytes were expected. */
export interface FileDownloadResponseRejectedError {
  readonly code: "RESPONSE_REJECTED";
  readonly message: string;
  readonly filename: string;
}

/** Slack returned a 2xx with no body. */
export interface FileDownloadEmptyBodyError {
  readonly code: "EMPTY_BODY";
  readonly message: string;
  readonly filename: string;
}

/** Streaming the response to disk threw. */
export interface FileDownloadWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly filename: string;
  readonly cause?: unknown;
}

/** The bytes written did not match Slack's reported size — a short read reported as success. */
export interface FileDownloadSizeMismatchError {
  readonly code: "SIZE_MISMATCH";
  readonly message: string;
  readonly filename: string;
  readonly expectedBytes: number;
  readonly receivedBytes: number;
}

/** The body ran past the most the caller would take, so the transfer was cancelled and nothing kept. */
export interface FileDownloadTooLargeError {
  readonly code: "TOO_LARGE";
  readonly message: string;
  readonly filename: string;
  readonly maxBytes: number;
}

/** A redirect that could not be followed: no usable https `Location`, or too many hops. */
export interface FileDownloadRedirectUnusableError {
  readonly code: "REDIRECT_UNUSABLE";
  readonly message: string;
  readonly filename: string;
  readonly reason: string;
}

/** The thread's attachment directory is not a real directory — a symlink-redirection attempt. */
export interface FileDownloadDestinationUnusableError {
  readonly code: "DESTINATION_UNUSABLE";
  readonly message: string;
  readonly destinationDir: string;
}

/** Every failure `src/live/slack/download.ts` and `src/live/slack/fileDownloads.ts` can produce. */
export type SlackFileDownloadError =
  | FileDownloadInvalidUrlError
  | FileDownloadUntrustedHostError
  | FileDownloadTransportFailedError
  | FileDownloadResponseRejectedError
  | FileDownloadEmptyBodyError
  | FileDownloadWriteFailedError
  | FileDownloadSizeMismatchError
  | FileDownloadTooLargeError
  | FileDownloadRedirectUnusableError
  | FileDownloadDestinationUnusableError;

/** Factories for every {@link SlackFileDownloadError} variant. */
export const SlackFileDownloadErrors = {
  destinationUnusable: ({ destinationDir }: { destinationDir: string }): FileDownloadDestinationUnusableError => ({
    code: "DESTINATION_UNUSABLE",
    destinationDir,
    message: `attachment directory ${destinationDir} is not a real directory; refusing to write through it`,
  }),
  emptyBody: ({ filename }: { filename: string }): FileDownloadEmptyBodyError => ({
    code: "EMPTY_BODY",
    filename,
    message: `${filename}: Slack returned an empty body`,
  }),
  invalidUrl: ({ url }: { url: string }): FileDownloadInvalidUrlError => ({
    code: "INVALID_DOWNLOAD_URL",
    message: `file download URL is not a URL: ${url}`,
  }),
  redirectUnusable: ({
    filename,
    reason,
  }: {
    filename: string;
    reason: string;
  }): FileDownloadRedirectUnusableError => ({
    code: "REDIRECT_UNUSABLE",
    filename,
    message: `${filename}: Slack redirected the download and it could not be followed — ${reason}`,
    reason,
  }),
  responseRejected: ({
    filename,
    reason,
  }: {
    filename: string;
    reason: string;
  }): FileDownloadResponseRejectedError => ({
    code: "RESPONSE_REJECTED",
    filename,
    message: `${filename}: ${reason}`,
  }),
  sizeMismatch: ({
    filename,
    expectedBytes,
    receivedBytes,
  }: {
    filename: string;
    expectedBytes: number;
    receivedBytes: number;
  }): FileDownloadSizeMismatchError => ({
    code: "SIZE_MISMATCH",
    expectedBytes,
    filename,
    message: `${filename}: expected ${String(expectedBytes)} bytes, received ${String(receivedBytes)}`,
    receivedBytes,
  }),
  tooLarge: ({ filename, maxBytes }: { filename: string; maxBytes: number }): FileDownloadTooLargeError => ({
    code: "TOO_LARGE",
    filename,
    maxBytes,
    message: `${filename}: the body ran past ${String(maxBytes)} bytes, so the download was stopped and nothing kept`,
  }),
  transportFailed: ({
    filename,
    reason,
    cause,
  }: {
    filename: string;
    reason: string;
    cause?: unknown;
  }): FileDownloadTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    filename,
    message: `downloading ${filename} failed: ${reason}`,
    ...(cause !== undefined ? { cause } : {}),
  }),
  untrustedHost: ({ hostname }: { hostname: string }): FileDownloadUntrustedHostError => ({
    code: "UNTRUSTED_HOST",
    message: `refusing to send Slack credentials to ${hostname}`,
  }),
  writeFailed: ({ filename, cause }: { filename: string; cause: unknown }): FileDownloadWriteFailedError => ({
    cause,
    code: "WRITE_FAILED",
    filename,
    message: `${filename}: writing the download failed: ${errorMessage({ error: cause })}`,
  }),
} as const;
