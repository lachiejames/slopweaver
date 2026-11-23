/**
 * The two ways writing a reconstructed ruling fails, each carrying the typed cause the seam below it gave.
 *
 * Its own small union per `.claude/rules/error-handling.md`, and deliberately thin: the interesting failures
 * already have types — `RulingIntegrityError` says the evidence does not hold, `RowWriteError` says the write
 * did not report success — and re-wording either would make a caller read this module's prose instead of the
 * one that actually knows. What this adds is the distinction a caller acts on: **an integrity refusal wrote
 * nothing, and a write failure may have written something.**
 *
 * Pure: every factory takes an already-typed cause.
 */

import type { RowWriteError } from "./rowEventErrors.js";
import type { RulingIntegrityError } from "./rulingErrors.js";

/** The append seam refused the event on its evidence, before writing anything. */
export interface AppendIntegrityFailedError {
  readonly code: "APPEND_INTEGRITY_FAILED";
  readonly message: string;
  readonly cause: RulingIntegrityError;
}

/** The append was attempted and did not report success. Whether a line landed is NOT known from here. */
export interface AppendFailedError {
  readonly code: "APPEND_FAILED";
  readonly message: string;
  readonly cause: RowWriteError;
}

/** Every way one entry's write can fail. */
export type RulingBackfillFailure = AppendIntegrityFailedError | AppendFailedError;

/** Build one of this domain's failures — what the writer and every test construct them through. */
export const RulingBackfillFailures = {
  appendFailed: ({ cause }: { cause: RowWriteError }): AppendFailedError => ({
    cause,
    code: "APPEND_FAILED",
    message:
      `the append did not report success: ${cause.message} — re-run the same manifest, which reads the ` +
      "journal again and appends only what is still missing",
  }),
  integrityFailed: ({ cause }: { cause: RulingIntegrityError }): AppendIntegrityFailedError => ({
    cause,
    code: "APPEND_INTEGRITY_FAILED",
    message: `nothing was written: ${cause.message}`,
  }),
} as const;
