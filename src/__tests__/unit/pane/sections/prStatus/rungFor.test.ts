/*
 * The merge ladder — the claim the PULL REQUESTS section is built on.
 *
 * A rung chosen wrongly is a row in the wrong place carrying a confident sentence explaining the wrong
 * position, so every rung has a test. The other property pinned here: the weakest check decides the
 * rung (never an average).
 */
import { describe, expect, it } from "vitest";
import { rungFor } from "../../../../../pane/sections/prStatus.js";
import { pr } from "./harness.js";

describe("rungFor — every rung of the merge ladder", () => {
  it("puts an approved, green, non-draft pull request on `merge`", () => {
    expect(rungFor({ pr: pr() }).rung).toBe("merge");
  });

  it("puts an approved, green DRAFT on `undraft`", () => {
    expect(rungFor({ pr: pr({ isDraft: true }) }).rung).toBe("undraft");
  });

  it("puts a green pull request awaiting review on `review`", () => {
    expect(rungFor({ pr: pr({ reviewDecision: "REVIEW_REQUIRED" }) }).rung).toBe("review");
  });

  it("puts requested changes on `changes`", () => {
    expect(rungFor({ pr: pr({ reviewDecision: "CHANGES_REQUESTED" }) }).rung).toBe("changes");
  });

  it("puts a conflicting branch on `conflict`, ahead of the review decision", () => {
    expect(rungFor({ pr: pr({ mergeable: "CONFLICTING", reviewDecision: "APPROVED" }) }).rung).toBe("conflict");
  });

  it("puts a failing check on `failing` and names the failing check", () => {
    const rung = rungFor({
      pr: pr({
        statusCheckRollup: [{ __typename: "CheckRun", conclusion: "FAILURE", name: "lint", status: "COMPLETED" }],
      }),
    });

    expect(rung.rung).toBe("failing");
    expect(rung.why).toContain("lint");
  });

  it("puts a running check on `pending`", () => {
    const rung = rungFor({
      pr: pr({ statusCheckRollup: [{ __typename: "CheckRun", name: "build", status: "IN_PROGRESS" }] }),
    });

    expect(rung.rung).toBe("pending");
  });

  it("puts an unreadable rollup on `unknown` rather than assuming it is fine", () => {
    expect(rungFor({ pr: pr({ statusCheckRollup: "not an array" }) }).rung).toBe("unknown");
  });

  it("says so when a pull request has no checks configured, rather than calling them green", () => {
    const rung = rungFor({ pr: pr({ reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [] }) });

    expect(rung.why).toContain("no checks configured");
  });

  it("grades a rollup by its WEAKEST member, never by the majority", () => {
    const rung = rungFor({
      pr: pr({
        statusCheckRollup: [
          { __typename: "CheckRun", conclusion: "SUCCESS", name: "a", status: "COMPLETED" },
          { __typename: "CheckRun", conclusion: "SUCCESS", name: "b", status: "COMPLETED" },
          { __typename: "CheckRun", conclusion: "FAILURE", name: "c", status: "COMPLETED" },
        ],
      }),
    });

    expect(rung.rung).toBe("failing");
  });
});
