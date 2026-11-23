/*
 * `stackWorktreeList`: every `git worktree list --porcelain -z` record the repository root reports, parsed in
 * order, with no flag column readable off a sibling's field.
 */
import { describe, expect, it } from "vitest";

import { stackWorktreeList } from "../../../../../../cli/commands/github/stackFacts.js";
import { gitFake, SHA_HEAD_ALPHA, SHA_TIP_QUEBEC, SHA_WT_ALPHA, SHA_WT_LISTED } from "./harness.js";

describe("stackWorktreeList", () => {
  // bare=[F,F,F,T,F,F] detached=[F,F,T,F,T,F] locked=[F,T,F,F,F,T] prunable=[F,F,F,F,T,T]: no flag column equals
  // or negates another, so none can be read off a sibling's field.
  it("parses every worktree record the repository root reports, in order", () => {
    const records = [
      ["worktree /wt-normal", `HEAD ${SHA_WT_LISTED}`, "branch refs/heads/normal-hotel"],
      ["worktree /wt-locked", `HEAD ${SHA_TIP_QUEBEC}`, "branch refs/heads/locked-india", "locked reason-juliet"],
      ["worktree /wt-detached", `HEAD ${SHA_HEAD_ALPHA}`, "detached"],
      // The bare record carries a HEAD like every other, so being bare is never read off a missing HEAD.
      ["worktree /wt-bare", `HEAD ${SHA_HEAD_ALPHA}`, "bare"],
      ["worktree /wt-gone", `HEAD ${SHA_TIP_QUEBEC}`, "detached", "prunable gitdir points nowhere"],
      // Branchless yet neither bare nor detached, and locked and prunable as BARE words with no reason after
      // them: bare is never inferred from a missing branch, and each flag is read in both of git's spellings.
      ["worktree /wt-held", `HEAD ${SHA_WT_ALPHA}`, "locked", "prunable"],
    ].map((fields) => fields.join("\0"));
    const { git, reads } = gitFake({
      answers: [["/repo-kilo :: worktree list --porcelain -z", [...records, ""].join("\0\0")]],
    });

    const listed = stackWorktreeList({ git, repoRoot: "/repo-kilo" });

    expect(listed).toEqual([
      {
        bare: false,
        branch: "normal-hotel",
        detached: false,
        headSha: SHA_WT_LISTED,
        locked: false,
        path: "/wt-normal",
        prunable: false,
      },
      {
        bare: false,
        branch: "locked-india",
        detached: false,
        headSha: SHA_TIP_QUEBEC,
        locked: true,
        path: "/wt-locked",
        prunable: false,
      },
      {
        bare: false,
        branch: undefined,
        detached: true,
        headSha: SHA_HEAD_ALPHA,
        locked: false,
        path: "/wt-detached",
        prunable: false,
      },
      {
        bare: true,
        branch: undefined,
        detached: false,
        headSha: SHA_HEAD_ALPHA,
        locked: false,
        path: "/wt-bare",
        prunable: false,
      },
      {
        bare: false,
        branch: undefined,
        detached: true,
        headSha: SHA_TIP_QUEBEC,
        locked: false,
        path: "/wt-gone",
        prunable: true,
      },
      {
        bare: false,
        branch: undefined,
        detached: false,
        headSha: SHA_WT_ALPHA,
        locked: true,
        path: "/wt-held",
        prunable: true,
      },
    ]);
    expect(reads).toEqual([{ args: ["worktree", "list", "--porcelain", "-z"], cwd: "/repo-kilo" }]);
  });
});
