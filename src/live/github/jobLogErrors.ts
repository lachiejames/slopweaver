/**
 * The failures a CI job-log read can report, as one typed union scoped to this read alone.
 *
 * Per `.claude/rules/error-handling.md` it is its OWN union rather than a member of some shared GitHub
 * error type: what a caller branches on here — "the run has no failed job" versus "GitHub has expired the
 * log" — has no counterpart in a pull-request read, and a union shared across the two would carry variants
 * neither could ever produce. The factory shape also keeps `src/live/github` off `error-shape-threshold`'s
 * growth path, since a message built by a factory is not an authored `err()` shape.
 */

/** The run id named no workflow run this token can see. */
interface RunNotFoundError {
  readonly code: "RUN_NOT_FOUND";
  readonly message: string;
  readonly runId: number;
}

/** `--job` named a job that is not in this run. */
interface JobNotFoundError {
  readonly code: "JOB_NOT_FOUND";
  readonly message: string;
  readonly job: string;
  readonly available: readonly string[];
}

/** The run exists and nothing in it failed — so there is no log a red leg is asking about. */
interface NoFailedJobError {
  readonly code: "NO_FAILED_JOB";
  readonly message: string;
  readonly runId: number;
  readonly conclusion: string;
}

/**
 * GitHub answered the log request with a gone/expired status.
 *
 * Its own variant rather than a generic fetch failure because the remedy is completely different: an
 * expired log is never coming back and the caller must re-run the job, whereas a transport failure is worth
 * retrying. GitHub retains Actions logs for a bounded window, so a session reading an old run meets this.
 */
interface LogUnavailableError {
  readonly code: "LOG_UNAVAILABLE";
  readonly message: string;
  readonly jobId: number;
}

/** The log request or its streamed body failed in transport. */
interface LogFetchFailedError {
  readonly code: "LOG_FETCH_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** GitHub answered the log route with a redirect carrying no `location` to follow. */
interface RedirectMissingError {
  readonly code: "REDIRECT_MISSING";
  readonly message: string;
  readonly jobId: number;
  readonly status: number;
}

/** A check's `detailsUrl` did not carry the Actions run and job ids a log read needs. */
interface UnreadableCheckUrlError {
  readonly code: "UNREADABLE_CHECK_URL";
  readonly message: string;
  readonly check: string;
}

/** One reason a job-log read could not answer. */
export type GithubJobLogError =
  | RunNotFoundError
  | JobNotFoundError
  | NoFailedJobError
  | LogUnavailableError
  | LogFetchFailedError
  | RedirectMissingError
  | UnreadableCheckUrlError;

/** Every job-log failure, built where its wording lives. */
export const GithubJobLogErrors = {
  jobNotFound: ({ job, available }: { job: string; available: readonly string[] }): JobNotFoundError => ({
    available,
    code: "JOB_NOT_FOUND",
    job,
    message: `no job named ${job} in this run; it has ${available.join(", ")}`,
  }),
  logFetchFailed: ({ cause, message }: { cause: unknown; message: string }): LogFetchFailedError => ({
    cause,
    code: "LOG_FETCH_FAILED",
    message: `reading the job log failed: ${message}`,
  }),
  logUnavailable: ({ jobId }: { jobId: number }): LogUnavailableError => ({
    code: "LOG_UNAVAILABLE",
    jobId,
    message:
      `GitHub no longer holds the log for job ${String(jobId)} — Actions logs expire, and an expired one ` +
      "never comes back. Re-run the job to get a fresh one",
  }),
  noFailedJob: ({ runId, conclusion }: { runId: number; conclusion: string }): NoFailedJobError => ({
    code: "NO_FAILED_JOB",
    conclusion,
    message: `run ${String(runId)} concluded ${conclusion} and no job in it failed — name one with --job`,
    runId,
  }),
  redirectMissing: ({ jobId, status }: { jobId: number; status: number }): RedirectMissingError => ({
    code: "REDIRECT_MISSING",
    jobId,
    message: `GitHub answered ${String(status)} for job ${String(jobId)}'s log with no location to follow`,
    status,
  }),
  runNotFound: ({ runId }: { runId: number }): RunNotFoundError => ({
    code: "RUN_NOT_FOUND",
    message: `no workflow run ${String(runId)} in this repository, or this token cannot see it`,
    runId,
  }),
  unreadableCheckUrl: ({ check }: { check: string }): UnreadableCheckUrlError => ({
    check,
    code: "UNREADABLE_CHECK_URL",
    message:
      `check ${check} carries no Actions run and job id — its details URL is not an Actions one, so its ` +
      "log is not GitHub's to serve",
  }),
} as const;
