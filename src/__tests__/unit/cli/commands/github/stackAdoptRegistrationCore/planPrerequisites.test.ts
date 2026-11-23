/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import {
  githubStackAdoptRegistrationPlan,
  type RegistrationFacts,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { CHILD_SHA, facts, PARENT_SHA, parentPr, planFor, pr, SELF } from "./harness.js";

describe("githubStackAdoptRegistrationPlan — every surviving prerequisite", () => {
  const cases: readonly (readonly [string, RegistrationFacts, string])[] = [
    ["a closed child", facts({ child: pr({ state: "closed" }) }), "PR #100 is closed, not open"],
    [
      "a child based in another repository",
      facts({ child: pr({ baseRepoFullName: "other/repo" }) }),
      "PR #100's base repository (other/repo) is not o/r",
    ],
    [
      "a deleted fork",
      facts({ child: pr({ head: { label: "x", ref: "child-branch", repoFullName: undefined, sha: CHILD_SHA } }) }),
      "PR #100's head repository is gone",
    ],
    [
      "a fork head",
      facts({ child: pr({ head: { label: "f:c", ref: "child-branch", repoFullName: "fork/r", sha: CHILD_SHA } }) }),
      "PR #100's head repository (fork/r) is a fork of o/r",
    ],
    [
      "a head branch that is the repository default",
      facts({ child: pr({ head: { label: "o:main", ref: "main", repoFullName: "o/r", sha: CHILD_SHA } }) }),
      "PR #100's head branch is the repository default (main)",
    ],
    [
      "a parent that is the child itself",
      facts({ parent: parentPr({ number: 100 }) }),
      "PR #100 cannot be its own stack parent",
    ],
    ["a closed parent", facts({ parent: parentPr({ state: "closed" }) }), "parent PR #10 is closed, not open"],
    [
      "a parent whose head lives in a fork",
      facts({ parent: parentPr({ head: { label: "f", ref: "parent-branch", repoFullName: "f/r", sha: PARENT_SHA } }) }),
      "parent PR #10's head repository (f/r) is not o/r",
    ],
    [
      "a parent whose head is not the child's base",
      facts({ parent: parentPr({ head: { label: "o:e", ref: "elsewhere", repoFullName: "o/r", sha: PARENT_SHA } }) }),
      "PR #100's base branch (parent-branch) is not parent PR #10's head branch (elsewhere)",
    ],
  ];

  it.each(cases)("refuses %s", (_name, current, expected) => {
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: current,
      parentAuthorisation: SELF,
      viewerId: 1,
    });
    expect(decided.isErr()).toBe(true);
    expect(unwrapErr(decided)[0]).toContain(expected);
  });

  it("refuses a foreign-authored pull request, and carries an override notice when one is given", () => {
    const refused = githubStackAdoptRegistrationPlan({
      authorisation: { kind: "refused", reason: "not yours" },
      facts: facts(),
      parentAuthorisation: SELF,
      viewerId: 2,
    });
    expect(unwrapErr(refused)).toEqual(["not yours"]);
    const overridden = planFor({ current: facts() });
    expect(overridden.overrideNotices).toEqual([]);
  });

  it("refuses a create whose parent belongs to someone else, naming the parent rather than the child", () => {
    const refused = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: facts({ parent: parentPr({ authorId: 2 }) }),
      parentAuthorisation: { kind: "refused", reason: "that one is not yours" },
      viewerId: 1,
    });
    expect(unwrapErr(refused)).toEqual([
      "forming a fresh stack also registers parent PR #10, and that one is not yours",
    ]);
  });

  it("refuses a create whose parent authorisation was never resolved at all", () => {
    const refused = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: facts({ parent: parentPr({ authorId: 2 }) }),
      parentAuthorisation: undefined,
      viewerId: 1,
    });
    expect(unwrapErr(refused)).toEqual([
      "forming a fresh stack registers parent PR #10 as well as PR #100, and whether you may act on it was " +
        "never checked. Refusing rather than guessing",
    ]);
  });

  it("carries the parent's own override notice, prefixed with which pull request it is about", () => {
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: facts({ parent: parentPr({ authorId: 2 }) }),
      parentAuthorisation: { kind: "overridden", notice: "OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1" },
      viewerId: 1,
    });
    const decision = unwrap(decided);
    expect((decision as Extract<typeof decision, { kind: "register" }>).plan.overrideNotices).toEqual([
      "parent PR #10: OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1",
    ]);
  });

  it("leaves an add alone: the parent is already in the stack the child joins, so only the child is written", () => {
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: SELF,
      facts: facts({ parent: parentPr({ authorId: 2, stack: { id: 5, number: 5, position: 1, size: 1 } }) }),
      parentAuthorisation: { kind: "refused", reason: "that one is not yours" },
      viewerId: 1,
    });
    const decision = unwrap(decided);
    const plan = decision as Extract<typeof decision, { kind: "register" }>;
    expect(plan.plan.operation).toEqual({ kind: "add", pullRequests: [100], stackNumber: 5 });
    expect(plan.plan.overrideNotices).toEqual([]);
  });

  it("carries the authorisation override notice into the plan", () => {
    const decided = githubStackAdoptRegistrationPlan({
      authorisation: { kind: "overridden", notice: "OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1" },
      facts: facts(),
      parentAuthorisation: SELF,
      viewerId: 2,
    });
    const decision = unwrap(decided);
    expect(decision.kind).toBe("register");
    expect((decision as Extract<typeof decision, { kind: "register" }>).plan.overrideNotices).toEqual([
      "OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1",
    ]);
  });
});
