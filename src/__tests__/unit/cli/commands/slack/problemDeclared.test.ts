/**
 * `slack draft record` requires a `problem` declaration of every composed form, and of no other.
 */
import { describe, expect, it } from "vitest";

import { problemUndeclaredRefusals } from "../../../../../cli/commands/slack/problemDeclared.js";
import { PROBLEM_UNDECLARED } from "../../../../../outbound/artifact/problemReach.js";

describe("problemUndeclaredRefusals", () => {
  it("refuses every composed form kind that declares nothing", () => {
    for (const formKind of ["drip", "one-card", "one-list", "update", "no-fold"]) {
      expect(problemUndeclaredRefusals({ artifact: {}, formKind })).toEqual([
        PROBLEM_UNDECLARED,
        "NOTHING was parked and nothing was sent.",
      ]);
    }
  });

  it("parks a composed form that declares either way", () => {
    expect(problemUndeclaredRefusals({ artifact: { problem: { kind: "none" } }, formKind: "update" })).toEqual([]);
    expect(
      problemUndeclaredRefusals({ artifact: { problem: { affects: "one", kind: "possible" } }, formKind: "drip" }),
    ).toEqual([]);
  });

  it("asks nothing of a finding, a derived card or a plain body", () => {
    for (const formKind of ["finding", "digest", "alert-summary", "plain"]) {
      expect(problemUndeclaredRefusals({ artifact: {}, formKind })).toEqual([]);
    }
  });
});
