/**
 * The description-review domain's failures: preparing the packet a fresh reviewer reads, recording what that
 * reviewer said, and deciding whether a pull-request description may be written on it.
 *
 * One union for this bounded module, per `.claude/rules/error-handling.md`. A caller branches on `code` (a
 * description nobody reviewed is a different failure from one a reviewer found BROKEN) and prints `message`.
 * Nothing here is a policy refusal with a hatch: a description reaches GitHub only over a CLEAN review of its
 * exact bytes, and every message that refuses a write says there is no way around that.
 */

/** A flag the verb was given that it cannot act on. */
export interface DescriptionReviewUsageError {
  readonly code: "USAGE";
  readonly message: string;
  readonly problems: readonly string[];
}

/** A title, body, image or evidence file the author named that could not be read. */
export interface DescriptionReviewInputUnreadableError {
  readonly code: "INPUT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** An image file whose bytes are not the digest its entry declares, so the reviewer would see another picture. */
export interface DescriptionReviewImageMismatchError {
  readonly code: "IMAGE_MISMATCH";
  readonly message: string;
  readonly path: string;
}

/** One of the written rules the packet carries could not be read from the tree it was selected from. */
export interface DescriptionReviewRulesUnreadableError {
  readonly code: "RULES_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A written rule absent at the reviewed head: the change set deleted or renamed it, and no other copy stands in. */
export interface DescriptionReviewRuleAbsentAtHeadError {
  readonly code: "RULE_ABSENT_AT_HEAD";
  readonly message: string;
  readonly path: string;
  readonly headRef: string;
  readonly headSha: string;
}

/** The change set's digest could not be computed from the checkout. */
export interface DescriptionReviewChangeDigestError {
  readonly code: "CHANGE_DIGEST_FAILED";
  readonly message: string;
}

/** The comments already on the pull request could not be read whole: a provider failure, a malformed node or a truncated page. */
export interface DescriptionReviewCommentsReadFailedError {
  readonly code: "COMMENTS_READ_FAILED";
  readonly message: string;
}

/** A packet could not be built, or one read back is not the shape this domain wrote. */
export interface DescriptionReviewPreparationFailedError {
  readonly code: "PREPARATION_FAILED";
  readonly message: string;
}

/** A packet already has its one review: this lane takes one pass per distinct packet. */
export interface DescriptionReviewAlreadyReviewedError {
  readonly code: "ALREADY_REVIEWED";
  readonly message: string;
  readonly manifestSha256: string;
  readonly receiptId: string;
}

/** A cited review id that cannot be used: absent, unreadable, or not a conclusive review. */
export interface DescriptionReviewUnusableError {
  readonly code: "REVIEW_UNUSABLE";
  readonly message: string;
  readonly reviewId: string;
}

/** A cited review that judged some other packet, other commits, or a narrower property. */
export interface DescriptionReviewWrongPacketError {
  readonly code: "REVIEW_WRONG_PACKET";
  readonly message: string;
  readonly reviewId: string;
}

/** A review the session that prepared the packet recorded for itself, or one whose sessions cannot be told apart. */
export interface DescriptionReviewerNotFreshError {
  readonly code: "REVIEWER_NOT_FRESH";
  readonly message: string;
}

/** A receipt that could not be written. */
export interface DescriptionReviewReceiptWriteError {
  readonly code: "RECEIPT_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** A receipt on disk that cannot be read, or that does not describe the packet its file name claims. */
export interface DescriptionReviewReceiptUnreadableError {
  readonly code: "RECEIPT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** No review covers the exact title, body, images, rules and change set the write would send. */
export interface DescriptionReviewMissingError {
  readonly code: "REVIEW_MISSING";
  readonly message: string;
  readonly manifestSha256: string;
  /** What differs from the nearest earlier review of this repository's description, empty when there is none. */
  readonly differences: readonly string[];
}

/** The review that covers these exact bytes came back BROKEN. */
export interface DescriptionReviewBrokenError {
  readonly code: "REVIEW_BROKEN";
  readonly message: string;
  readonly receiptId: string;
}

/** Every failure of the description-review domain. */
export type DescriptionReviewError =
  | DescriptionReviewUsageError
  | DescriptionReviewInputUnreadableError
  | DescriptionReviewImageMismatchError
  | DescriptionReviewRulesUnreadableError
  | DescriptionReviewRuleAbsentAtHeadError
  | DescriptionReviewChangeDigestError
  | DescriptionReviewCommentsReadFailedError
  | DescriptionReviewPreparationFailedError
  | DescriptionReviewAlreadyReviewedError
  | DescriptionReviewUnusableError
  | DescriptionReviewWrongPacketError
  | DescriptionReviewerNotFreshError
  | DescriptionReviewReceiptWriteError
  | DescriptionReviewReceiptUnreadableError
  | DescriptionReviewMissingError
  | DescriptionReviewBrokenError;

/** The sentence every write refusal ends on, so no reader goes looking for a hatch that does not exist. */
const NO_HATCH =
  "There is no escape hatch: a description reaches GitHub only over a CLEAN review of these exact bytes.";

/** The leading digits of a digest, enough for a reader to tell two apart. */
const SHORT = 12;

/** Builders for every {@link DescriptionReviewError}, the only way this domain makes one. */
export const DescriptionReviewErrors = {
  alreadyReviewed: ({
    manifestSha256,
    receiptId,
    verdict,
  }: {
    manifestSha256: string;
    receiptId: string;
    verdict: "CLEAN" | "BROKEN";
  }): DescriptionReviewAlreadyReviewedError => ({
    code: "ALREADY_REVIEWED",
    manifestSha256,
    message:
      `packet ${manifestSha256.slice(0, SHORT)}… already has its review (receipt ${receiptId}, ${verdict}). ` +
      (verdict === "CLEAN"
        ? "The write verb sends these exact bytes as they stand; nothing more is owed."
        : "This lane takes one pass per distinct description: change the title, body, comments or images, then prepare again."),
    receiptId,
  }),
  broken: ({ receiptId, summary }: { receiptId: string; summary: string }): DescriptionReviewBrokenError => ({
    code: "REVIEW_BROKEN",
    message:
      `the description review of these exact bytes came back BROKEN (receipt ${receiptId}): ${summary} ` +
      `Fix the description, then prepare and review it again. ${NO_HATCH}`,
    receiptId,
  }),
  changeDigestFailed: ({ detail }: { detail: string }): DescriptionReviewChangeDigestError => ({
    code: "CHANGE_DIGEST_FAILED",
    message: `the change set's digest could not be computed: ${detail}`,
  }),
  commentsReadFailed: ({ detail }: { detail: string }): DescriptionReviewCommentsReadFailedError => ({
    code: "COMMENTS_READ_FAILED",
    message: `the pull request's existing comments could not be read whole, so no review can say the description answers to them: ${detail}`,
  }),
  imageMismatch: ({
    path,
    declared,
    actual,
  }: {
    path: string;
    declared: string;
    actual: string;
  }): DescriptionReviewImageMismatchError => ({
    code: "IMAGE_MISMATCH",
    message: `${path} holds bytes ${actual.slice(0, SHORT)}…, not the ${declared.slice(0, SHORT)}… its entry declares`,
    path,
  }),
  inputUnreadable: ({ path, detail }: { path: string; detail: string }): DescriptionReviewInputUnreadableError => ({
    code: "INPUT_UNREADABLE",
    message: `${path} cannot be read: ${detail}`,
    path,
  }),
  missing: ({
    manifestSha256,
    differences,
  }: {
    manifestSha256: string;
    differences: readonly string[];
  }): DescriptionReviewMissingError => ({
    code: "REVIEW_MISSING",
    differences,
    manifestSha256,
    message:
      `no description review covers packet ${manifestSha256.slice(0, SHORT)}… (the exact title, body, images, ` +
      "written rules and change set this write sends)" +
      (differences.length === 0
        ? ". "
        : `; against the last review of this repository's description, ${differences.join(", ")}. `) +
      "Run `slopweaver github pr review-prepare` over the exact title and body this verb sends, have a fresh " +
      `reviewer take the pass, then \`slopweaver github pr review-record\`. ${NO_HATCH}`,
  }),
  notFresh: ({ why }: { why: string }): DescriptionReviewerNotFreshError => ({
    code: "REVIEWER_NOT_FRESH",
    message: `the review is not from a fresh reviewer: ${why}`,
  }),
  preparationFailed: ({ detail }: { detail: string }): DescriptionReviewPreparationFailedError => ({
    code: "PREPARATION_FAILED",
    message: `description review packet: ${detail}`,
  }),
  receiptUnreadable: ({ path, detail }: { path: string; detail: string }): DescriptionReviewReceiptUnreadableError => ({
    code: "RECEIPT_UNREADABLE",
    message: `description review receipt ${path}: ${detail}`,
    path,
  }),
  receiptWriteFailed: ({ path, detail }: { path: string; detail: string }): DescriptionReviewReceiptWriteError => ({
    code: "RECEIPT_WRITE_FAILED",
    message: `description review receipt ${path} could not be written: ${detail}`,
    path,
  }),
  ruleAbsentAtHead: ({
    path,
    headRef,
    headSha,
  }: {
    path: string;
    headRef: string;
    headSha: string;
  }): DescriptionReviewRuleAbsentAtHeadError => ({
    code: "RULE_ABSENT_AT_HEAD",
    headRef,
    headSha,
    message:
      `written rule ${path} is absent at the head under review (ref ${JSON.stringify(headRef)}, commit ${headSha}), ` +
      "so no packet can be judged against it; the installed copy is never substituted. Restore the file at that " +
      "path, or land the change to the rule list first.",
    path,
  }),
  rulesUnreadable: ({
    path,
    source,
    detail,
  }: {
    path: string;
    source: string;
    detail: string;
  }): DescriptionReviewRulesUnreadableError => ({
    code: "RULES_UNREADABLE",
    message: `written rule ${path} cannot be read from ${source}: ${detail}`,
    path,
  }),
  unusable: ({ reviewId, why }: { reviewId: string; why: string }): DescriptionReviewUnusableError => ({
    code: "REVIEW_UNUSABLE",
    message: `review ${reviewId} cannot be recorded: ${why}`,
    reviewId,
  }),
  usage: ({ problems }: { problems: readonly string[] }): DescriptionReviewUsageError => ({
    code: "USAGE",
    message: problems.join("; "),
    problems,
  }),
  wrongPacket: ({ reviewId, why }: { reviewId: string; why: string }): DescriptionReviewWrongPacketError => ({
    code: "REVIEW_WRONG_PACKET",
    message: `review ${reviewId} is not a review of this packet: ${why}`,
    reviewId,
  }),
} as const;
