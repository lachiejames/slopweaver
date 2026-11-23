/**
 * The submit transport, proved against real git and a real (throwaway, local) remote.
 *
 * The planner's decisions are pinned in `stackSubmitCore.test.ts`. What this file proves is the half no pure
 * test can: that the push carries an exact lease, that the read-back catches a remote which did not end up
 * holding what was sent, and that a failure part way through leaves the suffix untouched rather than
 * continuing. Every git call goes through `gitInTemp`, and the code under test is the shipped one.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SubmitPlan } from "../../../../../cli/commands/github/stackSubmitCore.js";
import { sendStackSubmit } from "../../../../../cli/commands/github/stackSubmitSend.js";
import type { StackVerbDeps } from "../../../../../cli/commands/github/stackVerbDeps.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Real git, through the sanctioned door, in the shape the submit transport takes. */
function realGitDeps(): StackVerbDeps {
  return {
    git: {
      cwd: () => process.cwd(),
      doorLedger: memoryDoorLedger().port,
      out: () => undefined,
      readGit: ({ args, cwd }: { cwd: string; args: readonly string[] }) => gitInTemp({ args, cwd }),
      writeGit: ({ args, cwd }: { cwd: string; args: readonly string[] }): Result<void, string> => {
        try {
          gitInTemp({ args, cwd });
          return ok(undefined);
        } catch (error: unknown) {
          return err(error instanceof Error ? error.message : String(error));
        }
      },
    },
    makeApi: () => {
      throw new Error("this test never reaches the GitHub API");
    },
    now: () => new Date("2026-09-09T22:00:00.000Z"),
    out: () => undefined,
    token: () => undefined,
  };
}

/** Commit one file and answer the new commit. */
function commit({ body, message, name, root }: { body: string; message: string; name: string; root: string }): string {
  writeFileSync(join(root, name), body);
  gitInTemp({ args: ["add", name], cwd: root });
  gitInTemp({ args: ["commit", "-m", message], cwd: root });
  return gitInTemp({ args: ["rev-parse", "HEAD"], cwd: root });
}

/** A working clone with a throwaway bare remote called `origin`, and two branches already on it. */
function repoWithRemote(): {
  readonly root: string;
  readonly heads: ReadonlyMap<string, string>;
  readonly next: ReadonlyMap<string, string>;
} {
  const parent = mkdtempSync(join(tmpdir(), "slopweaver-submit-"));
  roots.push(parent);
  const bare = join(parent, "remote.git");
  const root = join(parent, "work");
  gitInTemp({ args: ["init", "--bare", "--initial-branch", "main", bare], cwd: parent });
  gitInTemp({ args: ["init", "--initial-branch", "main", root], cwd: parent });
  gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: root });
  gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: root });
  gitInTemp({ args: ["remote", "add", "origin", bare], cwd: root });
  commit({ body: "base\n", message: "base", name: "base.txt", root });
  gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: root });

  const heads = new Map<string, string>();
  const next = new Map<string, string>();
  for (const branch of ["one", "two"]) {
    gitInTemp({ args: ["checkout", "-q", "-B", branch, "main"], cwd: root });
    heads.set(branch, commit({ body: `${branch}\n`, message: branch, name: `${branch}.txt`, root }));
    gitInTemp({ args: ["push", "-q", "origin", branch], cwd: root });
    // What a restack would have staged: the same change, replayed, so it is a different commit.
    next.set(
      branch,
      commit({ body: `${branch} again\n`, message: `${branch}, restacked`, name: `${branch}.txt`, root }),
    );
  }
  gitInTemp({ args: ["checkout", "-q", "main"], cwd: root });
  return { heads, next, root };
}

/** What the remote holds for one branch. */
function onRemote({ branch, root }: { branch: string; root: string }): string {
  return gitInTemp({ args: ["ls-remote", "origin", `refs/heads/${branch}`], cwd: root }).split(/\s+/)[0]!;
}

describe("sendStackSubmit against real git", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("pushes every branch in order and confirms each one on the remote", () => {
    const { heads, next, root } = repoWithRemote();
    const plan: SubmitPlan = {
      pushes: [
        { branch: "one", expectedRemoteSha: heads.get("one")!, pullRequestNumber: 1, toSha: next.get("one")! },
        { branch: "two", expectedRemoteSha: heads.get("two")!, pullRequestNumber: 2, toSha: next.get("two")! },
      ],
      waived: [],
    };

    const outcomes = sendStackSubmit({ deps: realGitDeps(), plan, remote: "origin", repoRoot: root });

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["pushed", "pushed"]);
    expect(onRemote({ branch: "one", root })).toBe(next.get("one"));
    expect(onRemote({ branch: "two", root })).toBe(next.get("two"));
  });

  it("refuses a branch whose lease no longer holds, and never attempts the one after it", () => {
    const { heads, next, root } = repoWithRemote();
    const plan: SubmitPlan = {
      pushes: [
        // The lease names a commit the remote does not hold, so git itself refuses this push.
        { branch: "one", expectedRemoteSha: next.get("two")!, pullRequestNumber: 1, toSha: next.get("one")! },
        { branch: "two", expectedRemoteSha: heads.get("two")!, pullRequestNumber: 2, toSha: next.get("two")! },
      ],
      waived: [],
    };

    const outcomes = sendStackSubmit({ deps: realGitDeps(), plan, remote: "origin", repoRoot: root });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.kind).toBe("failed");
    expect(onRemote({ branch: "one", root })).toBe(heads.get("one"));
    expect(onRemote({ branch: "two", root })).toBe(heads.get("two"));
  });

  it("leaves the earlier branches on the remote when a later one fails, which is what a partial push IS", () => {
    const { heads, next, root } = repoWithRemote();
    const plan: SubmitPlan = {
      pushes: [
        { branch: "one", expectedRemoteSha: heads.get("one")!, pullRequestNumber: 1, toSha: next.get("one")! },
        { branch: "two", expectedRemoteSha: next.get("one")!, pullRequestNumber: 2, toSha: next.get("two")! },
      ],
      waived: [],
    };

    const outcomes = sendStackSubmit({ deps: realGitDeps(), plan, remote: "origin", repoRoot: root });

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["pushed", "failed"]);
    expect(onRemote({ branch: "one", root })).toBe(next.get("one"));
    expect(onRemote({ branch: "two", root })).toBe(heads.get("two"));
  });

  it("pushes nothing at all for an empty plan", () => {
    const { heads, root } = repoWithRemote();

    const outcomes = sendStackSubmit({
      deps: realGitDeps(),
      plan: { pushes: [], waived: [] },
      remote: "origin",
      repoRoot: root,
    });

    expect(outcomes).toEqual([]);
    expect(onRemote({ branch: "one", root })).toBe(heads.get("one"));
  });
});
