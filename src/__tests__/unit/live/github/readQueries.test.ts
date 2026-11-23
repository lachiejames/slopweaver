import { describe, expect, it } from "vitest";

import { DISCUSSION_QUERY, ISSUE_OR_PULL_REQUEST_QUERY } from "../../../../live/github/readQueries.js";

describe("the single-object read's queries", () => {
  it("name their operations, so a provider log tells the two reads apart", () => {
    expect([
      ISSUE_OR_PULL_REQUEST_QUERY.startsWith("query SlopweaverReadIssueOrPullRequest("),
      DISCUSSION_QUERY.startsWith("query SlopweaverReadDiscussion("),
    ]).toEqual([true, true]);
  });

  it("reads a pull request's reviews newest-first, so its approvals survive the page cap", () => {
    expect([
      ISSUE_OR_PULL_REQUEST_QUERY.includes("reviews(last: $limit)"),
      ISSUE_OR_PULL_REQUEST_QUERY.includes("reviews(first"),
    ]).toEqual([true, false]);
  });
});
