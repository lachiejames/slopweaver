/** `cmux/trunkRef.ts`, the lookups in `cmux/worktreeList.ts` and the git-write failure line — no git or filesystem involved. */
import { describe, expect, it } from "vitest";

import { describeGitWriteFailure, summariseGitStderr } from "../../../cmux/gitWriteFailure.js";
import {
  buildFreshBranchAddArgs,
  newPrivateFetchRef,
  parseRemoteDefaultBranch,
  remoteBranchFromBase,
} from "../../../cmux/trunkRef.js";
import {
  findWorktreeAtPath,
  findWorktreeForBranch,
  ownedBranches,
  parseWorktreeListPorcelain,
  reusedTreeBranch,
  worktreeBranch,
} from "../../../cmux/worktreeList.js";

describe("buildFreshBranchAddArgs", () => {
  it("passes the given fetch ref through to worktree add, never the literal FETCH_HEAD", () => {
    const args = buildFreshBranchAddArgs({
      branch: "handover-slug",
      fetchRef: "refs/slopweaver/fetch/abc123",
      path: "/repo/slopweaver-fleet/handover-slug",
    });
    expect(args).toEqual([
      "worktree",
      "add",
      "--no-checkout",
      "-b",
      "handover-slug",
      "/repo/slopweaver-fleet/handover-slug",
      "refs/slopweaver/fetch/abc123",
    ]);
  });
});

describe("newPrivateFetchRef", () => {
  it("mints a ref under this tool's own private namespace, never the shared FETCH_HEAD", () => {
    const ref = newPrivateFetchRef();
    expect(ref.startsWith("refs/slopweaver/fetch/")).toBe(true);
    expect(ref).not.toBe("FETCH_HEAD");
  });

  it("mints a distinct ref on every call, so two concurrent fetches never collide", () => {
    const first = newPrivateFetchRef();
    const second = newPrivateFetchRef();
    expect(first).not.toBe(second);
  });
});

describe("parseWorktreeListPorcelain", () => {
  it("reads one entry per block, carrying the branch without its refs/heads prefix", () => {
    const text = [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.claude/worktrees.noindex/a-doc",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/a-doc",
      "",
    ].join("\n");

    expect(parseWorktreeListPorcelain({ text })).toEqual([
      { branch: "main", path: "/repo" },
      { branch: "a-doc", path: "/repo/.claude/worktrees.noindex/a-doc" },
    ]);
  });

  it("reads a detached worktree's branch as null rather than dropping the entry", () => {
    const text = ["worktree /repo/detached", "HEAD 3333333333333333333333333333333333333333", "detached", ""].join(
      "\n",
    );

    expect(parseWorktreeListPorcelain({ text })).toEqual([{ branch: null, path: "/repo/detached" }]);
  });

  it("reads git's lock, with or without a reason, and leaves an unlocked entry exactly as before", () => {
    const text = [
      "worktree /repo/bare-lock\nHEAD abc\nbranch refs/heads/one\nlocked",
      "worktree /repo/reason-lock\nHEAD def\nbranch refs/heads/two\nlocked seat working here",
      "worktree /repo/open\nHEAD 123\nbranch refs/heads/three",
    ].join("\n\n");
    expect(parseWorktreeListPorcelain({ text })).toEqual([
      { branch: "one", locked: true, path: "/repo/bare-lock" },
      { branch: "two", locked: true, path: "/repo/reason-lock" },
      { branch: "three", path: "/repo/open" },
    ]);
  });

  it("drops a block with no worktree line, which is the only thing that makes an entry unusable", () => {
    expect(parseWorktreeListPorcelain({ text: "branch refs/heads/orphan\n" })).toEqual([]);
  });

  it("answers an empty list for empty output", () => {
    expect(parseWorktreeListPorcelain({ text: "" })).toEqual([]);
  });
});

describe("findWorktreeForBranch", () => {
  const worktrees = [
    { branch: "main", path: "/repo" },
    { branch: null, path: "/repo/detached" },
    { branch: "a-doc", path: "/wt/a-doc" },
  ];

  it("finds the worktree holding a candidate branch", () => {
    expect(findWorktreeForBranch({ candidates: ["a-doc"], worktrees })).toEqual({ branch: "a-doc", path: "/wt/a-doc" });
  });

  // The doc comment's own claim: the EARLIEST-LISTED worktree wins, not the earliest candidate.
  it("wins on list order rather than candidate order when two candidates both have worktrees", () => {
    expect(findWorktreeForBranch({ candidates: ["a-doc", "main"], worktrees })).toEqual({
      branch: "main",
      path: "/repo",
    });
  });

  it("never matches a detached worktree, whose branch is null", () => {
    expect(findWorktreeForBranch({ candidates: ["nothing-here"], worktrees })).toBeUndefined();
  });

  // MEASURED: a finished run's tree stopped on a rebase conflict printed `detached`, the lookup
  // missed it, and `git worktree add` refused the landing row's branch as "already used by worktree".
  it("finds a detached worktree whose rebase still holds the candidate branch", () => {
    const held = { branch: null, heldBranches: ["backup-ssd"], path: "/wt/backup-ssd" };
    expect(findWorktreeForBranch({ candidates: ["backup-ssd"], worktrees: [...worktrees, held] })).toEqual(held);
  });

  it("finds a detached worktree by the second of two branches it holds", () => {
    const held = { branch: null, heldBranches: ["other", "backup-ssd"], path: "/wt/backup-ssd" };
    expect(findWorktreeForBranch({ candidates: ["backup-ssd"], worktrees: [...worktrees, held] })).toEqual(held);
  });
});

describe("ownedBranches", () => {
  it("answers the checked-out branch alone", () => {
    expect(ownedBranches({ worktree: { branch: "a-doc", path: "/wt/a-doc" } })).toEqual(["a-doc"]);
  });

  it("answers every branch a detached tree's rebase and bisect hold", () => {
    expect(ownedBranches({ worktree: { branch: null, heldBranches: ["b", "a"], path: "/wt/x" } })).toEqual(["b", "a"]);
  });

  it("answers nothing for a detached tree nothing holds a branch in", () => {
    expect(ownedBranches({ worktree: { branch: null, path: "/wt/detached" } })).toEqual([]);
  });
});

describe("worktreeBranch", () => {
  it("answers the checked-out branch first", () => {
    expect(worktreeBranch({ worktree: { branch: "a-doc", path: "/wt/a-doc" } })).toBe("a-doc");
  });

  it("answers the first held branch of a detached tree", () => {
    expect(worktreeBranch({ worktree: { branch: null, heldBranches: ["a-doc", "b"], path: "/wt/a-doc" } })).toBe(
      "a-doc",
    );
  });

  it("answers null for a detached tree nothing holds a branch in", () => {
    expect(worktreeBranch({ worktree: { branch: null, path: "/wt/detached" } })).toBe(null);
  });
});

describe("reusedTreeBranch", () => {
  it("answers the branch it would create when no tree is reused", () => {
    expect(reusedTreeBranch({ candidates: ["a-doc"], existing: undefined, whenAbsent: "new-branch" })).toBe(
      "new-branch",
    );
  });

  it("answers a reused tree's held branch while a rebase detaches it", () => {
    const existing = { branch: null, heldBranches: ["a-doc"], path: "/wt/a-doc" };
    expect(reusedTreeBranch({ candidates: [], existing, whenAbsent: "new-branch" })).toBe("a-doc");
  });

  // A rebase of `other` started mid-bisect holds both, and the row asked for the bisect's `b`.
  it("answers the candidate a two-hold tree owns, not the rebase's branch listed first", () => {
    const existing = { branch: null, heldBranches: ["other", "b"], path: "/wt/held" };
    expect(reusedTreeBranch({ candidates: ["b", "row"], existing, whenAbsent: "new-branch" })).toBe("b");
  });

  it("answers a reused tree's checked-out branch when it was found by path, not by a candidate", () => {
    const existing = { branch: "kept", path: "/wt/row" };
    expect(reusedTreeBranch({ candidates: ["row"], existing, whenAbsent: "new-branch" })).toBe("kept");
  });

  it("answers the branch it would create for a reused detached tree holding nothing", () => {
    const existing = { branch: null, path: "/wt/detached" };
    expect(reusedTreeBranch({ candidates: ["row"], existing, whenAbsent: "new-branch" })).toBe("new-branch");
  });
});

describe("findWorktreeAtPath", () => {
  it("finds the worktree registered at a path", () => {
    const worktrees = [{ branch: "a-doc", path: "/wt/a-doc" }];
    expect(findWorktreeAtPath({ path: "/wt/a-doc", worktrees })).toEqual({ branch: "a-doc", path: "/wt/a-doc" });
  });

  it("answers undefined when git lists nothing at that path", () => {
    expect(findWorktreeAtPath({ path: "/wt/never-created", worktrees: [] })).toBeUndefined();
  });
});

describe("parseRemoteDefaultBranch", () => {
  it("reads the branch the remote's HEAD points at", () => {
    const text = ["ref: refs/heads/main\tHEAD", "abc123\tHEAD"].join("\n");
    expect(parseRemoteDefaultBranch({ text })).toBe("main");
  });

  // Trunk is `main` here and a different long-lived branch on at least one repository this tool targets,
  // which is the whole reason this is parsed rather than assumed.
  it("reads a trunk that is not main", () => {
    expect(parseRemoteDefaultBranch({ text: "ref: refs/heads/develop\tHEAD\n" })).toBe("develop");
  });

  it("answers undefined when the remote reported no symref", () => {
    expect(parseRemoteDefaultBranch({ text: "abc123\tHEAD\n" })).toBeUndefined();
  });
});

describe("remoteBranchFromBase", () => {
  // The verb's own usage example: verbatim it became `refs/heads/origin/main` and the fetch found no ref.
  it("reads the usage example's remote-tracking spelling as the branch the remote knows", () => {
    expect(remoteBranchFromBase({ base: "origin/main" })).toBe("main");
  });

  it("reads the full remote-tracking ref the same way", () => {
    expect(remoteBranchFromBase({ base: "refs/remotes/origin/main" })).toBe("main");
  });

  it("reads a full local ref as its branch, so it is not prefixed twice", () => {
    expect(remoteBranchFromBase({ base: "refs/heads/main" })).toBe("main");
  });

  it("strips only the leading prefix, keeping a slash inside the branch name", () => {
    expect(remoteBranchFromBase({ base: "origin/feat/stack-base" })).toBe("feat/stack-base");
  });

  // One prefix only, so a remote branch literally named `origin/x` stays reachable by its full ref.
  it("strips a single prefix, never recursively", () => {
    expect(remoteBranchFromBase({ base: "refs/heads/origin/main" })).toBe("origin/main");
  });

  it("passes a bare branch name through unchanged", () => {
    expect(remoteBranchFromBase({ base: "main" })).toBe("main");
  });

  it("leaves a branch that only starts with the remote's name, without its slash, alone", () => {
    expect(remoteBranchFromBase({ base: "origin-sync" })).toBe("origin-sync");
  });
});

describe("summariseGitStderr", () => {
  it("keeps the tail, trimmed and joined, dropping blank lines", () => {
    expect(summariseGitStderr({ stderr: "  first  \n\n  second  \n" })).toBe("first; second");
  });

  it("drops a checkout progress line, which is noise rather than a reason", () => {
    expect(summariseGitStderr({ stderr: "Updating files:  89% (890/1000)\nfatal: it broke" })).toBe("fatal: it broke");
  });

  it("answers an empty string when git said nothing", () => {
    expect(summariseGitStderr({ stderr: "" })).toBe("");
  });
});

describe("describeGitWriteFailure", () => {
  const args = ["worktree", "add", "/wt/a-doc"];

  // A timeout keeps the LAST line, progress bar included: "still at 89%" is the useful fact there, and it is
  // exactly the line `summariseGitStderr` drops.
  it("names the bound and where the checkout had got to when it timed out", () => {
    expect(
      describeGitWriteFailure({
        args,
        code: null,
        signal: "SIGKILL",
        stderr: "Updating files:  89% (890/1000)",
        timedOut: true,
        timeoutMs: 600_000,
      }),
    ).toBe("git worktree add /wt/a-doc failed: timed out after 600s (last output: Updating files:  89% (890/1000))");
  });

  it("gives git's own words when it printed any", () => {
    expect(
      describeGitWriteFailure({
        args,
        code: 128,
        signal: null,
        stderr: "fatal: '/wt/a-doc' already exists",
        timedOut: false,
        timeoutMs: 600_000,
      }),
    ).toBe("git worktree add /wt/a-doc failed: fatal: '/wt/a-doc' already exists");
  });

  it("names the signal when git died silently on one", () => {
    expect(
      describeGitWriteFailure({ args, code: null, signal: "SIGSEGV", stderr: "", timedOut: false, timeoutMs: 1 }),
    ).toBe("git worktree add /wt/a-doc failed: killed by SIGSEGV");
  });

  it("falls back to the exit code when there is nothing else to report", () => {
    expect(describeGitWriteFailure({ args, code: 1, signal: null, stderr: "", timedOut: false, timeoutMs: 1 })).toBe(
      "git worktree add /wt/a-doc failed: exit 1",
    );
  });
});
