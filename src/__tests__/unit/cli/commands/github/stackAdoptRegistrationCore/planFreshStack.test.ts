/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import { githubStackAdoptRegistrationPlan } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrapErr } from "../../../../../../lib/result.js";
import { facts, parentPr, planFor, pr, SELF } from "./harness.js";

describe("githubStackAdoptRegistrationPlan — a fresh stack must not orphan the pair below it", () => {
  // Reproduced against this module's own core: in the three-deep unregistered chain of pull requests 1, 10 and
  // 100 (each based on the one before), registering the UPPER pair put 10 into a new stack while 1 stayed
  // in none, moving the 10-onto-1 pair from `neither-stacked` (one --register-only repairs it) to `parent-unstacked`
  // (only a dissolve does). A successful run made the tree HARDER to fix than it found it.
  const grandparent = parentPr({
    head: { label: "o:grandparent-branch", ref: "grandparent-branch", repoFullName: "o/r", sha: "c".repeat(40) },
    htmlUrl: "https://example.invalid/pr/1",
    nodeId: "PR_1",
    number: 1,
  });

  it("refuses a create whose parent is itself an unstacked chain child, and names the bottom-up repair", () => {
    const current = facts({ grandparent, parent: parentPr({ baseRef: "grandparent-branch" }) });
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: current,
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    expect(decided.isErr()).toBe(true);
    expect(unwrapErr(decided)).toEqual([
      "registering PR #100 onto PR #10 would form a FRESH stack, but #10 is itself based on open PR #1 " +
        "(grandparent-branch) and carries no stack — so this pair would leave that lower one needing a " +
        "dissolve rather than a registration. Register a chain from the bottom up: " +
        "`slopweaver github stack adopt --pr 10 --register-only` first, then re-run this",
    ]);
  });

  it("never prescribes a repair it would itself refuse, when the parent's head IS the default branch", () => {
    // In a chain deep enough that the bottom-up walk reaches a pull
    // request whose HEAD is `main`, "adopt the parent first" terminates in "there is nothing to adopt" and
    // the whole chain stays refused forever. The refusal now says that instead of pointing at a dead end.
    const onMain = parentPr({
      baseRef: "release",
      head: { label: "o:main", ref: "main", repoFullName: "o/r", sha: "d".repeat(40) },
      number: 1,
    });
    const current = facts({ child: pr({ baseRef: "main" }), grandparent: parentPr({ number: 2 }), parent: onMain });
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: current,
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    expect(decided.isErr()).toBe(true);
    expect(unwrapErr(decided)).toEqual([
      "registering PR #100 onto PR #1 would form a FRESH stack, but #1 is itself based on open PR #2 " +
        "(parent-branch) and carries no stack — so this pair would leave that lower one needing a dissolve " +
        "rather than a registration. Registering #1 first is not available either: its head branch IS the " +
        "repository default (main), which stack automation never enrols. Re-base this chain off main " +
        "directly before registering it",
    ]);
  });

  it("allows the create once the pair below it has been registered — the bottom-up order works", () => {
    const current = facts({
      grandparent: undefined,
      parent: parentPr({ baseRef: "grandparent-branch", stack: { id: 5, number: 5, position: 2, size: 2 } }),
    });
    expect(planFor({ current }).operation).toEqual({ kind: "add", pullRequests: [100], stackNumber: 5 });
  });

  it("allows the create when nothing sits below the parent at all", () => {
    expect(planFor({ current: facts() }).operation).toEqual({ kind: "create", pullRequests: [10, 100] });
  });
});
