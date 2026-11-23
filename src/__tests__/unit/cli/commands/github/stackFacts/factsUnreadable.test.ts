/*
 * `stackFactsForEntries` when reads fail: an unreadable remote tip, worktree HEAD or base ref becomes an
 * undefined fact, and ancestry is measured only when both the worktree and the tip were read — never gated on
 * the pull request being readable, open, or first in the run.
 */
import { describe, expect, it } from "vitest";

import { stackFactsForEntries } from "../../../../../../cli/commands/github/stackFacts.js";
import type { WrittenPr } from "../../../../../../corpus/github/write.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import { ancestryFake, apiFake, entry, gitFake, worktree, writtenPr } from "./harness.js";

describe("stackFactsForEntries", () => {
  it("turns unreadable tips and HEADs into undefined facts, gating ancestry on the worktree and the tip alone", async () => {
    const SHA_TIP_YANKEE = "0707070707070707070707070707070707070707";
    const SHA_WT_LIMA = "0808080808080808080808080808080808080808";
    const SHA_HEAD_KILO = "0909090909090909090909090909090909090909";
    const SHA_HEAD_LIMA = "1010101010101010101010101010101010101010";
    const SHA_HEAD_MIKE = "1212121212121212121212121212121212121212";
    const SHA_WT_KILO = "1313131313131313131313131313131313131313";
    const SHA_TIP_UNIFORM = "1414141414141414141414141414141414141414";
    const { git, reads } = gitFake({
      answers: [
        ["/repo-whiskey :: rev-parse refs/heads/base-yankee", SHA_TIP_YANKEE],
        ["/wt-lima :: rev-parse HEAD", SHA_WT_LIMA],
        ["/repo-whiskey :: ls-remote mirror-xray refs/heads/trunk-victor", ""],
        ["/wt-kilo :: rev-parse HEAD", SHA_WT_KILO],
        ["/repo-whiskey :: rev-parse refs/heads/base-uniform", SHA_TIP_UNIFORM],
        ["/wt-november :: rev-parse HEAD", new Error("HEAD unreadable in november")],
        ["/repo-whiskey :: rev-parse refs/heads/base-zulu", new Error("unknown revision base-zulu")],
      ],
    });
    // Kilo's and november's reads fail while each HAS a worktree (the case above's only failed read had none), so
    // the worktree HEAD, the ancestry and the residue are never read off whether the pull request was readable.
    const { api, calls: prCalls } = apiFake({
      answers: new Map<number, WrittenPr | IngestError>([
        [911, { kind: "http", message: "pr read refused kilo", operation: "pulls.get" }],
        [912, writtenPr({ commits: 2, headRef: "fix-lima", headSha: SHA_HEAD_LIMA, number: 912 })],
        [913, writtenPr({ commits: 5, headRef: "fix-mike", headSha: SHA_HEAD_MIKE, number: 913 })],
        [914, { kind: "http", message: "pr read refused november", operation: "pulls.get" }],
      ]),
    });
    const { isAncestor, calls: ancestryCalls } = ancestryFake({
      answers: new Map([
        ["refs/heads/fix-lima", false],
        // Decoys: kilo has a worktree but no tip, mike neither — asking either would surface a wrong `true`.
        ["refs/heads/fix-kilo", true],
        ["refs/heads/fix-mike", true],
        ["refs/heads/fix-november", true],
      ]),
    });

    const result = await stackFactsForEntries({
      context: {
        api,
        defaultBranch: "trunk-victor",
        git,
        isAncestor,
        owner: "owner-tango",
        registeredNumbers: new Set([960, 912]),
        remote: "mirror-xray",
        repo: "repo-uniform",
        repoRoot: "/repo-whiskey",
        stackNumber: 83,
      },
      // The default-branch base sits SECOND here (first in the case above), so it is never read off position.
      entries: [
        entry({ baseRef: "base-yankee", headRef: "fix-lima", mergedAtIso: undefined, number: 912, state: "open" }),
        entry({ baseRef: "trunk-victor", headRef: "fix-kilo", mergedAtIso: undefined, number: 911, state: "open" }),
        // Worktree present but its HEAD unreadable, tip readable: ancestry is still measured — and it is closed,
        // so ancestry is never gated on the pull request being open.
        entry({
          baseRef: "base-uniform",
          headRef: "fix-november",
          mergedAtIso: undefined,
          number: 914,
          state: "closed",
        }),
        // Closed but never merged: still measured, because merge status is `mergedAtIso`, not `state`.
        entry({ baseRef: "base-zulu", headRef: "fix-mike", mergedAtIso: undefined, number: 913, state: "closed" }),
      ],
      firstPosition: 2,
      worktrees: [
        worktree({ branch: "fix-kilo", headSha: SHA_HEAD_MIKE, path: "/wt-kilo" }),
        worktree({ branch: "fix-lima", headSha: SHA_HEAD_KILO, path: "/wt-lima" }),
        worktree({ branch: "fix-november", headSha: SHA_HEAD_LIMA, path: "/wt-november" }),
      ],
    });

    expect(result.facts).toEqual([
      {
        baseBranch: "base-yankee",
        baseIsAncestorOfHead: false,
        branch: "fix-lima",
        commits: 2,
        headSha: SHA_HEAD_LIMA,
        merged: false,
        position: 2,
        pullRequestNumber: 912,
        registered: true,
        stackNumber: 83,
        worktreeHeadSha: SHA_WT_LIMA,
        worktreePath: "/wt-lima",
      },
      {
        baseBranch: "trunk-victor",
        baseIsAncestorOfHead: false,
        branch: "fix-kilo",
        commits: undefined,
        headSha: undefined,
        merged: false,
        position: 3,
        pullRequestNumber: 911,
        registered: false,
        stackNumber: 83,
        worktreeHeadSha: SHA_WT_KILO,
        worktreePath: "/wt-kilo",
      },
      {
        baseBranch: "base-uniform",
        baseIsAncestorOfHead: true,
        branch: "fix-november",
        commits: undefined,
        headSha: undefined,
        merged: false,
        position: 4,
        pullRequestNumber: 914,
        registered: false,
        stackNumber: 83,
        worktreeHeadSha: undefined,
        worktreePath: "/wt-november",
      },
      {
        baseBranch: "base-zulu",
        baseIsAncestorOfHead: false,
        branch: "fix-mike",
        commits: 5,
        headSha: SHA_HEAD_MIKE,
        merged: false,
        position: 5,
        pullRequestNumber: 913,
        registered: false,
        stackNumber: 83,
        worktreeHeadSha: undefined,
        worktreePath: undefined,
      },
    ]);
    expect(result.residue).toEqual(["stack #83 branch fix-mike: no worktree has fix-mike checked out"]);
    expect(prCalls).toEqual([
      { number: 912, owner: "owner-tango", repo: "repo-uniform" },
      { number: 911, owner: "owner-tango", repo: "repo-uniform" },
      { number: 914, owner: "owner-tango", repo: "repo-uniform" },
      { number: 913, owner: "owner-tango", repo: "repo-uniform" },
    ]);
    expect(reads).toEqual([
      { args: ["rev-parse", "refs/heads/base-yankee"], cwd: "/repo-whiskey" },
      { args: ["rev-parse", "HEAD"], cwd: "/wt-lima" },
      { args: ["ls-remote", "mirror-xray", "refs/heads/trunk-victor"], cwd: "/repo-whiskey" },
      { args: ["rev-parse", "HEAD"], cwd: "/wt-kilo" },
      { args: ["rev-parse", "refs/heads/base-uniform"], cwd: "/repo-whiskey" },
      { args: ["rev-parse", "HEAD"], cwd: "/wt-november" },
      { args: ["rev-parse", "refs/heads/base-zulu"], cwd: "/repo-whiskey" },
    ]);
    expect(ancestryCalls).toEqual([
      { ancestor: SHA_TIP_YANKEE, cwd: "/repo-whiskey", descendant: "refs/heads/fix-lima" },
      { ancestor: SHA_TIP_UNIFORM, cwd: "/repo-whiskey", descendant: "refs/heads/fix-november" },
    ]);
  });
});
