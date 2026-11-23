/**
 * Real-git round-trip for {@link activityNowMs}, the stamp `worktree prune --apply` re-reads right before it drops a
 * tree's `node_modules` or removes a tree under an open pull request, and for the stamp {@link scanWorktree} dates a
 * branch by.
 *
 * Two shapes defeated the earlier stamp, both measured by review pass r2 of the disk-full run: a commit leaves the
 * worktree root's mtime alone, so a DETACHED tree dated by its directory alone read cold seconds after a commit; and
 * `git log -1 <branch>` exits 128 "ambiguous argument" when a top-level path shares the branch's name, which the old
 * stamp swallowed by falling back to the directory. Only a real repository produces either.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activityNowMs, scanWorktree } from "../../../worktree/pruneScan.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Three days before now, in seconds — far past any `--older-than` a prune is run with. */
const OLD_SECONDS = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;

/** A fresh temp git repo on `branch` with one commit carrying `src/a.ts`, its root's mtime then set three days back. */
function repoWithOldRoot({ branch, detach }: { branch: string; detach: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "activity-"));
  fixtureDirs.push(dir);
  const git = (...args: string[]): void => {
    gitInTemp({ args, cwd: dir });
  };
  git("init", "-b", branch);
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export {};\n");
  git("add", "src/a.ts");
  git("commit", "-m", "seed");
  if (detach) {
    git("checkout", "--detach");
  }
  utimesSync(dir, OLD_SECONDS, OLD_SECONDS);
  return dir;
}

/** The commit HEAD has out, in epoch ms, as git itself reports it. */
function headCommitMs({ dir }: { dir: string }): number {
  return Number(gitInTemp({ args: ["log", "-1", "--format=%ct"], cwd: dir })) * 1000;
}

describe(
  "activityNowMs",
  () => {
    it("dates a DETACHED tree by its commit, which leaves the root's mtime three days old", () => {
      const dir = repoWithOldRoot({ branch: "main", detach: true });
      expect(activityNowMs({ path: dir })).toBe(headCommitMs({ dir }));
    });

    it("lets the scan date a branch named like a top-level directory, which git calls ambiguous without --", () => {
      const dir = repoWithOldRoot({ branch: "src", detach: false });
      const facts = scanWorktree({
        liveRefs: [],
        mainCheckout: join(dir, "not-the-main-checkout"),
        openPullRequests: [],
        repoRoot: dir,
        runsDir: join(dir, "runs"),
        trunk: "origin/main",
        worktree: { branch: "src", path: dir },
      });
      expect(facts.lastActivityMs).toBe(headCommitMs({ dir }));
    });

    it("answers null for a directory git cannot read, never the directory's mtime alone", () => {
      const dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
      fixtureDirs.push(dir);
      expect(activityNowMs({ path: dir })).toBe(null);
    });
  },
  REAL_GIT_TIMEOUT_MS,
);
