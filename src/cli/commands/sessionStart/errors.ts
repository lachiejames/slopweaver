/**
 * The typed failures `session-start` and `session-start lock-in` author themselves: a flag given a value it
 * does not accept or not given at all, a lock-in whose outcome and extras disagree, and a GitHub leg that
 * could not read the owner's pull requests.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The flag
 * tokeniser's own refusals (`parseFlags`) are not re-authored here: they arrive as its string list and are
 * printed as they came.
 */

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface SessionStartInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A required flag was not given, or was given blank. */
export interface SessionStartFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** One refusal of a single lock-in flag — what {@link SessionStartLockInRefusedError} collects. */
export type SessionStartFlagRefusal = SessionStartInvalidFlagValueError | SessionStartFlagMissingError;

/**
 * One or more lock-in flags were refused. Every one is reported at once, rather than one per run, so the
 * caller composing the reply can fix them together.
 */
export interface SessionStartLockInRefusedError {
  readonly code: "LOCK_IN_REFUSED";
  readonly message: string;
  readonly refusals: readonly SessionStartFlagRefusal[];
}

/** Every flag parsed, and the outcome disagrees with its extras; `reasons` names each disagreement. */
export interface SessionStartOutcomeIncoherentError {
  readonly code: "OUTCOME_INCOHERENT";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `profile.json` declares no `mainCheckouts`, so nothing names the repositories the GitHub leg reads. */
export interface SessionStartNoMainCheckoutsError {
  readonly code: "NO_MAIN_CHECKOUTS";
  readonly message: string;
}

/** The review-state read behind the GitHub leg failed; `reasons` is its own list. */
export interface SessionStartReviewStatesUnreadError {
  readonly code: "REVIEW_STATES_UNREAD";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure this verb directory authors. */
export type SessionStartError =
  | SessionStartInvalidFlagValueError
  | SessionStartFlagMissingError
  | SessionStartLockInRefusedError
  | SessionStartOutcomeIncoherentError
  | SessionStartNoMainCheckoutsError
  | SessionStartReviewStatesUnreadError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SessionStartErrors = {
  flagMissing: ({ flag }: { flag: string }): SessionStartFlagMissingError => ({
    code: "FLAG_MISSING",
    flag,
    message: `${flag} is required`,
  }),
  lockInRefused: ({ refusals }: { refusals: readonly SessionStartFlagRefusal[] }): SessionStartLockInRefusedError => ({
    code: "LOCK_IN_REFUSED",
    message: refusals.map((refusal) => refusal.message).join("; "),
    refusals,
  }),
  noMainCheckouts: (): SessionStartNoMainCheckoutsError => ({
    code: "NO_MAIN_CHECKOUTS",
    message:
      "your pull requests are not here: `profile.json` declares no `mainCheckouts`, so nothing names the repositories to read",
  }),
  notInVocabulary: ({
    flag,
    allowed,
    got,
  }: {
    flag: string;
    allowed: readonly string[];
    got: string;
  }): SessionStartInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got,
    message: `${flag} must be one of ${allowed.join(", ")}, got ${got}`,
  }),
  outcomeIncoherent: ({ reasons }: { reasons: readonly string[] }): SessionStartOutcomeIncoherentError => ({
    code: "OUTCOME_INCOHERENT",
    message: reasons.join("; "),
    reasons,
  }),
  reviewStatesUnread: ({ reasons }: { reasons: readonly string[] }): SessionStartReviewStatesUnreadError => ({
    code: "REVIEW_STATES_UNREAD",
    message: reasons.join("; "),
    reasons,
  }),
  deadlineNotAnInstant: ({ got }: { got: string }): SessionStartInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--deadline",
    got,
    message: `--deadline must be an ISO instant ending in Z, got ${got}`,
  }),
  topNotPositive: ({ got }: { got: string }): SessionStartInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--top",
    got,
    message: `--top must be a whole number of at least 1, got ${got}`,
  }),
  vocabularyFlagMissing: ({
    flag,
    allowed,
  }: {
    flag: string;
    allowed: readonly string[];
  }): SessionStartFlagMissingError => ({
    code: "FLAG_MISSING",
    flag,
    message: `${flag} is required — one of ${allowed.join(", ")}`,
  }),
} as const;

/**
 * The lines a {@link SessionStartError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function sessionStartErrorLines({ error }: { error: SessionStartError }): readonly string[] {
  if (error.code === "LOCK_IN_REFUSED") {
    return error.refusals.map((refusal) => refusal.message);
  }
  if (error.code === "OUTCOME_INCOHERENT" || error.code === "REVIEW_STATES_UNREAD") {
    return error.reasons;
  }
  return [error.message];
}
