/*
 * `github stack adopt --register-only`'s per-pair refusal checks, read directly: the pull-request shape both adopt
 * modes share, the child's own refusal, the parent chain's, and the parent's authorisation on a `create`.
 */
import { describe, expect, it } from "vitest";

import type { RegistrationFacts } from "../../../../../cli/commands/github/stackAdoptRegistrationCore.js";
import {
  adoptableShapeRefusal,
  childRefusal,
  parentAuthorisationOutcome,
  parentChainRefusal,
} from "../../../../../cli/commands/github/stackAdoptRegistrationRefusals.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";

function pr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "parent-branch",
    baseRepoFullName: "acme/widgets",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "acme:child-branch", ref: "child-branch", repoFullName: "acme/widgets", sha: "a".repeat(40) },
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

const PARENT = pr({
  baseRef: "main",
  head: { label: "acme:parent-branch", ref: "parent-branch", repoFullName: "acme/widgets", sha: "b".repeat(40) },
  nodeId: "PR_10",
  number: 10,
});

function facts(overrides: Partial<RegistrationFacts> = {}): RegistrationFacts {
  return {
    child: pr(),
    defaultBranch: "main",
    grandparent: undefined,
    owner: "acme",
    parent: PARENT,
    repo: "widgets",
    ...overrides,
  };
}

describe("adoptableShapeRefusal", () => {
  it("passes an open pull request whose base and head are this repository, matched case-insensitively", () => {
    expect(adoptableShapeRefusal({ owner: "ACME", pr: pr(), repo: "Widgets" })).toBe(undefined);
  });

  it("refuses a closed pull request before any repository check", () => {
    const closed = pr({ baseRepoFullName: "other/repo", state: "closed" });
    expect(adoptableShapeRefusal({ owner: "acme", pr: closed, repo: "widgets" })).toBe(
      "PR #100 is closed, not open — adopt only handles an open pull request",
    );
  });

  it("refuses a pull request whose fork was deleted", () => {
    const gone = pr({ head: { label: "x", ref: "child-branch", repoFullName: undefined, sha: "a".repeat(40) } });
    expect(adoptableShapeRefusal({ owner: "acme", pr: gone, repo: "widgets" })).toBe(
      "PR #100's head repository is gone (the fork was deleted) — there is nothing to adopt from",
    );
  });
});

describe("childRefusal", () => {
  it("refuses a child whose head branch is the repository default", () => {
    const onMain = pr({ head: { label: "acme:main", ref: "main", repoFullName: "acme/widgets", sha: "a".repeat(40) } });
    expect(childRefusal({ facts: facts({ child: onMain }) })).toBe(
      "PR #100's head branch is the repository default (main) — there is nothing to adopt",
    );
  });
});

describe("parentChainRefusal", () => {
  it("passes a distinct open parent whose head is the child's base", () => {
    expect(parentChainRefusal({ facts: facts(), parent: PARENT, viewerId: 1 })).toBe(undefined);
  });

  it("refuses a parent that is the child itself", () => {
    expect(parentChainRefusal({ facts: facts(), parent: pr(), viewerId: 1 })).toEqual([
      "PR #100 cannot be its own stack parent",
    ]);
  });
});

describe("parentAuthorisationOutcome", () => {
  const create = { kind: "create", pullRequests: [10, 100] } as const;

  it("asks nothing of the parent on an add, whatever its authorisation", () => {
    const add = { kind: "add", pullRequests: [100], stackNumber: 5 } as const;
    expect(parentAuthorisationOutcome({ operation: add, parent: PARENT, parentAuthorisation: undefined })).toEqual({});
  });

  it("refuses a create whose parent authorisation was never checked", () => {
    expect(parentAuthorisationOutcome({ operation: create, parent: PARENT, parentAuthorisation: undefined })).toEqual({
      refusal:
        "forming a fresh stack registers parent PR #10 as well as PR #100, and whether you may act on it was " +
        "never checked. Refusing rather than guessing",
    });
  });

  it("carries an overridden parent's notice, prefixed with the parent's number", () => {
    const overridden = { kind: "overridden", notice: "acting on another author's pull request" } as const;
    expect(parentAuthorisationOutcome({ operation: create, parent: PARENT, parentAuthorisation: overridden })).toEqual({
      notice: "parent PR #10: acting on another author's pull request",
    });
  });
});
