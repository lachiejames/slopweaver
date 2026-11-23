/**
 * The typed domain error for a `github ci-timing` report — the one way it can fail once its arguments parse
 * and its repository resolves: the run's jobs could not be read whole.
 *
 * Its own union rather than a reuse of `./runHistoryErrors.ts`, per `.claude/rules/error-handling.md`: a
 * history read fails because a selection matched nothing or a page was unreadable, while this read is one
 * run's every attempt held to the total GitHub reported. Where the two meet — a page read that failed — the
 * history error's own `message` is forwarded rather than re-worded.
 */

/** Reading the run's jobs failed, or could not be read whole — the underlying message, forwarded. */
export interface CiTimingRunReadFailedError {
  readonly code: "CI_TIMING_RUN_READ_FAILED";
  readonly message: string;
}

/** Every failure a `github ci-timing` run read can produce. */
export type CiTimingError = CiTimingRunReadFailedError;

/** Factories for every {@link CiTimingError} variant. */
export const CiTimingErrors = {
  /** @returns a {@link CiTimingRunReadFailedError} carrying the read's own wording */
  runReadFailed: ({ message }: { message: string }): CiTimingRunReadFailedError => ({
    code: "CI_TIMING_RUN_READ_FAILED",
    message,
  }),
} as const;
