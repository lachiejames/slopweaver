/**
 * The typed failures of resolving a Block Kit file reference through `files.info` (`./blockFiles.ts`), split out of
 * `./errors.ts` along its own section so that file stays one a reader can hold. Shape per
 * `.claude/rules/error-handling.md`.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import type { SlackProjectionError } from "./errors.js";

/** `files.info` answered, but the result could not be projected into a usable file. */
export interface FileLookupUnusableFileError {
  readonly code: "FILE_UNUSABLE";
  readonly message: string;
  readonly fileId: string;
  readonly cause: SlackProjectionError;
}

/** The `files.info` call itself threw. */
export interface FileLookupFailedError {
  readonly code: "FILE_LOOKUP_FAILED";
  readonly message: string;
  readonly fileId: string;
  readonly cause?: unknown;
}

/** `files.info` was never asked, because the caller's bound on lookups for one read was already spent. */
export interface FileLookupWithheldError {
  readonly code: "FILE_LOOKUP_WITHHELD";
  readonly message: string;
  readonly fileId: string;
  readonly limit: number;
}

/** Every failure `src/live/slack/blockFiles.ts`'s `files.info` lookup can produce. */
export type SlackFileLookupError = FileLookupUnusableFileError | FileLookupFailedError | FileLookupWithheldError;

/** Factories for every {@link SlackFileLookupError} variant. */
export const SlackFileLookupErrors = {
  lookupFailed: ({ fileId, cause }: { fileId: string; cause: unknown }): FileLookupFailedError => ({
    cause,
    code: "FILE_LOOKUP_FAILED",
    fileId,
    message: `files.info on ${fileId} failed: ${errorMessage({ error: cause })}`,
  }),
  // Re-worded rather than passed through: the projector's sentences say "a message carried …", which is true
  // of its usual caller and false here — see `blockFiles.ts`'s module header.
  unusableFile: ({ fileId, cause }: { fileId: string; cause: SlackProjectionError }): FileLookupUnusableFileError => ({
    cause,
    code: "FILE_UNUSABLE",
    fileId,
    message: `files.info on ${fileId} returned no usable file: ${cause.message}`,
  }),
  withheld: ({ fileId, limit }: { fileId: string; limit: number }): FileLookupWithheldError => ({
    code: "FILE_LOOKUP_WITHHELD",
    fileId,
    limit,
    message: `${fileId} was not looked up: this read already looked up ${String(limit)} files`,
  }),
} as const;
