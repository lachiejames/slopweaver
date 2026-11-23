/*
 * The write refusals a description review produces, read as a reader meets them: what is missing or broken, what
 * changed since the last review, what to run, and that there is no hatch.
 */
import { describe, expect, it } from "vitest";

import { DescriptionReviewErrors } from "../../../../outbound/github/descriptionReviewErrors.js";

const DIGEST = "0123456789ab".padEnd(64, "f");
const NO_HATCH =
  "There is no escape hatch: a description reaches GitHub only over a CLEAN review of these exact bytes.";

describe("DescriptionReviewErrors", () => {
  it("names a missing review with no earlier one to compare against", () => {
    const error = DescriptionReviewErrors.missing({ differences: [], manifestSha256: DIGEST });
    expect(error.code).toBe("REVIEW_MISSING");
    expect(error.message).toBe(
      "no description review covers packet 0123456789ab… (the exact title, body, images, written rules and change " +
        "set this write sends). Run `slopweaver github pr review-prepare` over the exact title and body this verb " +
        "sends, have a fresh reviewer take the pass, then `slopweaver github pr review-record`. " +
        NO_HATCH,
    );
  });

  it("names what changed since the nearest earlier review", () => {
    const error = DescriptionReviewErrors.missing({
      differences: ["the body changed", "the images changed"],
      manifestSha256: DIGEST,
    });
    expect(error.differences).toStrictEqual(["the body changed", "the images changed"]);
    expect(error.message).toContain(
      "; against the last review of this repository's description, the body changed, the images changed. Run",
    );
  });

  it("carries a BROKEN review's summary and ends on the absent hatch", () => {
    const error = DescriptionReviewErrors.broken({ receiptId: "r-1", summary: "The body credits the owner." });
    expect(error.code).toBe("REVIEW_BROKEN");
    expect(error.message).toBe(
      "the description review of these exact bytes came back BROKEN (receipt r-1): The body credits the owner. " +
        `Fix the description, then prepare and review it again. ${NO_HATCH}`,
    );
  });

  it("tells a second pass over a CLEAN packet that nothing more is owed, and over a BROKEN one to change it", () => {
    const clean = DescriptionReviewErrors.alreadyReviewed({
      manifestSha256: DIGEST,
      receiptId: "r-1",
      verdict: "CLEAN",
    });
    const broken = DescriptionReviewErrors.alreadyReviewed({
      manifestSha256: DIGEST,
      receiptId: "r-2",
      verdict: "BROKEN",
    });
    expect(clean.message).toBe(
      "packet 0123456789ab… already has its review (receipt r-1, CLEAN). The write verb sends these exact bytes as " +
        "they stand; nothing more is owed.",
    );
    expect(broken.message).toContain("This lane takes one pass per distinct description");
  });
});
