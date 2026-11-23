/**
 * `stackSquash.ts` — plain-fake tests for the decision logic, plus the real-git proof this module exists
 * for: reproducing the exact corruption an adversarial pass found in `--fork-point`, and confirming the
 * safe primitive here produces the correct result against the SAME adversarial fixture. `gitInTemp` per
 * `src/__tests__/tempGitRepo.ts` — a test may not shell git any other way.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import type { GithubPushDeps } from "../../../../../cli/commands/github/pushRun.js";
import { rebaseSingleCommitOntoFreshBase } from "../../../../../cli/commands/github/stackSquash.js";
import { err, ok, type Result, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const FRESH_BASE_SHA = "2222222222222222222222222222222222222222";
const PARENT_SHA = "3333333333333333333333333333333333333333";

/** `git rev-list --parents -1 <commit>`'s exact one-line output: the commit, then its parents (0, 1 or more). */
function revListParentsLine({ commit, parents }: { commit: string; parents: readonly string[] }): string {
  return [commit, ...parents].join(" ");
}

/** A plain fake `GithubPushDeps` — no `vi.fn`, just a closure recording calls. */
function fakeGit({
  reads = {},
  writes = () => ok(undefined),
}: {
  reads?: Readonly<Record<string, string>>;
  writes?: (args: readonly string[]) => Result<void, string>;
} = {}): { git: GithubPushDeps; calls: (readonly string[])[]; outLines: string[] } {
  const calls: (readonly string[])[] = [];
  const outLines: string[] = [];
  const privateRefPattern = /^rev-parse refs\/slopweaver\/fetch\/[0-9a-f-]{36}\^\{commit\}$/;
  return {
    calls,
    git: {
      cwd: () => "/repo",
      doorLedger: memoryDoorLedger().port,
      out: ({ line }) => outLines.push(line),
      readGit: ({ args }) => {
        const command = args.join(" ");
        const value = reads[command];
        if (value !== undefined) {
          return value;
        }
        // The private ref is named with a fresh random UUID per call, so a test cannot predict its exact
        // text — resolving it to a fixed default here is what lets every OTHER test assert on real values.
        if (privateRefPattern.test(command)) {
          return FRESH_BASE_SHA;
        }
        throw new Error(`unexpected read: ${command}`);
      },
      writeGit: ({ args }) => {
        calls.push(args);
        return writes(args);
      },
    },
    outLines,
  };
}

describe("rebaseSingleCommitOntoFreshBase — decision logic", () => {
  it("refuses when the checked-out HEAD does not match the PR's GitHub-reported head SHA", () => {
    const { git } = fakeGit({ reads: { "rev-parse HEAD": "9999999999999999999999999999999999999999" } });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).message).toContain("does not match GitHub's reported head SHA");
  });

  it("refuses a merge commit rather than guessing which parent to replay from", () => {
    const { git } = fakeGit({
      reads: {
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA, "4444444444444444444444444444444444444444"],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).message).toContain("merge commit");
  });

  it("refuses when the commit has no parent to resolve", () => {
    const { git } = fakeGit({
      reads: {
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).message).toContain("could not resolve the parent");
  });

  it("refuses when the checked-out branch moved during the base fetch", () => {
    let headReads = 0;
    const { git: baseGit } = fakeGit({
      reads: {
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
      },
    });
    const git: GithubPushDeps = {
      ...baseGit,
      readGit: (input) => {
        if (input.args.join(" ") === "rev-parse HEAD") {
          headReads += 1;
          return headReads === 1 ? HEAD_SHA : "9999999999999999999999999999999999999999";
        }
        return baseGit.readGit(input);
      },
    };
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).message).toContain("moved during the fetch");
  });

  it("performs the fetch, a re-check, the disambiguated rebase, and cleanup in order, on a clean run", () => {
    const { git, calls } = fakeGit({
      reads: {
        [`merge-base ${FRESH_BASE_SHA}^{commit} ${PARENT_SHA}^{commit}`]: PARENT_SHA,
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(true);
    expect(calls[0]?.[0]).toBe("fetch");
    expect(calls[1]).toEqual([
      "rebase",
      "--no-update-refs",
      "--onto",
      `${FRESH_BASE_SHA}^{commit}`,
      `${PARENT_SHA}^{commit}`,
    ]);
    expect(calls[2]?.[0]).toBe("update-ref");
  });

  it("still cleans up the private ref when the rebase itself conflicts", () => {
    const { git, calls } = fakeGit({
      reads: {
        [`merge-base ${FRESH_BASE_SHA}^{commit} ${PARENT_SHA}^{commit}`]: PARENT_SHA,
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
      writes: (args) => (args[0] === "rebase" ? err("CONFLICT in file.ts") : ok(undefined)),
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result).toEqual(
      err(GithubVerbErrors.upstreamRefused({ operation: "rebase", reasons: ["CONFLICT in file.ts"] })),
    );
    expect(calls.at(-1)?.[0]).toBe("update-ref");
  });

  it("surfaces a cleanup failure instead of swallowing it, without changing the rebase's own successful result", () => {
    const { git, outLines } = fakeGit({
      reads: {
        [`merge-base ${FRESH_BASE_SHA}^{commit} ${PARENT_SHA}^{commit}`]: PARENT_SHA,
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
      writes: (args) => (args[0] === "update-ref" ? err("ref lock held") : ok(undefined)),
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(true);
    expect(
      outLines.some((line) => line.includes("could not delete private ref") && line.includes("ref lock held")),
    ).toBe(true);
  });

  it("allows a fetched base that is unrelated to this commit's own parent — the shape an ordinary amend() produces", () => {
    // merge-base fails outright when the two commits share no history at all, matching a real amend.
    const { git } = fakeGit({
      reads: {
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(true);
  });

  it("refuses when the fetched base has gone backward to a strict ancestor of this commit's own parent", () => {
    const { git } = fakeGit({
      reads: {
        // The fetched base (FRESH_BASE_SHA) IS the merge-base of itself and PARENT_SHA — i.e. it is a
        // strict ancestor of PARENT_SHA, the exact shape a base rewind (never an amend) produces.
        [`merge-base ${FRESH_BASE_SHA}^{commit} ${PARENT_SHA}^{commit}`]: FRESH_BASE_SHA,
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).message).toContain("has gone backward to something it already was");
  });

  it("allows a fetched base that exactly equals this commit's own parent — nothing has moved", () => {
    const { git } = fakeGit({
      reads: {
        "rev-list --parents -1 1111111111111111111111111111111111111111^{commit}": revListParentsLine({
          commit: HEAD_SHA,
          parents: [PARENT_SHA],
        }),
        "rev-parse HEAD": HEAD_SHA,
      },
    });
    // Force the fetched base to equal PARENT_SHA by overriding the private-ref resolution.
    const equalGit: GithubPushDeps = {
      ...git,
      readGit: (input) => {
        const command = input.args.join(" ");
        return /^rev-parse refs\/slopweaver\/fetch\/[0-9a-f-]{36}\^\{commit\}$/.test(command)
          ? PARENT_SHA
          : git.readGit(input);
      },
    };
    const result = rebaseSingleCommitOntoFreshBase({
      baseBranch: "main",
      git: equalGit,
      headSha: HEAD_SHA,
      remote: "origin",
      worktreePath: "/repo",
    });
    expect(result.isOk()).toBe(true);
  });
});

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A bare "remote" plus a clone, matching how `stack sync` actually operates against a real GitHub remote. */
function initRemoteAndClone(): { remoteDir: string; workDir: string } {
  const remoteDir = mkdtempSync(join(tmpdir(), "stack-squash-remote-"));
  fixtureDirs.push(remoteDir);
  gitInTemp({ args: ["init", "--bare", "-b", "main"], cwd: remoteDir });
  const workDir = mkdtempSync(join(tmpdir(), "stack-squash-work-"));
  fixtureDirs.push(workDir);
  gitInTemp({ args: ["clone", remoteDir, "."], cwd: workDir });
  gitInTemp({ args: ["config", "user.email", "test@example.invalid"], cwd: workDir });
  gitInTemp({ args: ["config", "user.name", "Test"], cwd: workDir });
  gitInTemp({ args: ["config", "commit.gpgsign", "false"], cwd: workDir });
  return { remoteDir, workDir };
}

const realGit: GithubPushDeps = {
  cwd: () => "",
  doorLedger: memoryDoorLedger().port,
  out: () => {},
  readGit: ({ cwd, args }) => gitInTemp({ args, cwd }),
  writeGit: ({ cwd, args }) => {
    try {
      gitInTemp({ args, cwd });
      return ok(undefined);
    } catch (error: unknown) {
      return err(error instanceof Error ? error.message : String(error));
    }
  },
};

describe(
  "rebaseSingleCommitOntoFreshBase against a real repository — the corruption fix",
  {
    timeout: REAL_GIT_TIMEOUT_MS,
  },
  () => {
    it("preserves both the base's new content and the PR's own change, even after the base's fork-point commit was rewritten with a fully expired reflog", () => {
      const { workDir } = initRemoteAndClone();
      writeFileSync(join(workDir, "shared.txt"), "line1\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "base commit A"], cwd: workDir });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

      gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
      writeFileSync(join(workDir, "feature-only.txt"), "feature-content\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "the one PR commit"], cwd: workDir });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });
      gitInTemp({ args: ["push", "origin", "feature"], cwd: workDir });

      // Rewrite base's commit A itself (amend, matching `stack push`'s own amend()) so its history no
      // longer shares a direct parent/child edge with what `feature` forked from — the exact precondition
      // for the reflog-based corruption this primitive exists to avoid.
      gitInTemp({ args: ["checkout", "main"], cwd: workDir });
      writeFileSync(join(workDir, "shared.txt"), "line1-modified-by-amend\n");
      writeFileSync(join(workDir, "base-new-file.txt"), "base-added-this\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "--amend", "-m", "base commit A (rewritten)"], cwd: workDir });
      gitInTemp({ args: ["push", "-f", "origin", "main"], cwd: workDir });

      // Fully expire the reflog — the adversarial condition that broke `--fork-point`.
      gitInTemp({ args: ["reflog", "expire", "--expire=now", "--all"], cwd: workDir });

      gitInTemp({ args: ["checkout", "feature"], cwd: workDir });
      const result = rebaseSingleCommitOntoFreshBase({
        baseBranch: "main",
        git: realGit,
        headSha,
        remote: "origin",
        worktreePath: workDir,
      });

      expect(result.isOk()).toBe(true);
      const tree = gitInTemp({ args: ["ls-tree", "-r", "--name-only", "HEAD"], cwd: workDir })
        .split("\n")
        .toSorted();
      expect(tree).toEqual(["base-new-file.txt", "feature-only.txt", "shared.txt"]);
      expect(gitInTemp({ args: ["show", "HEAD:shared.txt"], cwd: workDir })).toBe("line1-modified-by-amend");
      expect(gitInTemp({ args: ["show", "HEAD:feature-only.txt"], cwd: workDir })).toBe("feature-content");
      const freshBaseSha = gitInTemp({ args: ["rev-parse", "origin/main"], cwd: workDir });
      expect(gitInTemp({ args: ["rev-parse", "HEAD^"], cwd: workDir })).toBe(freshBaseSha);
      expect(gitInTemp({ args: ["rev-list", "--count", `${freshBaseSha}..HEAD`], cwd: workDir })).toBe("1");
    });

    it("refuses, rather than silently dropping content, when the base is force-pushed back to an ancestor of this commit's own parent", () => {
      const { workDir } = initRemoteAndClone();
      writeFileSync(join(workDir, "base.txt"), "old\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "A"], cwd: workDir });
      const aSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

      // P: a real, later commit on main that changes base.txt — the content a rewind would discard.
      writeFileSync(join(workDir, "base.txt"), "new\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "P"], cwd: workDir });
      gitInTemp({ args: ["push", "origin", "main"], cwd: workDir });

      // H: the one PR commit, forked from P, adding its own file — never touching base.txt itself.
      gitInTemp({ args: ["checkout", "-b", "feature"], cwd: workDir });
      writeFileSync(join(workDir, "feature-only.txt"), "feature-content\n");
      gitInTemp({ args: ["add", "-A"], cwd: workDir });
      gitInTemp({ args: ["commit", "-m", "H"], cwd: workDir });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir });
      gitInTemp({ args: ["push", "origin", "feature"], cwd: workDir });

      // An external actor force-pushes main back to A — the exact live-reproduced scenario this check exists
      // for. `top` (feature) is untouched, so its own head SHA lease would see nothing wrong.
      gitInTemp({ args: ["checkout", "main"], cwd: workDir });
      gitInTemp({ args: ["reset", "--hard", aSha], cwd: workDir });
      gitInTemp({ args: ["push", "-f", "origin", "main"], cwd: workDir });

      gitInTemp({ args: ["checkout", "feature"], cwd: workDir });
      const result = rebaseSingleCommitOntoFreshBase({
        baseBranch: "main",
        git: realGit,
        headSha,
        remote: "origin",
        worktreePath: workDir,
      });

      expect(result.isOk()).toBe(false);
      expect(unwrapErr(result).message).toContain("has gone backward to something it already was");
      // Refused before any rebase: HEAD is exactly the original commit, untouched.
      expect(gitInTemp({ args: ["rev-parse", "HEAD"], cwd: workDir })).toBe(headSha);
    });
  },
);
