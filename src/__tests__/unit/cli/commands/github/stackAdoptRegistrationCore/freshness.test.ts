/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import {
  githubStackAdoptRegistrationFreshness,
  type RegistrationFacts,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { facts, parentPr, pr } from "./harness.js";

describe("githubStackAdoptRegistrationFreshness", () => {
  it("accepts a content-only push: the head SHA and the commit count are not depended on", () => {
    const current = facts({
      child: pr({ commits: 99, head: { label: "o:c", ref: "child-branch", repoFullName: "o/r", sha: "c".repeat(40) } }),
    });
    expect(githubStackAdoptRegistrationFreshness({ current, previewed: facts() })).toEqual({ fresh: true });
  });

  const moved: readonly (readonly [string, RegistrationFacts, string])[] = [
    ["the repository", facts({ repo: "other" }), "the repository changed from o/r to o/other"],
    [
      "the default branch",
      facts({ defaultBranch: "trunk" }),
      "the repository default branch changed from main to trunk",
    ],
    ["the author", facts({ child: pr({ authorId: 9 }) }), "the author changed from 1 to 9"],
    ["the state", facts({ child: pr({ state: "closed" }) }), "the open/closed state changed from open to closed"],
    [
      "the base branch",
      facts({ child: pr({ baseRef: "elsewhere" }) }),
      "the base branch changed from parent-branch to elsewhere",
    ],
    [
      "the child's membership",
      facts({ child: pr({ stack: { id: 5, number: 5, position: 1, size: 1 } }) }),
      "the native stack membership changed from none to 5",
    ],
    ["the parent", facts({ parent: undefined }), "the parent pull request changed from 10 to none"],
    [
      "the pull request below the parent",
      facts({ grandparent: parentPr({ number: 1 }) }),
      "the pull request below the parent changed from none to 1",
    ],
    [
      "the parent's membership",
      facts({ parent: parentPr({ stack: { id: 6, number: 6, position: 1, size: 1 } }) }),
      "the parent's native stack membership changed from none to 6",
    ],
  ];

  it.each(moved)("refuses when %s moved", (_name, current, expected) => {
    const freshness = githubStackAdoptRegistrationFreshness({ current, previewed: facts() });
    expect(freshness.fresh).toBe(false);
    expect(freshness.fresh === false ? freshness.reason : "").toContain(expected);
  });
});
