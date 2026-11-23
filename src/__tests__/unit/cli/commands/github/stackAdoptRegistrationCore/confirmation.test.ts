/**
 * `github stack adopt --register-only`'s pure decisions — the mode that registers a native stack membership
 * without replaying a commit, and so ends the deadlock where a drifted chained pull request could be neither
 * pushed nor adopted.
 */
import { describe, expect, it } from "vitest";

import { githubVerbErrorLines } from "../../../../../../cli/commands/github/errors.js";
import { githubStackAdoptRegistrationConfirmation } from "../../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { facts, PARENT_SHA, parentPr, planFor, pr, stackOf } from "./harness.js";

describe("githubStackAdoptRegistrationConfirmation", () => {
  const plan = planFor({ current: facts() });
  const joined = { id: 5, number: 5, position: 1, size: 2 } as const;

  it("confirms a read-back where both PRs and the stack agree, reporting the whole entry list", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10, 100, 200], number: 5 }),
    });
    expect(unwrap(confirmed)).toEqual({
      childNumber: 100,
      entryNumbers: [10, 100, 200],
      parentNumber: 10,
      stackNumber: 5,
    });
  });

  it("refuses to call a create confirmed when an unstacked pull request turns out to sit below the pair", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: parentPr({ head: { label: "o:lower", ref: "lower", repoFullName: "o/r", sha: PARENT_SHA }, number: 1 }),
      child: pr({ stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10, 100], number: 5 }),
    });
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain(
      "open PR #1 (lower) is based below parent PR #10 and is not in this stack, so registering the pair " +
        "above it left that lower relation needing a dissolve",
    );
  });

  it("confirms a create when the pull request below the pair is already in the same stack", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: parentPr({
        head: { label: "o:lower", ref: "lower", repoFullName: "o/r", sha: PARENT_SHA },
        number: 1,
        stack: joined,
      }),
      child: pr({ stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [1, 10, 100], number: 5 }),
    });
    expect(unwrap(confirmed).stackNumber).toBe(5);
  });

  it("confirms a create whose parent's base branch has no open pull request under it at all", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10, 100], number: 5 }),
    });
    expect(unwrap(confirmed).entryNumbers).toEqual([10, 100]);
  });

  it("refuses a pair that moved together into some OTHER stack", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: { id: 6, number: 6, position: 2, size: 2 } }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: { id: 6, number: 6, position: 1, size: 2 } }),
      plan,
      stack: stackOf({ entries: [10, 100], number: 6 }),
    });
    expect(confirmed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain(
      "child membership differs from the expected stack",
    );
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain(
      "fetched stack number differs from the expected stack",
    );
  });

  it("refuses a child left unstacked by a create the provider called a success", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: undefined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10], number: 5 }),
    });
    expect(confirmed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain("fetched stack is missing PR #100");
  });

  it("refuses a parent that closed between the write and the read-back", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined, state: "closed" }),
      plan,
      stack: stackOf({ entries: [10, 100], number: 5 }),
    });
    expect(confirmed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain("parent identity or shape changed");
  });

  it("refuses a chain the child was retargeted out of", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ baseRef: "somewhere-else", stack: joined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10, 100], number: 5 }),
    });
    expect(confirmed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain(
      "child and parent no longer form the intended chain",
    );
  });

  it("names the observed state so a reader can act without a second read", () => {
    const confirmed = githubStackAdoptRegistrationConfirmation({
      below: undefined,
      child: pr({ stack: undefined }),
      expectedStackNumber: 5,
      parent: parentPr({ stack: joined }),
      plan,
      stack: stackOf({ entries: [10], number: 5 }),
    });
    expect(githubVerbErrorLines({ error: unwrapErr(confirmed) })[0]).toContain(
      "Observed: expected stack #5; child #100 stack none; parent #10 stack 5; fetched stack #5 entries [#10]; " +
        "child base parent-branch; parent head parent-branch. No local enrolment was written.",
    );
  });
});
