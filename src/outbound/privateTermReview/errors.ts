/**
 * Every way the private-words review refuses, one union for the domain (`./types.ts`). No variant carries a
 * private term's pattern, source, meaning or matched text: a message names ids, classes, paths and reasons.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** A file or directory the review keeps could not be read or written. */
interface ReviewIoFailedError {
  readonly code: "REVIEW_IO_FAILED";
  readonly message: string;
}

/** No hold carries the id named, or the one that does is not this domain's shape. */
interface HoldUnusableError {
  readonly code: "HOLD_UNUSABLE";
  readonly message: string;
}

/** The review cited cannot be used: not found, inconclusive, or not a review at all. */
interface ReviewUnusableError {
  readonly code: "REVIEW_UNUSABLE";
  readonly message: string;
  readonly reviewId: string;
}

/** The review cited judged something other than this hold's packet. */
interface WrongPacketError {
  readonly code: "WRONG_PACKET";
  readonly message: string;
  readonly reviewId: string;
}

/** The reviewer was the session that held or prepared the write. */
interface NotFreshError {
  readonly code: "NOT_FRESH";
  readonly message: string;
}

/** That review already has a receipt. */
interface AlreadyRecordedError {
  readonly code: "ALREADY_RECORDED";
  readonly message: string;
}

/** A verb's arguments, before anything was read. */
interface ReviewUsageError {
  readonly code: "USAGE";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Every way the private-words review refuses. */
export type PrivateTermReviewError =
  | ReviewIoFailedError
  | HoldUnusableError
  | ReviewUnusableError
  | WrongPacketError
  | NotFreshError
  | AlreadyRecordedError
  | ReviewUsageError;

/** The factory every refusal of the domain is built through. */
export const PrivateTermReviewErrors = {
  alreadyRecorded: ({ reviewId, receiptId }: { reviewId: string; receiptId: string }): AlreadyRecordedError => ({
    code: "ALREADY_RECORDED",
    message: `review ${reviewId} is already receipt ${receiptId}; one review is one receipt`,
  }),
  holdUnusable: ({ holdId, why }: { holdId: string; why: string }): HoldUnusableError => ({
    code: "HOLD_UNUSABLE",
    message: `hold ${holdId} cannot be used: ${why}`,
  }),
  ioFailed: ({ what, path, cause }: { what: string; path: string; cause: unknown }): ReviewIoFailedError => ({
    code: "REVIEW_IO_FAILED",
    message: `${what} ${path} failed: ${errorMessage({ error: cause })}`,
  }),
  notFresh: ({ why }: { why: string }): NotFreshError => ({
    code: "NOT_FRESH",
    message: `the reviewer is not fresh: ${why}`,
  }),
  reviewUnusable: ({ reviewId, why }: { reviewId: string; why: string }): ReviewUnusableError => ({
    code: "REVIEW_UNUSABLE",
    message: `review ${reviewId} cannot be recorded: ${why}`,
    reviewId,
  }),
  usage: ({ problems }: { problems: readonly string[] }): ReviewUsageError => ({
    code: "USAGE",
    message: problems.join("; "),
    problems,
  }),
  wrongPacket: ({ reviewId, why }: { reviewId: string; why: string }): WrongPacketError => ({
    code: "WRONG_PACKET",
    message: `review ${reviewId} did not judge this hold: ${why}`,
    reviewId,
  }),
} as const;
