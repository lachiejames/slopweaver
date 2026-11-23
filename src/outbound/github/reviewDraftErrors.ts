/**
 * The typed failures of the GitHub review-draft register (`./reviewDraft.ts`): a review of someone else's pull
 * request, parked for the owner to read before anything reaches GitHub.
 *
 * Its own union, per `.claude/rules/error-handling.md`, because each one is branched on rather than only shown:
 * a post refuses a spent row differently from one whose content has drifted since the owner read it.
 */

/** No row in the register carries that id. */
export interface ReviewDraftNotFoundError {
  readonly code: "REVIEW_DRAFT_NOT_FOUND";
  readonly message: string;
  readonly id: string;
}

/** The row is no longer held: it has already been posted, or dropped. */
export interface ReviewDraftSpentError {
  readonly code: "REVIEW_DRAFT_SPENT";
  readonly message: string;
  readonly id: string;
  readonly state: "posted" | "dropped";
}

/** The row's recorded digest is not the digest of its own content, so its content changed after the owner read it. */
export interface ReviewDraftDriftedError {
  readonly code: "REVIEW_DRAFT_DRIFTED";
  readonly message: string;
  readonly id: string;
  readonly recorded: string;
  readonly recomputed: string;
}

/** The register could not be written. */
export interface ReviewDraftWriteFailedError {
  readonly code: "REVIEW_DRAFT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The register exists and could not be read. */
export interface ReviewDraftReadFailedError {
  readonly code: "REVIEW_DRAFT_READ_FAILED";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every failure of the review-draft register. */
export type ReviewDraftError =
  | ReviewDraftNotFoundError
  | ReviewDraftSpentError
  | ReviewDraftDriftedError
  | ReviewDraftWriteFailedError
  | ReviewDraftReadFailedError;

/** A thrown value's own words, or its string form when it is not an Error. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The one place a {@link ReviewDraftError} is constructed, so a test builds what the real code builds. */
export const ReviewDraftErrors = {
  drifted: ({
    id,
    recomputed,
    recorded,
  }: {
    id: string;
    recomputed: string;
    recorded: string;
  }): ReviewDraftDriftedError => ({
    code: "REVIEW_DRAFT_DRIFTED",
    id,
    message:
      `review draft ${id} records digest ${recorded}, and its stored content now digests to ${recomputed} — the ` +
      "register line changed after it was recorded, so no approval can cover it. Drop it and record it again.",
    recomputed,
    recorded,
  }),
  notFound: ({ id }: { id: string }): ReviewDraftNotFoundError => ({
    code: "REVIEW_DRAFT_NOT_FOUND",
    id,
    message: `no review draft ${id} in the register — \`slopweaver github review-draft list --all\` shows every id`,
  }),
  readFailed: ({ cause, path }: { cause: unknown; path: string }): ReviewDraftReadFailedError => ({
    cause,
    code: "REVIEW_DRAFT_READ_FAILED",
    message: `the review-draft register at ${path} exists and could not be read: ${causeText({ cause })}`,
    path,
  }),
  spent: ({ id, state }: { id: string; state: "posted" | "dropped" }): ReviewDraftSpentError => ({
    code: "REVIEW_DRAFT_SPENT",
    id,
    message: `review draft ${id} is already ${state}, so it cannot be ${state === "posted" ? "posted again" : "posted"}`,
    state,
  }),
  writeFailed: ({ cause, path }: { cause: unknown; path: string }): ReviewDraftWriteFailedError => ({
    cause,
    code: "REVIEW_DRAFT_WRITE_FAILED",
    message: `the review-draft register at ${path} could not be written: ${causeText({ cause })}`,
    path,
  }),
};
