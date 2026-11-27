/**
 * The page-review domain's failures: preparing the repository a review reads, resolving a cited review back to
 * the page it judged, and deciding whether a page may publish on it.
 *
 * One union for this bounded module, per `.claude/rules/error-handling.md` — a caller branches on `code` (a
 * citation that is false is a different failure from one that is merely unanswered) and prints `message`.
 */

/** A preparation the verb could not build, or one read back that is not the shape it wrote. */
export interface PreparationFailedError {
  readonly code: "PREPARATION_FAILED";
  readonly message: string;
}

/** An `--inputs` file the author named that could not be read. */
export interface InputUnreadableError {
  readonly code: "INPUT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * An input or the page holding a NUL byte. The review's `.gitattributes` forces a text diff, so the raw byte would
 * land in the text a reviewer reads; an attributes file outranking it would show `Binary files … differ` instead.
 */
export interface FileNotTextError {
  readonly code: "FILE_NOT_TEXT";
  readonly message: string;
  readonly file: string;
}

/** A cited id that names no Codex pass and no Claude fallback receipt. */
export interface ReviewNotFoundError {
  readonly code: "REVIEW_NOT_FOUND";
  readonly message: string;
  readonly reviewId: string;
}

/** A cited id whose Codex pass record is on disk but cannot be read or decoded. */
export interface ReviewUnreadableError {
  readonly code: "REVIEW_UNREADABLE";
  readonly message: string;
  readonly reviewId: string;
}

/** Two cited ids that name the same review, which the fold would otherwise count as two checks. */
export interface ReviewCitedTwiceError {
  readonly code: "REVIEW_CITED_TWICE";
  readonly message: string;
  readonly reviewId: string;
}

/** A cited pass that is not a conclusive review: a plan, a no-verdict, a transport fault. */
export interface ReviewInconclusiveError {
  readonly code: "REVIEW_INCONCLUSIVE";
  readonly message: string;
  readonly reviewId: string;
}

/** A cited review whose repository, commits, diff or page bytes are not this page's preparation. */
export interface ReviewWrongPageError {
  readonly code: "REVIEW_WRONG_PAGE";
  readonly message: string;
  readonly reviewId: string;
}

/** The fallback store could not be read, so a cited receipt can be neither found nor ruled out. */
export interface ReviewStoreUnavailableError {
  readonly code: "REVIEW_STORE_UNAVAILABLE";
  readonly message: string;
  readonly reviewId: string;
}

/** The published page differs from the reviewed one, or a review came back BROKEN, and nothing says what changed. */
export interface ReviewChangedRequiredError {
  readonly code: "REVIEW_CHANGED_REQUIRED";
  readonly message: string;
}

/** The record could not be written beside a page that was already published. */
export interface ReviewRecordWriteFailedError {
  readonly code: "REVIEW_RECORD_WRITE_FAILED";
  readonly message: string;
}

/** Every way the page-review domain fails. */
export type PageReviewError =
  | PreparationFailedError
  | InputUnreadableError
  | FileNotTextError
  | ReviewNotFoundError
  | ReviewUnreadableError
  | ReviewCitedTwiceError
  | ReviewInconclusiveError
  | ReviewWrongPageError
  | ReviewStoreUnavailableError
  | ReviewChangedRequiredError
  | ReviewRecordWriteFailedError;

/** The one factory every page-review failure is built through. */
export const PageReviewErrors = {
  fileNotText: ({ file }: { file: string }): FileNotTextError => ({
    code: "FILE_NOT_TEXT",
    file,
    message: `${file} holds a NUL byte, and the diff a reviewer reads is text, so it would arrive as a raw control byte or as a binary marker — pass it as text`,
  }),
  inputUnreadable: ({ path, detail }: { path: string; detail: string }): InputUnreadableError => ({
    code: "INPUT_UNREADABLE",
    message: `could not read --inputs file ${path}: ${detail}`,
    path,
  }),
  preparationFailed: ({ detail }: { detail: string }): PreparationFailedError => ({
    code: "PREPARATION_FAILED",
    message: `the page review could not be prepared: ${detail}`,
  }),
  reviewNotFound: ({ reviewId }: { reviewId: string }): ReviewNotFoundError => ({
    code: "REVIEW_NOT_FOUND",
    message:
      `--review ${reviewId} names no Codex pass under the home's orchestration directory and no recorded ` +
      "Claude fallback receipt — cite the artifact id `codex review` printed, or the receipt id `codex review-fallback record` printed",
    reviewId,
  }),
  reviewUnreadable: ({ reviewId, path }: { reviewId: string; path: string }): ReviewUnreadableError => ({
    code: "REVIEW_UNREADABLE",
    message: `--review ${reviewId} names a Codex pass whose record at ${path} cannot be read or decoded, so it can be neither trusted nor ruled out — re-run the pass`,
    reviewId,
  }),
  reviewCitedTwice: ({ reviewId, first }: { reviewId: string; first: string }): ReviewCitedTwiceError => ({
    code: "REVIEW_CITED_TWICE",
    message: `--review ${reviewId} names the same review as ${first}; cite each review once, so the fold counts the checks that ran`,
    reviewId,
  }),
  reviewInconclusive: ({ reviewId, why }: { reviewId: string; why: string }): ReviewInconclusiveError => ({
    code: "REVIEW_INCONCLUSIVE",
    message: `--review ${reviewId} is not a conclusive review (${why}); a NO_VERDICT or FATAL pass established nothing, so narrow the property and re-run it`,
    reviewId,
  }),
  reviewWrongPage: ({ reviewId, why }: { reviewId: string; why: string }): ReviewWrongPageError => ({
    code: "REVIEW_WRONG_PAGE",
    message: `--review ${reviewId} did not review this page: ${why}`,
    reviewId,
  }),
  reviewStoreUnavailable: ({
    reviewId,
    detail,
  }: {
    reviewId: string;
    detail: string;
  }): ReviewStoreUnavailableError => ({
    code: "REVIEW_STORE_UNAVAILABLE",
    message: `--review ${reviewId} is no Codex pass, and the Claude fallback store that could hold it cannot be read: ${detail}`,
    reviewId,
  }),
  reviewChangedRequired: ({ why }: { why: string }): ReviewChangedRequiredError => ({
    code: "REVIEW_CHANGED_REQUIRED",
    message: `${why}, so --review-changed "<what you changed after the review>" is required — the page tells the owner what changed since it was reviewed`,
  }),
  reviewRecordWriteFailed: ({ path, detail }: { path: string; detail: string }): ReviewRecordWriteFailedError => ({
    code: "REVIEW_RECORD_WRITE_FAILED",
    message: `the page was published with its review fold, and writing its review record to ${path} failed: ${detail}. Re-run the same publish to complete it`,
  }),
} as const;
