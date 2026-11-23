/**
 * The typed failures of reading and writing the per-repository pull-request snapshot.
 *
 * A domain of its own rather than `readonly string[]`, because a caller genuinely branches on these: a
 * MISSING snapshot means "run `stack restack` first" and is not a fault, an UNREADABLE one means the file
 * is there and something is wrong with the disk or the process, and an INVALID one means the bytes parsed
 * but do not describe this repository — and only the last of those is ever a reason to refuse rather than
 * to re-measure.
 */

/** The snapshot file exists but could not be read at all. */
export interface PrStateUnreadableError {
  readonly code: "STATE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** The snapshot parsed, but its rows do not describe a usable state for this repository. */
export interface PrStateInvalidError {
  readonly code: "STATE_INVALID";
  readonly message: string;
  readonly path: string;
}

/** The snapshot could not be written. */
export interface PrStateUnwritableError {
  readonly code: "STATE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

export type PrStateError = PrStateUnreadableError | PrStateInvalidError | PrStateUnwritableError;

/** The factories every caller and every test builds these with — never a hand-built object literal. */
export const PrStateErrors = {
  invalid: ({ path, why }: { path: string; why: string }): PrStateInvalidError => ({
    code: "STATE_INVALID",
    message: `the pull-request snapshot at ${path} is not usable: ${why}`,
    path,
  }),
  unreadable: ({ cause, path }: { cause: unknown; path: string }): PrStateUnreadableError => ({
    cause,
    code: "STATE_UNREADABLE",
    message: `could not read the pull-request snapshot at ${path}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    path,
  }),
  unwritable: ({ cause, path }: { cause: unknown; path: string }): PrStateUnwritableError => ({
    cause,
    code: "STATE_UNWRITABLE",
    message: `could not write the pull-request snapshot at ${path}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    path,
  }),
} as const;
