/** `assembleReviewState` on question 8, the conflict: what a CONFLICTING pull request's row and reading carry. */
import { describe, expect, it } from "vitest";
import { assembleReviewState } from "../../../../../cli/commands/github/reviewStateReport.js";
import { recommendationTally, reviewStateRow } from "../../../../../cli/commands/github/reviewStateTable.js";
import { EMPTY_REVIEW_ROSTER } from "../../../../../review/reviewRoster.js";
import { CODEOWNERS, COVERAGE, NO_REQUIRED_CONTEXTS, NOW, pr, SOLE_AUTHOR, SOLO } from "./reviewStateReportFixtures.js";

describe("assembleReviewState — question 8, the conflict", () => {
  it("reads a repository whose CODEOWNERS names only the author as self-merging", () => {
    const state = assembleReviewState({
      codeowners: SOLE_AUTHOR,
      conflictPaths: undefined,
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr(),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("self-merges");
    expect(state.conflict).toStrictEqual({ local: { kind: "not-requested" }, mergeable: "MERGEABLE" });
  });

  it("says CONFLICTING ahead of self-merging, carrying the measured paths and the base branch", () => {
    const state = assembleReviewState({
      codeowners: SOLE_AUTHOR,
      conflictPaths: { kind: "paths", paths: ["package.json"] },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("conflicting");
    expect(state.baseRefName).toBe("staging");
    expect(state.conflict).toStrictEqual({
      local: { kind: "measured", paths: ["package.json"], why: "" },
      mergeable: "CONFLICTING",
    });
    expect(reviewStateRow({ state })).toContain("CONFLICTING");
    expect(recommendationTally({ states: [state] })).toBe("conflicting 1");
  });

  it("says why the paths are missing when the local merge came out clean, rather than reporting none", () => {
    const state = assembleReviewState({
      codeowners: CODEOWNERS,
      conflictPaths: { kind: "clean" },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.recommendation).toBe("conflicting");
    expect(state.conflict).toStrictEqual({
      local: {
        kind: "measured",
        paths: [],
        why: "a local merge of the head into staging came out clean, so GitHub's conflict read may be stale or the base has moved",
      },
      mergeable: "CONFLICTING",
    });
  });

  it("carries an unmeasured read's own reason through", () => {
    const state = assembleReviewState({
      codeowners: CODEOWNERS,
      conflictPaths: {
        kind: "unmeasured",
        why: "no declared checkout holds o/r, so the conflicting paths were not measured",
      },
      coverage: COVERAGE,
      mentions: [],
      nowIso: NOW,
      pr: pr({ mergeable: "CONFLICTING" }),
      requiredContexts: NO_REQUIRED_CONTEXTS,
      roster: EMPTY_REVIEW_ROSTER,
      stack: SOLO,
      threadBodiesRead: true,
    });
    expect(state.conflict).toStrictEqual({
      local: {
        kind: "unmeasured",
        why: "no declared checkout holds o/r, so the conflicting paths were not measured",
      },
      mergeable: "CONFLICTING",
    });
  });
});
