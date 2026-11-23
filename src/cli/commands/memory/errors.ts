/**
 * The `memory` noun's typed failures — one union for every way a memory verb can refuse its own arguments or
 * decline to judge a corpus.
 *
 * ## Why this directory has a union at all
 *
 * `error-shape-threshold` in `yarn lint`: past FOUR distinct plain error shapes, a directory declares its
 * `<Domain>Error` union and routes its failures through it. `check`, `sweep` and `hook` sat at exactly four —
 * `--dir` missing, `--dir` relative, `--stale-after` unparseable, `--dir` with `--from-payload` — so `hygiene`
 * and `grade` could not add one without crossing it. The gate is the reason this file exists, and the branch
 * below is the reason it is not ceremony.
 *
 * ## The one variant a caller really branches on
 *
 * {@link CorpusTooFreshError}. Every other variant is a usage fault and exits 2; this one means the corpus was
 * mid-save when the pass started, which is not the caller's mistake and is not a fault at all. `hygiene` maps
 * it to `EXIT_DEFERRED`, which `automation run-due` leaves UNSTAMPED — so the row comes back at its next firing
 * instead of being recorded as a run that happened. A shared string shape could not carry that distinction,
 * and a run that judged a half-written corpus would propose dropping a memory another session was writing.
 */

/** A required flag was absent. */
export interface MissingFlagError {
  readonly code: "MISSING_FLAG";
  readonly message: string;
  /** The flag, `--`-prefixed, so a caller can name it without rebuilding the string. */
  readonly flag: string;
}

/** A path flag was given something relative. */
export interface RelativePathError {
  readonly code: "RELATIVE_PATH";
  readonly message: string;
  readonly flag: string;
  readonly value: string;
}

/** A numeric flag was given something that is not a whole, non-negative number. */
export interface NotWholeNumberError {
  readonly code: "NOT_WHOLE_NUMBER";
  readonly message: string;
  readonly flag: string;
  readonly value: string;
}

/** Two flags that cannot both be given were. */
export interface ExclusiveFlagsError {
  readonly code: "EXCLUSIVE_FLAGS";
  readonly message: string;
  readonly flags: readonly string[];
}

/** A positional argument the verb needs was absent. */
export interface MissingArgumentError {
  readonly code: "MISSING_ARGUMENT";
  readonly message: string;
  /** What the argument is called in the usage line. */
  readonly argument: string;
}

/** A word offered where the closed set of answers was expected. */
export interface UnknownAnswerError {
  readonly code: "UNKNOWN_ANSWER";
  readonly message: string;
  readonly value: string;
  readonly allowed: readonly string[];
}

/** No proposal in the ledger carries the id a grade named. */
export interface ProposalNotFoundError {
  readonly code: "PROPOSAL_NOT_FOUND";
  readonly message: string;
  readonly id: string;
}

/**
 * The corpus changed too recently to be judged.
 *
 * NOT a fault, which is why it is a variant rather than a message: worktrees share one memory directory, so
 * another session can be mid-save when a scheduled pass starts. See this module's header for what the caller
 * does with it.
 */
export interface CorpusTooFreshError {
  readonly code: "CORPUS_TOO_FRESH";
  readonly message: string;
  /** How long ago the directory last changed, so a reader can see how close the call was. */
  readonly millisSinceChange: number;
  /** The quiet period it failed to clear. */
  readonly quietPeriodMs: number;
}

/** Every way a `memory` verb refuses. */
export type MemoryVerbError =
  | MissingFlagError
  | RelativePathError
  | NotWholeNumberError
  | ExclusiveFlagsError
  | MissingArgumentError
  | UnknownAnswerError
  | ProposalNotFoundError
  | CorpusTooFreshError;

/** The factory every memory verb constructs its refusals through. */
export const MemoryVerbErrors = {
  corpusTooFresh: ({
    millisSinceChange,
    quietPeriodMs,
  }: {
    millisSinceChange: number;
    quietPeriodMs: number;
  }): CorpusTooFreshError => ({
    code: "CORPUS_TOO_FRESH",
    message:
      `the corpus changed ${String(millisSinceChange)}ms ago, inside the ${String(quietPeriodMs)}ms quiet ` +
      "period — another session may be mid-save, so this run judged nothing and will come back",
    millisSinceChange,
    quietPeriodMs,
  }),
  exclusiveFlags: ({ flags }: { flags: readonly string[] }): ExclusiveFlagsError => ({
    code: "EXCLUSIVE_FLAGS",
    flags,
    message: `${flags.join(" and ")} are mutually exclusive`,
  }),
  missingArgument: ({ argument }: { argument: string }): MissingArgumentError => ({
    argument,
    code: "MISSING_ARGUMENT",
    message: `<${argument}> is required`,
  }),
  missingDir: (): MissingFlagError => ({
    code: "MISSING_FLAG",
    flag: "--dir",
    message: "--dir is required (there is no default: auto-memory is keyed to the repository, not the cwd)",
  }),
  missingFlag: ({ flag, why }: { flag: string; why: string }): MissingFlagError => ({
    code: "MISSING_FLAG",
    flag,
    message: `${flag} is required (${why})`,
  }),
  notWholeNumber: ({ flag, value }: { flag: string; value: string }): NotWholeNumberError => ({
    code: "NOT_WHOLE_NUMBER",
    flag,
    message: `${flag} must be a whole number of days, got \`${value}\``,
    value,
  }),
  proposalNotFound: ({ id }: { id: string }): ProposalNotFoundError => ({
    code: "PROPOSAL_NOT_FOUND",
    id,
    message: `no proposal carries the id \`${id}\` — run \`slopweaver memory hygiene\` to see the current ones`,
  }),
  relativePath: ({ flag, value }: { flag: string; value: string }): RelativePathError => ({
    code: "RELATIVE_PATH",
    flag,
    message: `${flag} must be an absolute path, got \`${value}\``,
    value,
  }),
  unknownAnswer: ({ value, allowed }: { value: string; allowed: readonly string[] }): UnknownAnswerError => ({
    allowed,
    code: "UNKNOWN_ANSWER",
    message: `\`${value}\` is not an answer — use one of ${allowed.join(", ")}`,
    value,
  }),
} as const;
