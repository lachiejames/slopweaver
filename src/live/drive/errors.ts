/**
 * The typed domain error for every Drive door verb — see `.claude/rules/error-handling.md` for the shape.
 * Its own union, shared with no other provider: a Drive failure is a file-store failure, and the two doors
 * hold separate grants and separate scopes, so a caller genuinely does branch on them separately.
 *
 * The four grant-lifecycle variants come from `../google/credentialErrors.js` rather than being declared
 * here, for the reason that file's header gives. What is this door's own is the two failures nothing shared
 * can emit: an address that is not a Drive file, and a file whose type has no text export.
 */
import { type GoogleCredentialError, googleCredentialErrors } from "../google/credentialErrors.js";

/** The caller-supplied address is not a Drive file id, and no id could be read out of it as a URL. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/**
 * The file cannot be exported as text, so `drive read` has metadata and no content for it.
 *
 * Its own variant rather than an {@link ApiFailedError}, because it is the EXPECTED outcome for most of a
 * real Drive — a PNG, a video, a zip — and the verb still succeeds on those, reporting the file and saying
 * plainly that its bytes were not read. Only a Google-native document (Docs, Sheets, Slides) has a text
 * export at all.
 */
export interface ExportUnsupportedError {
  readonly code: "EXPORT_UNSUPPORTED";
  readonly message: string;
  /** The file's own MIME type, so a caller can say what it was rather than only that it failed. */
  readonly mimeType: string;
}

/** The Drive API call failed (network, rate limit, revoked grant, or a malformed response). */
export interface ApiFailedError {
  readonly code: "API_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure a Drive door verb can produce. */
export type DriveError = GoogleCredentialError | InvalidAddressError | ExportUnsupportedError | ApiFailedError;

/** Factories for every {@link DriveError} variant — the shape real code and its tests both construct through. */
export const DriveErrors = {
  ...googleCredentialErrors({ connectVerb: "slopweaver drive connect", productName: "Google Drive" }),

  /** @returns an {@link ApiFailedError} wrapping the underlying provider failure */
  apiFailed: ({ message, cause }: { message: string; cause?: unknown }): ApiFailedError => ({
    code: "API_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns an {@link ExportUnsupportedError} naming the media type that has no text export */
  exportUnsupported: ({ mimeType }: { mimeType: string }): ExportUnsupportedError => ({
    code: "EXPORT_UNSUPPORTED",
    message: `${mimeType} has no text export — only Google-native documents can be read as text through the API`,
    mimeType,
  }),

  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),
} as const;
