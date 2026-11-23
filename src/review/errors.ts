/**
 * The typed failures `src/review` authors: a CODEOWNERS slice that cannot be known, a landing reading this build does
 * not read, and a Slack bronze that could not be listed. Scoped to this directory per `.claude/rules/error-handling.md`.
 *
 * The slice refusal keeps its multiplicity: one {@link CodeOwnerSliceReason} per simultaneous cause, in the order the
 * slice found them, so {@link reviewErrorLines} prints one line per reason exactly as the verb printed a string list.
 */

/** A CODEOWNERS file escapes a character with a backslash, so which files are the owner's cannot be known. */
export interface CodeOwnersEscapeUndocumentedReason {
  readonly code: "CODEOWNERS_ESCAPE_UNDOCUMENTED";
  readonly message: string;
  readonly lines: readonly number[];
}

/** GitHub reports an error on the CODEOWNERS line deciding some files. */
export interface CodeOwnersLineErrorReason {
  readonly code: "CODEOWNERS_LINE_ERROR";
  readonly message: string;
  readonly paths: readonly string[];
}

/** The CODEOWNERS line deciding some files names an email owner. */
export interface CodeOwnersEmailOwnerReason {
  readonly code: "CODEOWNERS_EMAIL_OWNER";
  readonly message: string;
  readonly paths: readonly string[];
}

/** A rename moved a file between a path that is the owner's and one that is not. */
export interface CodeOwnersRenameAmbiguousReason {
  readonly code: "CODEOWNERS_RENAME_AMBIGUOUS";
  readonly message: string;
  readonly paths: readonly string[];
}

/** One cause that makes a code-owner slice unknowable. */
export type CodeOwnerSliceReason =
  | CodeOwnersEscapeUndocumentedReason
  | CodeOwnersLineErrorReason
  | CodeOwnersEmailOwnerReason
  | CodeOwnersRenameAmbiguousReason;

/** The slice cannot be known; `reasons` holds every cause in order. */
export interface ReviewCodeOwnerSliceUnknowableError {
  readonly code: "CODE_OWNER_SLICE_UNKNOWABLE";
  readonly message: string;
  readonly reasons: readonly CodeOwnerSliceReason[];
}

/** The owner's files' line counts total past what is counted exactly. */
export interface ReviewCodeOwnerCountsUnsafeError {
  readonly code: "CODE_OWNER_COUNTS_UNSAFE";
  readonly message: string;
}

/** The last landing reading does not parse; `where` names the first malformed field. */
export interface ReviewReadingMalformedError {
  readonly code: "REVIEWER_READING_MALFORMED";
  readonly message: string;
  readonly where: string;
}

/** The Slack bronze directory could not be listed. */
export interface ReviewSlackBronzeUnlistableError {
  readonly code: "SLACK_BRONZE_UNLISTABLE";
  readonly message: string;
  readonly dir: string;
  readonly cause: unknown;
}

/** Every failure `src/review` raises. */
export type ReviewError =
  | ReviewCodeOwnerSliceUnknowableError
  | ReviewCodeOwnerCountsUnsafeError
  | ReviewReadingMalformedError
  | ReviewSlackBronzeUnlistableError;

/** The factory the review modules call, so a test built the same way catches a drift. */
export const ReviewErrors = {
  codeOwnerCountsUnsafe: (): ReviewCodeOwnerCountsUnsafeError => ({
    code: "CODE_OWNER_COUNTS_UNSAFE",
    message: "the owner's files' line counts total past what is counted exactly",
  }),
  codeOwnerSliceUnknowable: ({
    reasons,
  }: {
    reasons: readonly CodeOwnerSliceReason[];
  }): ReviewCodeOwnerSliceUnknowableError => ({
    code: "CODE_OWNER_SLICE_UNKNOWABLE",
    message: reasons.map((reason) => reason.message).join("; "),
    reasons,
  }),
  emailOwner: ({ paths }: { paths: readonly string[] }): CodeOwnersEmailOwnerReason => {
    const sorted = paths.toSorted();
    return {
      code: "CODEOWNERS_EMAIL_OWNER",
      message: `the CODEOWNERS line deciding ${sorted.join(", ")} names an email owner, and whose account that email is was not read, so whether those files are the owner's is unknown`,
      paths: sorted,
    };
  },
  escapeUndocumented: ({ lines }: { lines: readonly number[] }): CodeOwnersEscapeUndocumentedReason => ({
    code: "CODEOWNERS_ESCAPE_UNDOCUMENTED",
    lines,
    message: `CODEOWNERS line ${lines.map(String).join(", ")} escapes a character with a backslash, and how GitHub reads that is undocumented, so which files are the owner's is unknown`,
  }),
  lineError: ({ paths }: { paths: readonly string[] }): CodeOwnersLineErrorReason => {
    const sorted = paths.toSorted();
    return {
      code: "CODEOWNERS_LINE_ERROR",
      message: `GitHub reports an error on the CODEOWNERS line deciding ${sorted.join(", ")}, so whose those files are is unknown`,
      paths: sorted,
    };
  },
  readingMalformed: ({ where }: { where: string }): ReviewReadingMalformedError => ({
    code: "REVIEWER_READING_MALFORMED",
    message: `the last github landing reading is not one this build reads: ${where} is malformed`,
    where,
  }),
  renameAmbiguous: ({ paths }: { paths: readonly string[] }): CodeOwnersRenameAmbiguousReason => {
    const sorted = paths.toSorted();
    return {
      code: "CODEOWNERS_RENAME_AMBIGUOUS",
      message: `${sorted.join(", ")} renamed a file between a path that is the owner's and one that is not, and which path GitHub routes a review by is undocumented, so whether it is the owner's is unknown`,
      paths: sorted,
    };
  },
  slackBronzeUnlistable: ({ dir, cause }: { dir: string; cause: unknown }): ReviewSlackBronzeUnlistableError => ({
    cause,
    code: "SLACK_BRONZE_UNLISTABLE",
    dir,
    message: `the Slack bronze at ${dir} could not be listed: ${cause instanceof Error ? cause.message : "unlistable"}`,
  }),
} as const;

/**
 * The lines a review failure prints: one per reason for an unknowable slice, else the single message.
 *
 * @returns the diagnostic lines, byte for byte what the verbs printed as a string list
 */
export function reviewErrorLines({ error }: { error: ReviewError }): readonly string[] {
  if (error.code === "CODE_OWNER_SLICE_UNKNOWABLE") {
    return error.reasons.map((reason) => reason.message);
  }
  return [error.message];
}
