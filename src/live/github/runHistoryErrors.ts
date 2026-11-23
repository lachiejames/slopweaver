/**
 * The typed domain error for a workflow-run HISTORY read — the timings half of the GitHub door.
 *
 * Its own union rather than a reuse of `./errors.ts`'s `GithubLiveError`, per
 * `.claude/rules/error-handling.md`: a named-object read fails because an address is wrong or an object is
 * invisible, and a history read fails because a workflow name matched nothing, a page came back in a shape
 * no job could be read out of, or every run in the window was unreadable. Those are different questions,
 * and a caller branching on one should not have to carry the other's variants.
 */

/** The provider call itself failed — network, rate limit, a 404 on the repository or the workflow file. */
export interface RunHistoryFetchFailedError {
  readonly code: "RUN_HISTORY_FETCH_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/** GitHub answered, but the payload was not a page of workflow runs (or of jobs) at all. */
export interface RunHistoryUnreadableError {
  readonly code: "RUN_HISTORY_UNREADABLE";
  readonly message: string;
  /** What was being read when the shape failed — `runs` or `jobs`, plus the run id when there is one. */
  readonly subject: string;
}

/** The selection matched no workflow run at all, so there is nothing to time. */
export interface RunHistoryEmptyError {
  readonly code: "RUN_HISTORY_EMPTY";
  readonly message: string;
  /** The selection that matched nothing, spelled the way the caller typed it. */
  readonly selection: string;
}

/** Every failure a workflow-run history read can produce. */
export type GithubRunHistoryError = RunHistoryFetchFailedError | RunHistoryUnreadableError | RunHistoryEmptyError;

/** Factories for every {@link GithubRunHistoryError} variant. */
export const GithubRunHistoryErrors = {
  /** @returns a {@link RunHistoryEmptyError} naming the selection that matched nothing */
  empty: ({ selection }: { selection: string }): RunHistoryEmptyError => ({
    code: "RUN_HISTORY_EMPTY",
    message: `no completed workflow run matched ${selection} — nothing to time`,
    selection,
  }),

  /** @returns a {@link RunHistoryFetchFailedError} wrapping the underlying provider failure */
  fetchFailed: ({ message, cause }: { message: string; cause?: unknown }): RunHistoryFetchFailedError => ({
    code: "RUN_HISTORY_FETCH_FAILED",
    message,
    ...(cause !== undefined ? { cause } : {}),
  }),

  /** @returns a {@link RunHistoryUnreadableError} naming what was being read when the shape failed */
  unreadable: ({ subject }: { subject: string }): RunHistoryUnreadableError => ({
    code: "RUN_HISTORY_UNREADABLE",
    message: `GitHub's ${subject} payload was not a readable page — no timing can be taken from it`,
    subject,
  }),
} as const;
