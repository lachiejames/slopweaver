import { describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  ALLOW_DIRTY_TREE,
  type GithubStackAdoptFacts,
  githubStackAdoptDoorRequest,
  githubStackAdoptFreshness,
  githubStackAdoptPlan,
  githubStackAdoptWarning,
  parseGithubStackAdoptArgs,
  patchEquivalentNotice,
} from "../../../../../cli/commands/github/stackAdoptCore.js";
import type { Authorisation } from "../../../../../cli/commands/github/updateCore.js";
import type { WrittenPr } from "../../../../../corpus/github/write.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

const HEAD_SHA = "3333333333333333333333333333333333333333";

const SELF: Authorisation = { kind: "self" };

function basePr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:top", ref: "top", repoFullName: "o/r", sha: HEAD_SHA },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

function baseFacts(overrides: Partial<GithubStackAdoptFacts> = {}): GithubStackAdoptFacts {
  return {
    checkedOutBranch: "top",
    defaultBranch: "main",
    dirty: false,
    effectiveCommits: undefined,
    localHeadSha: HEAD_SHA,
    owner: "o",
    pr: basePr(),
    repo: "r",
    repoRoot: "/repo",
    ...overrides,
  };
}

describe("parseGithubStackAdoptArgs", () => {
  it("requires --pr", () => {
    expect(parseGithubStackAdoptArgs({ argv: [] })).toEqual(err(GithubVerbErrors.prRequired()));
  });

  it("refuses a non-integer --pr", () => {
    expect(parseGithubStackAdoptArgs({ argv: ["--pr", "abc"] })).toEqual(
      err(GithubVerbErrors.notPositiveWholeNumber({ flag: "--pr", got: "abc" })),
    );
  });

  it("refuses a zero --pr", () => {
    expect(parseGithubStackAdoptArgs({ argv: ["--pr", "0"] })).toEqual(
      err(GithubVerbErrors.notPositiveWholeNumber({ flag: "--pr", got: "0" })),
    );
  });

  it("refuses a negative --pr", () => {
    expect(parseGithubStackAdoptArgs({ argv: ["--pr", "-3"] })).toEqual(
      err(GithubVerbErrors.notPositiveWholeNumber({ flag: "--pr", got: "-3" })),
    );
  });

  it("defaults remote to origin", () => {
    const parsed = parseGithubStackAdoptArgs({ argv: ["--pr", "100"] });
    expect(parsed).toEqual(
      ok({ cwd: undefined, dryRun: false, home: undefined, prNumber: 100, registerOnly: false, remote: "origin" }),
    );
  });

  it("refuses a blank --remote", () => {
    expect(parseGithubStackAdoptArgs({ argv: ["--pr", "100", "--remote", "  "] })).toEqual(
      err(GithubVerbErrors.remoteBlank({ got: "  " })),
    );
  });

  it("parses every flag", () => {
    const parsed = parseGithubStackAdoptArgs({
      argv: [
        "--pr",
        "100",
        "--cwd",
        "/work",
        "--remote",
        "upstream",
        "--home",
        "/home",
        "--dry-run",
        "--register-only",
      ],
    });
    expect(parsed).toEqual(
      ok({ cwd: "/work", dryRun: true, home: "/home", prNumber: 100, registerOnly: true, remote: "upstream" }),
    );
  });
});

describe("githubStackAdoptPlan", () => {
  it("builds the plan for a clean, one-commit, same-repo, authorised adopt", () => {
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts: baseFacts() });
    expect(result).toEqual(
      ok({
        baseBranch: "main",
        branch: "top",
        defaultBranch: "main",
        headSha: HEAD_SHA,
        overrideNotices: [],
        owner: "o",
        prNumber: 100,
        repo: "r",
        repoRoot: "/repo",
      }),
    );
  });

  it("refuses a closed pull request", () => {
    const facts = baseFacts({ pr: basePr({ state: "closed" }) });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("is closed, not open");
  });

  it("refuses a base repository that is not the checked-out repository", () => {
    const facts = baseFacts({ pr: basePr({ baseRepoFullName: "other/repo" }) });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("base repository (other/repo) is not o/r");
  });

  it("refuses a deleted-fork head repository", () => {
    const facts = baseFacts({
      pr: basePr({ head: { label: "o:top", ref: "top", repoFullName: undefined, sha: HEAD_SHA } }),
    });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("head repository is gone");
  });

  it("refuses a cross-fork head repository", () => {
    const facts = baseFacts({
      pr: basePr({ head: { label: "fork:top", ref: "top", repoFullName: "fork/r", sha: HEAD_SHA } }),
    });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("is a fork of o/r");
  });

  it("refuses when the checked-out branch does not match the PR's head branch", () => {
    const facts = baseFacts({ checkedOutBranch: "other-branch" });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("checked out other-branch, but PR #100's head branch is top");
  });

  it("refuses adopting the repository default branch", () => {
    const facts = baseFacts({
      checkedOutBranch: "main",
      pr: basePr({ head: { label: "o:main", ref: "main", repoFullName: "o/r", sha: HEAD_SHA } }),
    });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("is the repository default");
  });

  it("refuses a pull request with more than one commit, naming --register-only as the way past it", () => {
    const facts = baseFacts({ pr: basePr({ commits: 3 }) });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("has 3 commits");
  });

  it("refuses a pull request whose commit count GitHub did not report", () => {
    const facts = baseFacts({ pr: basePr({ commits: undefined }) });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("has an unknown number of commits");
  });

  it("refuses a local HEAD that does not match GitHub's reported head SHA", () => {
    const facts = baseFacts({ localHeadSha: "4".repeat(40) });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("does not match GitHub's reported head SHA");
  });

  it("refuses a foreign-authored pull request", () => {
    const refused: Authorisation = { kind: "refused", reason: "not yours" };
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: refused, facts: baseFacts() });
    expect(result).toEqual(err("not yours"));
  });

  it("carries the authorisation override notice through to the plan", () => {
    const overridden: Authorisation = { kind: "overridden", notice: "OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1" };
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: overridden, facts: baseFacts() });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).overrideNotices).toEqual(["OVERRIDDEN via SLOPWEAVER_ALLOW_FOREIGN_PR=1"]);
  });

  it("refuses a dirty worktree with no override", () => {
    const facts = baseFacts({ dirty: true });
    const result = githubStackAdoptPlan({ allowDirty: false, authorisation: SELF, facts });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain("uncommitted changes");
    expect(unwrapErr(result)).toContain(ALLOW_DIRTY_TREE);
  });

  it("carries the dirty-tree override notice through to the plan", () => {
    const facts = baseFacts({ dirty: true });
    const result = githubStackAdoptPlan({ allowDirty: true, authorisation: SELF, facts });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).overrideNotices).toEqual([
      `OVERRIDDEN via ${ALLOW_DIRTY_TREE}=1 — adopting with uncommitted changes in the worktree.`,
    ]);
  });
});

describe("githubStackAdoptFreshness", () => {
  it("is fresh when nothing changed", () => {
    const snapshot = basePr();
    expect(githubStackAdoptFreshness({ current: snapshot, previewed: snapshot })).toEqual({ fresh: true });
  });

  it("reports the author changing", () => {
    const previewed = basePr();
    const current = basePr({ authorId: 2 });
    const result = githubStackAdoptFreshness({ current, previewed });
    expect(result.fresh).toBe(false);
    expect(result.fresh ? "" : result.reason).toContain("the author changed");
  });

  it("reports the head commit changing", () => {
    const previewed = basePr();
    const current = basePr({ head: { ...previewed.head, sha: "9".repeat(40) } });
    const result = githubStackAdoptFreshness({ current, previewed });
    expect(result.fresh).toBe(false);
    expect(result.fresh ? "" : result.reason).toContain("the head commit changed");
  });

  it("reports the base branch changing", () => {
    const previewed = basePr();
    const current = basePr({ baseRef: "other-base" });
    const result = githubStackAdoptFreshness({ current, previewed });
    expect(result.fresh).toBe(false);
    expect(result.fresh ? "" : result.reason).toContain("the base branch changed");
  });

  it("reports the open/closed state changing", () => {
    const previewed = basePr();
    const current = basePr({ state: "closed" });
    const result = githubStackAdoptFreshness({ current, previewed });
    expect(result.fresh).toBe(false);
    expect(result.fresh ? "" : result.reason).toContain("the open/closed state changed");
  });

  it("reports the commit count changing even when the head commit did not move", () => {
    // A base force-pushed backward, independently of this PR's own branch, can make GitHub report a higher
    // commit count for the SAME head SHA — the base's old tip now looks like part of the PR's own diff.
    const previewed = basePr();
    const current = basePr({ commits: 2 });
    const result = githubStackAdoptFreshness({ current, previewed });
    expect(result.fresh).toBe(false);
    expect(result.fresh ? "" : result.reason).toContain("the commit count changed");
  });
});

describe("githubStackAdoptDoorRequest", () => {
  it("describes the external write", () => {
    const request = githubStackAdoptDoorRequest({
      home: "/home",
      plan: {
        baseBranch: "main",
        branch: "top",
        defaultBranch: "main",
        headSha: HEAD_SHA,
        overrideNotices: [],
        owner: "o",
        prNumber: 100,
        repo: "r",
        repoRoot: "/repo",
      },
    });
    expect(request).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack adopt" },
      artifact: { baseBranch: "main", branch: "top", headSha: HEAD_SHA, prNumber: 100, repo: "o/r" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});

describe("githubStackAdoptWarning", () => {
  it("is undefined when nothing sits below", () => {
    expect(githubStackAdoptWarning({ entriesBelow: [], prNumber: 100, stackNumber: 5 })).toBeUndefined();
  });

  it("is undefined when every entry below is merged or registered", () => {
    const warning = githubStackAdoptWarning({
      entriesBelow: [
        { merged: true, number: 98, registered: false },
        { merged: false, number: 99, registered: true },
      ],
      prNumber: 100,
      stackNumber: 5,
    });
    expect(warning).toBeUndefined();
  });

  it("warns, singular, about one unmerged unregistered entry below", () => {
    const warning = githubStackAdoptWarning({
      entriesBelow: [{ merged: false, number: 99, registered: false }],
      prNumber: 100,
      stackNumber: 5,
    });
    expect(warning).toBe(
      "warning: PR #100 sits above an unregistered, unmerged entry (#99) in native stack #5 — " +
        "stack sync cannot progress past it until it is also pushed or adopted.",
    );
  });

  it("warns, plural, about more than one unmerged unregistered entry below", () => {
    const warning = githubStackAdoptWarning({
      entriesBelow: [
        { merged: false, number: 98, registered: false },
        { merged: false, number: 99, registered: false },
      ],
      prNumber: 100,
      stackNumber: 5,
    });
    expect(warning).toBe(
      "warning: PR #100 sits above unregistered, unmerged entries (#98, #99) in native stack #5 — " +
        "stack sync cannot progress past them until they are also pushed or adopted.",
    );
  });
});

describe("patchEquivalentNotice", () => {
  it("names GitHub's own count", () => {
    expect(patchEquivalentNotice({ commits: 2 })).toBe(
      "commits: GitHub reports 2, but every other commit on this branch is patch-equivalent to one its base " +
        "already landed — the rebase will leave exactly its tip",
    );
  });

  it("says GitHub reported no count rather than reading an absent one as 0", () => {
    expect(patchEquivalentNotice({ commits: undefined })).toBe(
      "commits: GitHub reports no commit count, but every other commit on this branch is patch-equivalent to " +
        "one its base already landed — the rebase will leave exactly its tip",
    );
  });
});
