/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import { githubStackAdoptRegistrationPlan } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { facts, parentPr, planFor, pr, SELF } from "./harness.js";

describe("githubStackAdoptRegistrationPlan — the membership table", () => {
  it("adds the child to the parent's stack when only the parent is registered", () => {
    const current = facts({ parent: parentPr({ stack: { id: 5, number: 5, position: 1, size: 1 } }) });
    expect(planFor({ current }).operation).toEqual({ kind: "add", pullRequests: [100], stackNumber: 5 });
  });

  it("reports already-joined when both carry the same stack number, and plans no native write", () => {
    const current = facts({
      child: pr({ stack: { id: 5, number: 5, position: 2, size: 2 } }),
      parent: parentPr({ stack: { id: 5, number: 5, position: 1, size: 2 } }),
    });
    expect(planFor({ current }).operation).toEqual({ kind: "already-joined", stackNumber: 5 });
  });

  it("refuses parent-unstacked with the audit's own repair lines", () => {
    const current = facts({ child: pr({ stack: { id: 5, number: 5, position: 1, size: 1 } }) });
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: current,
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    expect(decided.isErr()).toBe(true);
    expect(unwrapErr(decided)).toEqual([
      "cannot register PR #100 against parent PR #10: parent-unstacked",
      "  #100 (child-branch) is based on #10 (parent-branch) — parent-unstacked: child stack #5, parent stack none",
      "    https://example.invalid/pr/100",
      "    yours: #10 must join stack #5 BELOW #100, which GitHub's add endpoint cannot do — dissolve stack #5 " +
        "and re-form it from the bottom with `slopweaver github stack adopt --pr 10` (add --register-only if " +
        "its branch has drifted past a one-commit replay) first. Register a chain from its LOWEST pair " +
        "upward: if that parent is itself based on another open pull request, adopt that pair first",
    ]);
  });

  it("refuses different-stacks with the audit's own repair lines", () => {
    const current = facts({
      child: pr({ stack: { id: 6, number: 6, position: 1, size: 1 } }),
      parent: parentPr({ stack: { id: 5, number: 5, position: 1, size: 1 } }),
    });
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: current,
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    expect(decided.isErr()).toBe(true);
    expect(unwrapErr(decided)).toEqual([
      "cannot register PR #100 against parent PR #10: different-stacks",
      "  #100 (child-branch) is based on #10 (parent-branch) — different-stacks: child stack #6, parent stack #5",
      "    https://example.invalid/pr/100",
      "    yours: dissolve one of the two first — `slopweaver github stack dissolve --repo <owner/name> " +
        "--stack 6` — then adopt #100 onto #10" +
        " (add --register-only if its branch has drifted past a one-commit replay)",
    ]);
  });
});
