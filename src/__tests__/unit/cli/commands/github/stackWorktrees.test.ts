import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  parseGithubWorktreeList,
  worktreesForStackBranches,
} from "../../../../../cli/commands/github/stackWorktrees.js";
import { err, ok } from "../../../../../lib/result.js";

/** Build one `git worktree list --porcelain -z` record, joined with NULs, matching git's own format. */
function record({ fields }: { fields: readonly string[] }): string {
  return fields.join("\0");
}

describe("parseGithubWorktreeList", () => {
  it("parses a real multi-worktree listing", () => {
    const text = [
      record({ fields: ["worktree /repo", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main"] }),
      record({
        fields: ["worktree /repo-bottom", "HEAD 2222222222222222222222222222222222222222", "branch refs/heads/bottom"],
      }),
      record({ fields: ["worktree /repo-top", "HEAD 3333333333333333333333333333333333333333", "detached"] }),
      "",
    ].join("\0\0");
    expect(parseGithubWorktreeList({ text })).toEqual([
      {
        bare: false,
        branch: "main",
        detached: false,
        headSha: "1111111111111111111111111111111111111111",
        locked: false,
        path: "/repo",
        prunable: false,
      },
      {
        bare: false,
        branch: "bottom",
        detached: false,
        headSha: "2222222222222222222222222222222222222222",
        locked: false,
        path: "/repo-bottom",
        prunable: false,
      },
      {
        bare: false,
        branch: undefined,
        detached: true,
        headSha: "3333333333333333333333333333333333333333",
        locked: false,
        path: "/repo-top",
        prunable: false,
      },
    ]);
  });

  it("reads a locked worktree with its reason, and a bare one", () => {
    const text = [
      record({ fields: ["worktree /main", "HEAD 1111111111111111111111111111111111111111", "bare"] }),
      record({
        fields: [
          "worktree /locked",
          "HEAD 2222222222222222222222222222222222222222",
          "branch refs/heads/feature",
          "locked administrator disabled it",
        ],
      }),
      "",
    ].join("\0\0");
    const parsed = parseGithubWorktreeList({ text });
    expect(parsed[0]).toEqual({
      bare: true,
      branch: undefined,
      detached: false,
      headSha: "1111111111111111111111111111111111111111",
      locked: false,
      path: "/main",
      prunable: false,
    });
    expect(parsed[1]).toEqual({
      bare: false,
      branch: "feature",
      detached: false,
      headSha: "2222222222222222222222222222222222222222",
      locked: true,
      path: "/locked",
      prunable: false,
    });
  });

  it("returns an empty list for empty output", () => {
    expect(parseGithubWorktreeList({ text: "" })).toEqual([]);
  });
});

describe("worktreesForStackBranches", () => {
  const worktrees = parseGithubWorktreeList({
    text: [
      record({ fields: ["worktree /repo", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main"] }),
      record({
        fields: ["worktree /repo-bottom", "HEAD 2222222222222222222222222222222222222222", "branch refs/heads/bottom"],
      }),
      record({ fields: ["worktree /repo-top", "HEAD 3333333333333333333333333333333333333333", "detached"] }),
      record({
        fields: ["worktree /repo-dup-a", "HEAD 4444444444444444444444444444444444444444", "branch refs/heads/dup"],
      }),
      record({
        fields: ["worktree /repo-dup-b", "HEAD 5555555555555555555555555555555555555555", "branch refs/heads/dup"],
      }),
      "",
    ].join("\0\0"),
  });

  it("resolves a branch with exactly one clean worktree", () => {
    const resolved = worktreesForStackBranches({ branches: ["bottom"], worktrees });
    expect(resolved.get("bottom")).toEqual(
      ok({
        bare: false,
        branch: "bottom",
        detached: false,
        headSha: "2222222222222222222222222222222222222222",
        locked: false,
        path: "/repo-bottom",
        prunable: false,
      }),
    );
  });

  it("refuses a branch with no worktree at all", () => {
    const resolved = worktreesForStackBranches({ branches: ["nowhere"], worktrees });
    expect(resolved.get("nowhere")).toEqual(err(GithubVerbErrors.noWorktree({ branch: "nowhere" })));
  });

  it("refuses a branch checked out in more than one worktree", () => {
    const resolved = worktreesForStackBranches({ branches: ["dup"], worktrees });
    expect(resolved.get("dup")).toEqual(
      err(GithubVerbErrors.worktreeAmbiguous({ branch: "dup", paths: ["/repo-dup-a", "/repo-dup-b"] })),
    );
  });

  it("resolves the branches it can while refusing the ones it can't", () => {
    const resolved = worktreesForStackBranches({ branches: ["bottom", "nowhere"], worktrees });
    expect(resolved.get("bottom")!.isOk()).toBe(true);
    expect(resolved.get("nowhere")!.isErr()).toBe(true);
  });
});
