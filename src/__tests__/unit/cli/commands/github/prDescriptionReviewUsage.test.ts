import { describe, expect, it } from "vitest";

import {
  GITHUB_PR_REVIEW_PREPARE_USAGE,
  GITHUB_PR_REVIEW_RECORD_USAGE,
} from "../../../../../cli/commands/github/prDescriptionReviewUsage.js";

describe("the description-review usage lines", () => {
  it("opens each on its own verb's usage line", () => {
    expect(GITHUB_PR_REVIEW_PREPARE_USAGE.split("\n")[0]).toContain("usage: slopweaver github pr review-prepare ");
    expect(GITHUB_PR_REVIEW_RECORD_USAGE.split("\n")[0]).toContain("usage: slopweaver github pr review-record ");
  });

  it("documents the flags each verb requires", () => {
    expect(GITHUB_PR_REVIEW_PREPARE_USAGE).toContain("--body-file <path>");
    expect(GITHUB_PR_REVIEW_RECORD_USAGE).toContain("--review <id>");
  });

  it("carries no wall of text: each line stays under 130 characters", () => {
    const longest = [GITHUB_PR_REVIEW_PREPARE_USAGE, GITHUB_PR_REVIEW_RECORD_USAGE]
      .flatMap((usage) => usage.split("\n"))
      .reduce((max, line) => Math.max(max, line.length), 0);
    expect(longest).toBeLessThan(130);
  });
});
