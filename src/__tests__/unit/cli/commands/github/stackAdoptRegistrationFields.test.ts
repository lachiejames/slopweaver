/**
 * How `github stack adopt --register-only` spells each compared pull-request fact — every legitimate absence
 * (no stack, a deleted fork, a deleted author, no open parent) reads "none" rather than a blank.
 */
import { describe, expect, it } from "vitest";

import {
  belowKey,
  comparableFields,
  headRepositoryField,
  stackMembershipField,
} from "../../../../../cli/commands/github/stackAdoptRegistrationFields.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";

function pr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 7,
    baseRef: "parent-branch",
    baseRepoFullName: "O/R",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:child-branch", ref: "child-branch", repoFullName: "O/Fork", sha: "a".repeat(40) },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

const STACK_5 = { id: 5, number: 5, position: 1, size: 2 };

describe("stackMembershipField", () => {
  it("names a pull request in no native stack as none", () => {
    expect(stackMembershipField({ pr: pr() })).toBe("none");
  });

  it("spells a stacked pull request's stack number", () => {
    expect(stackMembershipField({ pr: pr({ stack: STACK_5 }) })).toBe("5");
  });
});

describe("headRepositoryField", () => {
  it("names a head repository GitHub no longer reports as none", () => {
    expect(headRepositoryField({ pr: pr({ head: { label: "x", ref: "r", repoFullName: undefined, sha: "s" } }) })).toBe(
      "none",
    );
  });

  it("keeps the head repository exactly as GitHub spells it", () => {
    expect(headRepositoryField({ pr: pr() })).toBe("O/Fork");
  });
});

describe("belowKey", () => {
  it("is none when no pull request sits below the parent", () => {
    expect(belowKey({ pr: undefined })).toBe("none");
  });

  it("marks an unstacked pull request below the parent", () => {
    expect(belowKey({ pr: pr({ number: 9 }) })).toBe("9@unstacked");
  });

  it("carries both number and stack for a stacked one", () => {
    expect(belowKey({ pr: pr({ number: 9, stack: STACK_5 }) })).toBe("9@5");
  });
});

describe("comparableFields", () => {
  it("spells every parent field none when the chain has no open parent, and the child's absences as none", () => {
    const child = pr({
      authorId: undefined,
      head: { label: "x", ref: "child-branch", repoFullName: undefined, sha: "s" },
    });
    expect(
      comparableFields({
        facts: { child, defaultBranch: "main", grandparent: undefined, owner: "O", parent: undefined, repo: "R" },
      }),
    ).toEqual([
      ["the repository", "o/r"],
      ["the repository default branch", "main"],
      ["the pull-request number", "100"],
      ["the author", "none"],
      ["the open/closed state", "open"],
      ["the base repository", "o/r"],
      ["the base branch", "parent-branch"],
      ["the head repository", "none"],
      ["the head branch", "child-branch"],
      ["the native stack membership", "none"],
      ["the parent pull request", "none"],
      ["the parent's open/closed state", "none"],
      ["the parent's head repository", "none"],
      ["the parent's head branch", "none"],
      ["the parent's author", "none"],
      ["the parent's native stack membership", "none"],
      ["the pull request below the parent", "none"],
    ]);
  });

  it("reads each parent field off the parent, lower-casing its head repository", () => {
    const parent = pr({
      head: { label: "o:parent-branch", ref: "parent-branch", repoFullName: "O/R", sha: "b".repeat(40) },
      number: 10,
      stack: STACK_5,
      state: "closed",
    });
    const fields = comparableFields({
      facts: {
        child: pr({ stack: STACK_5 }),
        defaultBranch: "main",
        grandparent: pr({ number: 9 }),
        owner: "o",
        parent,
        repo: "r",
      },
    });
    expect(fields.slice(7)).toEqual([
      ["the head repository", "o/fork"],
      ["the head branch", "child-branch"],
      ["the native stack membership", "5"],
      ["the parent pull request", "10"],
      ["the parent's open/closed state", "closed"],
      ["the parent's head repository", "o/r"],
      ["the parent's head branch", "parent-branch"],
      ["the parent's author", "7"],
      ["the parent's native stack membership", "5"],
      ["the pull request below the parent", "9@unstacked"],
    ]);
  });
});
