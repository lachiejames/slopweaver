import { describe, expect, it } from "vitest";

import type { GithubPushDeps } from "../../../../../cli/commands/github/pushPrimitives.js";
import { forkPointOf, restackStagingRef, worktreesHolding } from "../../../../../cli/commands/github/restackExec.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

/** The generation one test replay belongs to — see `restackStagingRef`. */
const GEN = "2026-09-09T16-00-00-000Z-abcd1234";

/** One `git worktree list --porcelain -z` record set, joined the way git emits it. */
const porcelain = ({ lines }: { lines: readonly string[] }): string => `${lines.join("\0")}\0`;

describe("restackStagingRef", () => {
  it("names a private ref under the tool's own namespace", () => {
    expect(restackStagingRef({ branch: "devx-743-switchover", generationId: GEN })).toBe(
      `refs/slopweaver/restack/${GEN}/devx-743-switchover`,
    );
  });

  it("keeps a slashed branch name intact", () => {
    expect(restackStagingRef({ branch: "fix/ins-1052", generationId: GEN })).toBe(
      `refs/slopweaver/restack/${GEN}/fix/ins-1052`,
    );
  });
});

describe("worktreesHolding", () => {
  it("finds nothing when no worktree has the branch checked out", () => {
    const text = porcelain({ lines: ["worktree /repo", "HEAD abc123", "branch refs/heads/main", ""] });

    expect(worktreesHolding({ branch: "feature", worktreeListText: text })).toEqual([]);
  });

  it("names the one worktree holding it", () => {
    const text = porcelain({
      lines: [
        "worktree /repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repo/.worktrees/feature",
        "HEAD def456",
        "branch refs/heads/feature",
        "",
      ],
    });

    expect(worktreesHolding({ branch: "feature", worktreeListText: text })).toEqual(["/repo/.worktrees/feature"]);
  });

  it("names every worktree when two hold the same branch — the live acme-admin shape", () => {
    const text = porcelain({
      lines: [
        "worktree /repo/.worktrees/one",
        "HEAD abc123",
        "branch refs/heads/mx-2386",
        "",
        "worktree /repo/.worktrees/two",
        "HEAD abc123",
        "branch refs/heads/mx-2386",
        "",
      ],
    });

    expect(worktreesHolding({ branch: "mx-2386", worktreeListText: text })).toEqual([
      "/repo/.worktrees/one",
      "/repo/.worktrees/two",
    ]);
  });

  it("ignores a detached worktree sitting on the same commit", () => {
    const text = porcelain({ lines: ["worktree /repo/.worktrees/scratch", "HEAD abc123", "detached", ""] });

    expect(worktreesHolding({ branch: "feature", worktreeListText: text })).toEqual([]);
  });

  it("does not match a branch whose name merely prefixes the one asked for", () => {
    const text = porcelain({ lines: ["worktree /repo", "HEAD abc123", "branch refs/heads/feature-two", ""] });

    expect(worktreesHolding({ branch: "feature", worktreeListText: text })).toEqual([]);
  });
});

describe("forkPointOf", () => {
  /** Git edges whose only read is `merge-base`, answering `answer` or throwing it. */
  const gitAnswering = ({ answer }: { answer: string | Error }): GithubPushDeps => ({
    cwd: () => "/unused",
    doorLedger: memoryDoorLedger().port,
    out: () => undefined,
    readGit: ({ args, cwd }) => {
      if (cwd !== "/repo" || args.join(" ") !== "merge-base base-tip head-sha") {
        throw new Error(`unexpected Git read in ${cwd}: ${args.join(" ")}`);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    writeGit: () => {
      throw new Error("forkPointOf must never write");
    },
  });

  it("is the merge-base of the pre-run base tip and the head", () => {
    expect(
      forkPointOf({
        baseTip: "base-tip",
        git: gitAnswering({ answer: "fork-sha" }),
        headSha: "head-sha",
        repoRoot: "/repo",
      }),
    ).toBe("fork-sha");
  });

  it("is undefined when git finds no common ancestor", () => {
    expect(
      forkPointOf({
        baseTip: "base-tip",
        git: gitAnswering({ answer: new Error("exit 1") }),
        headSha: "head-sha",
        repoRoot: "/repo",
      }),
    ).toBe(undefined);
  });
});
