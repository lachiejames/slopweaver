/*
 * `stackFactsForEntries` over a mixed run: each non-merged entry measured, a merged one never read, a failed
 * pull-request read and a branch checked out twice turned into undefined facts and residue, and positions
 * numbered from `firstPosition`.
 */
import { describe, expect, it } from "vitest";

import { stackFactsForEntries } from "../../../../../../cli/commands/github/stackFacts.js";
import type { WrittenPr } from "../../../../../../corpus/github/write.js";
import type { IngestError } from "../../../../../../lib/ingestError.js";
import {
  ancestryFake,
  apiFake,
  entry,
  gitFake,
  SHA_HEAD_ALPHA,
  SHA_TIP_ALPHA,
  SHA_TIP_QUEBEC,
  SHA_WT_ALPHA,
  SHA_WT_LISTED,
  worktree,
  writtenPr,
} from "./harness.js";

const SHA_DECOY_CHARLIE = "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5";

describe("stackFactsForEntries", () => {
  it("measures each non-merged entry, never reads a merged one, and numbers them from firstPosition", async () => {
    const { git, reads } = gitFake({
      answers: [
        ["/repo-hotel :: ls-remote mirror-india refs/heads/trunk-golf", `${SHA_TIP_ALPHA}\trefs/heads/trunk-golf`],
        ["/wt-alpha :: rev-parse HEAD", SHA_WT_ALPHA],
        ["/repo-hotel :: rev-parse refs/heads/base-quebec", SHA_TIP_QUEBEC],
        // Decoys for the merged entry: answered, so a mutant that reads them gets wrong values, not a throw.
        ["/repo-hotel :: rev-parse refs/heads/base-romeo", SHA_DECOY_CHARLIE],
        ["/wt-charlie :: rev-parse HEAD", SHA_DECOY_CHARLIE],
      ],
    });
    const pullRequestFailure: IngestError = { kind: "http", message: "pr read refused sierra", operation: "pulls.get" };
    const { api, calls: prCalls } = apiFake({
      answers: new Map<number, WrittenPr | IngestError>([
        [901, writtenPr({ commits: 1, headRef: "feat-alpha", headSha: SHA_HEAD_ALPHA, number: 901 })],
        [902, pullRequestFailure],
        [903, writtenPr({ commits: 9, headRef: "feat-charlie", headSha: SHA_DECOY_CHARLIE, number: 903 })],
      ]),
    });
    const { isAncestor, calls: ancestryCalls } = ancestryFake({
      answers: new Map([
        ["refs/heads/feat-alpha", true],
        ["refs/heads/feat-bravo", true],
        ["refs/heads/feat-charlie", true],
      ]),
    });

    const result = await stackFactsForEntries({
      context: {
        api,
        defaultBranch: "trunk-golf",
        git,
        isAncestor,
        owner: "owner-oscar",
        // 903 is merged AND registered, 904 merged and not: a merged fact reads registration, never a constant.
        // 901 is registered on the default branch (case 2's 911 is not), so the remote-tip read never keys on it.
        registeredNumbers: new Set([955, 901, 902, 903]),
        remote: "mirror-india",
        repo: "repo-papa",
        repoRoot: "/repo-hotel",
        stackNumber: 71,
      },
      entries: [
        entry({ baseRef: "trunk-golf", headRef: "feat-alpha", mergedAtIso: undefined, number: 901, state: "open" }),
        entry({ baseRef: "base-quebec", headRef: "feat-bravo", mergedAtIso: undefined, number: 902, state: "open" }),
        entry({
          baseRef: "base-romeo",
          headRef: "feat-charlie",
          mergedAtIso: "2026-09-14T08:30:00Z",
          number: 903,
          state: "closed",
        }),
        // Merged with NO worktree: the refusal a non-merged entry would report must not become residue here.
        entry({
          baseRef: "base-sierra",
          headRef: "feat-delta",
          mergedAtIso: "2026-09-15T09:45:00Z",
          number: 904,
          state: "closed",
        }),
      ],
      firstPosition: 4,
      worktrees: [
        worktree({ branch: "unrelated-tango", headSha: SHA_WT_LISTED, path: "/wt-tango" }),
        worktree({ branch: "feat-alpha", headSha: SHA_HEAD_ALPHA, path: "/wt-alpha" }),
        worktree({ branch: "feat-bravo", headSha: SHA_TIP_QUEBEC, path: "/wt-bravo-one" }),
        worktree({ branch: "feat-bravo", headSha: SHA_TIP_ALPHA, path: "/wt-bravo-two" }),
        worktree({ branch: "feat-charlie", headSha: SHA_DECOY_CHARLIE, path: "/wt-charlie" }),
      ],
    });

    expect(result.facts).toEqual([
      {
        baseBranch: "trunk-golf",
        baseIsAncestorOfHead: true,
        branch: "feat-alpha",
        commits: 1,
        headSha: SHA_HEAD_ALPHA,
        merged: false,
        position: 4,
        pullRequestNumber: 901,
        registered: true,
        stackNumber: 71,
        worktreeHeadSha: SHA_WT_ALPHA,
        worktreePath: "/wt-alpha",
      },
      {
        baseBranch: "base-quebec",
        baseIsAncestorOfHead: false,
        branch: "feat-bravo",
        commits: undefined,
        headSha: undefined,
        merged: false,
        position: 5,
        pullRequestNumber: 902,
        registered: true,
        stackNumber: 71,
        worktreeHeadSha: undefined,
        worktreePath: undefined,
      },
      {
        baseBranch: "base-romeo",
        baseIsAncestorOfHead: false,
        branch: "feat-charlie",
        commits: undefined,
        headSha: undefined,
        merged: true,
        position: 6,
        pullRequestNumber: 903,
        registered: true,
        stackNumber: 71,
        worktreeHeadSha: undefined,
        worktreePath: undefined,
      },
      {
        baseBranch: "base-sierra",
        baseIsAncestorOfHead: false,
        branch: "feat-delta",
        commits: undefined,
        headSha: undefined,
        merged: true,
        position: 7,
        pullRequestNumber: 904,
        registered: false,
        stackNumber: 71,
        worktreeHeadSha: undefined,
        worktreePath: undefined,
      },
    ]);
    expect(result.residue).toEqual([
      "stack #71 branch feat-bravo: feat-bravo is checked out in more than one worktree: /wt-bravo-one, /wt-bravo-two",
    ]);
    expect(prCalls).toEqual([
      { number: 901, owner: "owner-oscar", repo: "repo-papa" },
      { number: 902, owner: "owner-oscar", repo: "repo-papa" },
    ]);
    expect(reads).toEqual([
      { args: ["ls-remote", "mirror-india", "refs/heads/trunk-golf"], cwd: "/repo-hotel" },
      { args: ["rev-parse", "HEAD"], cwd: "/wt-alpha" },
      { args: ["rev-parse", "refs/heads/base-quebec"], cwd: "/repo-hotel" },
    ]);
    expect(ancestryCalls).toEqual([
      { ancestor: SHA_TIP_ALPHA, cwd: "/repo-hotel", descendant: "refs/heads/feat-alpha" },
    ]);
  });
});
