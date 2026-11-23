/**
 * Typed discriminated-union domain errors for the `slack read-file` family — the reference parser, the
 * `files.info` read, and the composed pipeline. Same shape and same rules as `./errors.ts`
 * (`.claude/rules/error-handling.md`); a SEPARATE file because that one is already at the size ratchet's
 * ceiling, and a shared errors file that every new domain appends to is a file that only ever grows.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import type { SlackFileDownloadError } from "./downloadErrors.js";

// ---------------------------------------------------------------------------------------------------------
// fileReference.ts — resolving whatever the caller pasted into a `files.info` file id
// ---------------------------------------------------------------------------------------------------------

/** Nothing was supplied where a file reference belongs. */
export interface FileReferenceEmptyError {
  readonly code: "FILE_REFERENCE_EMPTY";
  readonly message: string;
}

/** The reference is neither a bare `F…` id nor a parseable URL. */
export interface FileReferenceNotAReferenceError {
  readonly code: "FILE_REFERENCE_UNPARSEABLE";
  readonly message: string;
  readonly text: string;
}

/** A URL, but not over HTTPS — the token is never sent over anything else. */
export interface FileReferenceNotHttpsError {
  readonly code: "FILE_REFERENCE_NOT_HTTPS";
  readonly message: string;
  readonly protocol: string;
}

/** A URL on a host Slack does not serve files from. */
export interface FileReferenceNotSlackHostError {
  readonly code: "FILE_REFERENCE_NOT_SLACK_HOST";
  readonly message: string;
  readonly hostname: string;
}

/** A MESSAGE permalink, which is `slack read-thread`'s job rather than this verb's. */
export interface FileReferenceIsMessagePermalinkError {
  readonly code: "FILE_REFERENCE_IS_MESSAGE_PERMALINK";
  readonly message: string;
  readonly url: string;
}

/** A Slack URL with no `F…` id anywhere in its path. */
export interface FileReferenceNoFileIdError {
  readonly code: "FILE_REFERENCE_NO_FILE_ID";
  readonly message: string;
  readonly pathname: string;
}

/** Every failure `src/live/slack/fileReference.ts` can produce. */
export type SlackFileReferenceError =
  | FileReferenceEmptyError
  | FileReferenceNotAReferenceError
  | FileReferenceNotHttpsError
  | FileReferenceNotSlackHostError
  | FileReferenceIsMessagePermalinkError
  | FileReferenceNoFileIdError;

/** Factories for every {@link SlackFileReferenceError} variant. */
export const SlackFileReferenceErrors = {
  empty: (): FileReferenceEmptyError => ({
    code: "FILE_REFERENCE_EMPTY",
    message: "a Slack file id or file link is required",
  }),
  isMessagePermalink: ({ url }: { url: string }): FileReferenceIsMessagePermalinkError => ({
    code: "FILE_REFERENCE_IS_MESSAGE_PERMALINK",
    message: `${url} is a Slack MESSAGE permalink, not a file — read it with \`slopweaver slack read-thread\``,
    url,
  }),
  noFileId: ({ pathname }: { pathname: string }): FileReferenceNoFileIdError => ({
    code: "FILE_REFERENCE_NO_FILE_ID",
    message: `no Slack file id (F…) anywhere in the path ${pathname}`,
    pathname,
  }),
  notAReference: ({ text }: { text: string }): FileReferenceNotAReferenceError => ({
    code: "FILE_REFERENCE_UNPARSEABLE",
    message: `not a Slack file id or link: ${text} (expected F… or a https://…slack.com/… URL)`,
    text,
  }),
  notHttps: ({ protocol }: { protocol: string }): FileReferenceNotHttpsError => ({
    code: "FILE_REFERENCE_NOT_HTTPS",
    message: `a Slack file link must be https, got ${protocol}`,
    protocol,
  }),
  notSlackHost: ({ hostname }: { hostname: string }): FileReferenceNotSlackHostError => ({
    code: "FILE_REFERENCE_NOT_SLACK_HOST",
    message: `${hostname} is not a Slack host`,
    hostname,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// fileMeta.ts + readFile.ts — reading one file's metadata and, for a huddle, its transcript
// ---------------------------------------------------------------------------------------------------------

/** `files.info` answered, but the object cannot be shaped into usable metadata. */
export interface FileReadUnusableFileError {
  readonly code: "FILE_READ_UNUSABLE";
  readonly message: string;
  readonly reason: string;
}

/** The `files.info` call itself failed. */
export interface FileReadLookupFailedError {
  readonly code: "FILE_READ_LOOKUP_FAILED";
  readonly message: string;
  readonly fileId: string;
  readonly cause?: unknown;
}

/** Slack reported the file but gave no authenticated URL to fetch its bytes from. */
export interface FileReadNoBodyUrlError {
  readonly code: "FILE_READ_NO_BODY_URL";
  readonly message: string;
  readonly fileId: string;
}

/** The bytes arrived but are not text this verb can render. */
export interface FileReadNotTextError {
  readonly code: "FILE_READ_NOT_TEXT";
  readonly message: string;
  readonly fileId: string;
  readonly filetype: string | undefined;
}

/** Every failure `src/live/slack/readFile.ts` can produce beyond the reference and download unions. */
export type SlackFileReadError =
  FileReadUnusableFileError | FileReadLookupFailedError | FileReadNoBodyUrlError | FileReadNotTextError;

/**
 * The kind a not-text refusal names. `files.info` reports `filetype` as optional (`SlackFileMeta` reads it
 * absent-means-absent), and bytes this verb cannot render as text, with no type of their own, are to it a binary.
 */
function notTextKind({ filetype }: { filetype: string | undefined }): string {
  if (filetype === undefined) {
    return "binary";
  }
  return filetype;
}

/** Factories for every {@link SlackFileReadError} variant. */
export const SlackFileReadErrors = {
  lookupFailed: ({ fileId, cause }: { fileId: string; cause: unknown }): FileReadLookupFailedError => ({
    cause,
    code: "FILE_READ_LOOKUP_FAILED",
    fileId,
    message: `files.info on ${fileId} failed: ${errorMessage({ error: cause })}`,
  }),
  noBodyUrl: ({ fileId }: { fileId: string }): FileReadNoBodyUrlError => ({
    code: "FILE_READ_NO_BODY_URL",
    fileId,
    message: `Slack returned ${fileId} with no url_private_download — there are no bytes to read`,
  }),
  notText: ({ fileId, filetype }: { fileId: string; filetype: string | undefined }): FileReadNotTextError => ({
    code: "FILE_READ_NOT_TEXT",
    filetype,
    fileId,
    message:
      `${fileId} is a ${notTextKind({ filetype })} file, which this verb renders no body for. ` +
      "`slopweaver slack read-thread` downloads attachment bytes from the message that carries them",
  }),
  unusableFile: ({ reason }: { reason: string }): FileReadUnusableFileError => ({
    code: "FILE_READ_UNUSABLE",
    message: `files.info returned no usable file: ${reason}`,
    reason,
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// readFile.ts — the composed pipeline; no variants of its own, just the union every stage can produce
// ---------------------------------------------------------------------------------------------------------

/** Every failure `src/live/slack/readFile.ts`'s end-to-end read can produce. */
export type SlackFileDocumentError = SlackFileReferenceError | SlackFileReadError | SlackFileDownloadError;
