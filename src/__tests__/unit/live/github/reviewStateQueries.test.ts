/**
 * The one property this module exists to keep: both reads send the SAME pull-request selection.
 *
 * The fleet query and the single-pull-request query drifted the moment they were two selections, and
 * `--number`'s whole point is that a reader sees exactly what the table's row was computed from. A test over
 * the strings is the only thing that can say so without a credential.
 */
import { describe, expect, it } from "vitest";

import { REVIEW_REQUESTS_SELECTION } from "../../../../live/github/reviewRequests.js";
import {
  CODEOWNERS_ALIASES,
  CODEOWNERS_QUERY,
  FLEET_QUERY,
  PR_BY_NUMBER_QUERY,
} from "../../../../live/github/reviewStateQueries.js";

/**
 * Fields whose absence from either query would silently change what a row is computed from.
 *
 * `reviewDecision` earns its place by MEASUREMENT rather than by symmetry. Deleting it from
 * `PR_NODE_SELECTION` alone left all 252 tests across the seven files this branch touches green, while an
 * otherwise pressable CLEAN pull request carrying an open code-owner request and CHANGES_REQUESTED reached
 * `act:merge-now` — because `parsePrNode` renders the missing field as `""`, which the stated-decision guard
 * reads as the absence it cannot distinguish from one.
 */
const SHARED_FIELDS = [
  "reviewDecision",
  "reviewThreads(first: $threadLimit)",
  "id isResolved isOutdated path line",
  "contexts(first: $checkLimit)",
  // The run GitHub itself ties a Check Run to: `github landing --pr` reads a job log only on its word.
  "workflowRun { databaseId }",
  "mergeQueueEntry",
  "mergeStateStatus",
  "onBehalfOf(first: $onBehalfOfLimit)",
] as const;

describe("the shared pull-request selection", () => {
  it("has at least one field to check, so the loop below is not vacuously green", () => {
    expect(SHARED_FIELDS.length).toBeGreaterThan(0);
  });

  it("puts every shared field in BOTH the fleet query and the by-number query", () => {
    for (const field of SHARED_FIELDS) {
      expect(FLEET_QUERY).toContain(field);
      expect(PR_BY_NUMBER_QUERY).toContain(field);
    }
  });

  it("declares the same variables on both queries", () => {
    expect(FLEET_QUERY).toContain("$checkLimit: Int!, $fileLimit: Int!, $reviewLimit: Int!, $threadLimit: Int!");
    expect(PR_BY_NUMBER_QUERY).toContain("$checkLimit: Int!, $fileLimit: Int!, $reviewLimit: Int!, $threadLimit: Int!");
  });

  it("asks the fleet query by SEARCH and the other by repository and number", () => {
    expect(FLEET_QUERY).toContain("search(query: $q, type: ISSUE, first: $pageSize, after: $after)");
    expect(PR_BY_NUMBER_QUERY).toContain("pullRequest(number: $number)");
  });
});

describe("CODEOWNERS_ALIASES", () => {
  it("is GitHub's documented precedence, in order", () => {
    expect(CODEOWNERS_ALIASES).toEqual([
      ["dotGithub", ".github/CODEOWNERS"],
      ["root", "CODEOWNERS"],
      ["docs", "docs/CODEOWNERS"],
    ]);
  });

  it("asks the codeowners query for every alias it then reads", () => {
    for (const [alias] of CODEOWNERS_ALIASES) {
      expect(CODEOWNERS_QUERY).toContain(`${alias}: object(expression:`);
    }
  });
});

describe("the review-request page boundary", () => {
  it("asks every query that carries requests for the pageInfo the truncation guard reads", () => {
    // `hasNextPage` answers FALSE on an absent `pageInfo`, so a selection that stopped asking for it would
    // report every capped request page as complete — and a complete read is exactly the input the
    // code-owner exception releases on. Found by review; this is the witness,
    // because the guard itself cannot tell "GitHub said no more" from "nobody asked".
    // Assert the WHOLE selection, never the substring: labels, files, reviews and check contexts each carry
    // their own `pageInfo { hasNextPage }`, so a query that dropped it from THIS connection alone still
    // satisfied a substring search. A mutation run over the review pass removed it from each
    // query in turn and all 248 tests stayed green.
    expect(REVIEW_REQUESTS_SELECTION).toContain("pageInfo { hasNextPage }");
    expect(FLEET_QUERY).toContain(REVIEW_REQUESTS_SELECTION);
    expect(PR_BY_NUMBER_QUERY).toContain(REVIEW_REQUESTS_SELECTION);
  });
});
