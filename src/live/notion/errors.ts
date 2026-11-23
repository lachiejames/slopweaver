/**
 * The typed domain error for a Notion named-object read — see `.claude/rules/error-handling.md` for the
 * shape. Its own type, not shared with `GithubLiveError`/`LinearLiveError`.
 *
 * Smaller than its siblings because Notion's parser never distinguishes an ambiguous address from an invalid
 * one, and the SDK seam (`NotionNamedReadApi`) has not itself been migrated onto a typed error yet — its
 * `readonly string[]` failures are folded into {@link ReadFailedError} at the point they are consumed (see
 * `src/live/notion/read.ts`'s `toReadFailed`), not lost.
 */

/** The caller-supplied address could not be parsed as a Notion object id or URL. */
export interface InvalidAddressError {
  readonly code: "INVALID_ADDRESS";
  readonly message: string;
}

/** The provider call itself failed (network, rate limit, or a malformed SDK response). */
export interface ReadFailedError {
  readonly code: "READ_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** Every failure a Notion named-object read can produce. */
export type NotionLiveError = InvalidAddressError | ReadFailedError;

/** Factories for every {@link NotionLiveError} variant. */
export const NotionLiveErrors = {
  /** @returns an {@link InvalidAddressError} carrying the caller-facing reason */
  invalidAddress: ({ message }: { message: string }): InvalidAddressError => ({
    code: "INVALID_ADDRESS",
    message,
  }),

  /** @returns a {@link ReadFailedError} wrapping the underlying provider failure */
  readFailed: ({ message, cause }: { message: string; cause?: unknown }): ReadFailedError => ({
    code: "READ_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),
} as const;
