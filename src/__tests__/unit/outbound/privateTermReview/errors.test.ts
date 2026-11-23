import { describe, expect, it } from "vitest";

import { PrivateTermReviewErrors } from "../../../../outbound/privateTermReview/errors.js";

describe("PrivateTermReviewErrors", () => {
  it("names the review and the receipt it already became", () => {
    expect(PrivateTermReviewErrors.alreadyRecorded({ receiptId: "r-1", reviewId: "v-1" })).toEqual({
      code: "ALREADY_RECORDED",
      message: "review v-1 is already receipt r-1; one review is one receipt",
    });
  });

  it("names the hold and why it cannot be used", () => {
    expect(PrivateTermReviewErrors.holdUnusable({ holdId: "ph-0123456789ab", why: "no such hold" })).toEqual({
      code: "HOLD_UNUSABLE",
      message: "hold ph-0123456789ab cannot be used: no such hold",
    });
  });

  it("carries the cause's own message into an io failure", () => {
    const error = PrivateTermReviewErrors.ioFailed({
      cause: new Error("EACCES: permission denied"),
      path: "/home/acme/holds",
      what: "reading the hold at",
    });
    expect(error).toEqual({
      code: "REVIEW_IO_FAILED",
      message: "reading the hold at /home/acme/holds failed: EACCES: permission denied",
    });
  });

  it("says why the reviewer is not fresh", () => {
    expect(PrivateTermReviewErrors.notFresh({ why: "it held the write" })).toEqual({
      code: "NOT_FRESH",
      message: "the reviewer is not fresh: it held the write",
    });
  });

  it("keeps the review id on an unusable review", () => {
    expect(PrivateTermReviewErrors.reviewUnusable({ reviewId: "v-2", why: "no verdict" })).toEqual({
      code: "REVIEW_UNUSABLE",
      message: "review v-2 cannot be recorded: no verdict",
      reviewId: "v-2",
    });
  });

  it("joins every usage problem and keeps the list", () => {
    expect(PrivateTermReviewErrors.usage({ problems: ["--hold is required", "one hold at a time"] })).toEqual({
      code: "USAGE",
      message: "--hold is required; one hold at a time",
      problems: ["--hold is required", "one hold at a time"],
    });
  });

  it("keeps the review id on a review of another packet", () => {
    expect(PrivateTermReviewErrors.wrongPacket({ reviewId: "v-3", why: "another repository" })).toEqual({
      code: "WRONG_PACKET",
      message: "review v-3 did not judge this hold: another repository",
      reviewId: "v-3",
    });
  });
});
