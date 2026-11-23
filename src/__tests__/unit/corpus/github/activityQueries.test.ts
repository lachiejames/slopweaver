/*
 * The two GitHub activity documents read directly: each targets its own item root, both declare the same three
 * required variables, and each asks for exactly the connections the last backfill already paid for.
 */
import { describe, expect, it } from "vitest";

import { ISSUE_ACTIVITY_QUERY, PR_ACTIVITY_QUERY } from "../../../../corpus/github/activityQueries.js";

const VARIABLES = "query($owner:String!,$repo:String!,$number:Int!){";

describe("the activity documents", () => {
  it("targets the pull request root in the PR document and the issue root in the issue one", () => {
    expect(PR_ACTIVITY_QUERY).toContain("pullRequest(number:$number)");
    expect(PR_ACTIVITY_QUERY).not.toContain("issue(number:$number)");
    expect(ISSUE_ACTIVITY_QUERY).toContain("issue(number:$number)");
    expect(ISSUE_ACTIVITY_QUERY).not.toContain("pullRequest(number:$number)");
  });

  it("declares the same three required variables on both documents", () => {
    expect(PR_ACTIVITY_QUERY.startsWith(VARIABLES)).toBe(true);
    expect(ISSUE_ACTIVITY_QUERY.startsWith(VARIABLES)).toBe(true);
  });

  it("asks for one rollup commit and five full pages on a PR, two full pages on an issue", () => {
    expect(PR_ACTIVITY_QUERY.match(/first:\d+|last:\d+/g)).toEqual([
      "last:1",
      "first:100",
      "first:100",
      "first:100",
      "first:100",
      "first:100",
    ]);
    expect(ISSUE_ACTIVITY_QUERY.match(/first:\d+|last:\d+/g)).toEqual(["first:100", "first:100"]);
  });
});
