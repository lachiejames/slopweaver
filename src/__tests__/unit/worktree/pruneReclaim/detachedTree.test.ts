/*
 * A detached tree goes only while a live remote branch carries its HEAD: a stale tracking ref, a force-pushed tip or
 * an unreachable remote each keep it, and a removed tree's HEAD stays pinned under a local ref.
 */
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyVerdict } from "../../../../worktree/pruneApply.js";
import type { PruneVerdict } from "../../../../worktree/pruneClassify.js";
import { realGit } from "../../../../worktree/pruneGit.js";
import { changedSinceScan, PINNED_DETACHED } from "../../../../worktree/pruneRecheck.js";
import { remoteStillCarries } from "../../../../worktree/pruneRemote.js";
import { detachedHead } from "../../../../worktree/pruneScan.js";
import { gitInTemp, REAL_GIT_SUITE, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import { buildSeedRepo, COMMIT, dir, useReclaimDir, verdictFor } from "./harness.js";

useReclaimDir();

describe(
  "a detached tree goes only while a LIVE remote branch carries its HEAD (the r2 Codex review)",
  REAL_GIT_SUITE,
  () => {
    /**
     * The destination and the clone every case copies, built once: `feature`'s commit pushed and fetched, the clone back
     * on `main` with no local `feature` branch. Neither `.git` holds an absolute path but the clone's remote url, which
     * each case points at its own copied destination; the linked worktree, whose admin files do, is each case's own.
     */
    let seed = { featureSha: "", origin: "", repo: "" };

    beforeAll(() => {
      const origin = mkdtempSync(join(tmpdir(), "detached-seed-origin-"));
      gitInTemp({ args: ["init", "-q", "--bare", "-b", "main"], cwd: origin });
      const repo = mkdtempSync(join(tmpdir(), "detached-seed-repo-"));
      buildSeedRepo({ repo });
      gitInTemp({ args: ["remote", "add", "origin", origin], cwd: repo });
      gitInTemp({ args: ["push", "-q", "origin", "main"], cwd: repo });
      gitInTemp({ args: ["switch", "-q", "-c", "feature"], cwd: repo });
      writeFileSync(join(repo, "work.txt"), "only on feature\n");
      gitInTemp({ args: ["add", "-A"], cwd: repo });
      gitInTemp({ args: [...COMMIT, "work"], cwd: repo });
      gitInTemp({ args: ["push", "-q", "origin", "feature"], cwd: repo });
      const featureSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: repo });
      gitInTemp({ args: ["switch", "-q", "main"], cwd: repo });
      gitInTemp({ args: ["branch", "-q", "-D", "feature"], cwd: repo });
      seed = { featureSha, origin, repo };
    }, REAL_GIT_TIMEOUT_MS);

    afterAll(() => {
      rmSync(seed.repo, { force: true, recursive: true });
      rmSync(seed.origin, { force: true, recursive: true });
    });

    /** A clone whose `feature` commit is pushed and fetched, checked out detached in a linked worktree. */
    const seedDetached = (): { origin: string; repo: string; verdict: PruneVerdict } => {
      const origin = join(dir, "origin.git");
      cpSync(seed.origin, origin, { recursive: true });
      const repo = join(dir, "repo");
      cpSync(seed.repo, repo, { recursive: true });
      gitInTemp({ args: ["remote", "set-url", "origin", origin], cwd: repo });
      const path = join(dir, "detached");
      gitInTemp({ args: ["worktree", "add", "-q", "--detach", path, seed.featureSha], cwd: repo });
      const verdict: PruneVerdict = { ...verdictFor({ path }), branch: null, cls: "detached", dropsDeps: false };
      return { origin, repo, verdict };
    };

    it("removes it while the remote still has the branch", () => {
      const { repo, verdict } = seedDetached();
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(remoteStillCarries({ git: realGit, headSha, repoRoot: repo })).toBe(true);
      const outcome = applyVerdict({ repoRoot: repo, verdict });
      expect(outcome.treeRemoved).toBe(true);
      expect(existsSync(verdict.path)).toBe(false);
    });

    it("keeps its HEAD under a local ref, so the remote deleting the branch afterwards loses nothing (the p3 Codex pass)", () => {
      const { origin, repo, verdict } = seedDetached();
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(true);
      gitInTemp({ args: ["branch", "-q", "-D", "feature"], cwd: origin });
      gitInTemp({ args: ["fetch", "-q", "--prune", "origin"], cwd: repo });
      expect(gitInTemp({ args: ["branch", "--remotes", "--contains", headSha], cwd: repo })).toBe("");
      expect(gitInTemp({ args: ["for-each-ref", "--contains", headSha, "--format=%(refname)"], cwd: repo })).toBe(
        `${PINNED_DETACHED}${headSha}`,
      );
    });

    it("keeps a tree whose HEAD is no longer the commit pinned for it", () => {
      const { verdict } = seedDetached();

      expect(changedSinceScan({ pinnedHead: "0".repeat(40), verdict })).toBe(
        "its HEAD moved off the commit kept for it, or could not be read, since the pin — kept",
      );
      expect(changedSinceScan({ verdict })).toBe(null);
    });

    it("keeps it when the remote deleted the branch and only a stale tracking ref still names it", () => {
      const { origin, repo, verdict } = seedDetached();
      gitInTemp({ args: ["branch", "-q", "-D", "feature"], cwd: origin });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(gitInTemp({ args: ["branch", "--remotes", "--contains", headSha], cwd: repo }).trim()).toBe(
        "origin/feature",
      );
      expect(remoteStillCarries({ git: realGit, headSha, repoRoot: repo })).toBe(false);
      const outcome = applyVerdict({ repoRoot: repo, verdict });
      expect(outcome.treeRemoved).toBe(false);
      expect(gitInTemp({ args: ["for-each-ref", PINNED_DETACHED], cwd: repo })).toBe("");
      expect(outcome.declined).toBe(
        "no live remote branch carries its HEAD — it moved after the scan read it, or the branch is gone " +
          "from the remote, so nothing was removed and the next run classifies it afresh",
      );
      expect(existsSync(join(verdict.path, "work.txt"))).toBe(true);
    });

    it("keeps it when the remote branch was force-pushed to a tip that no longer contains it", () => {
      const { origin, repo, verdict } = seedDetached();
      const mainSha = gitInTemp({ args: ["rev-parse", "main"], cwd: repo });
      gitInTemp({ args: ["update-ref", "refs/heads/feature", mainSha], cwd: origin });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(remoteStillCarries({ git: realGit, headSha, repoRoot: repo })).toBe(false);
    });

    it("keeps it when only ANOTHER remote carries its HEAD, because origin is the one backup prune trusts", () => {
      const { origin, repo, verdict } = seedDetached();
      // The archive remote holds the feature branch; origin no longer does, so origin's copy is gone everywhere.
      const archive = join(dir, "archive.git");
      cpSync(origin, archive, { recursive: true });
      gitInTemp({ args: ["remote", "add", "archive", archive], cwd: repo });
      gitInTemp({ args: ["fetch", "-q", "archive"], cwd: repo });
      gitInTemp({ args: ["branch", "-q", "-D", "feature"], cwd: origin });
      gitInTemp({ args: ["fetch", "-q", "--prune", "origin"], cwd: repo });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(gitInTemp({ args: ["branch", "--remotes", "--contains", headSha], cwd: repo }).trim()).toBe(
        "archive/feature",
      );
      expect(remoteStillCarries({ git: realGit, headSha, repoRoot: repo })).toBe(false);
      expect(detachedHead({ path: verdict.path, repoRoot: repo })).toEqual({ headOnRemoteRef: null, headSha });
      expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(false);
      expect(existsSync(join(verdict.path, "work.txt"))).toBe(true);
    });

    it("keeps it when the remote cannot be reached at all", () => {
      const { origin, repo, verdict } = seedDetached();
      rmSync(origin, { force: true, recursive: true });
      const headSha = gitInTemp({ args: ["rev-parse", "HEAD"], cwd: verdict.path });

      expect(remoteStillCarries({ git: realGit, headSha, repoRoot: repo })).toBe(false);
      expect(applyVerdict({ repoRoot: repo, verdict }).treeRemoved).toBe(false);
    });
  },
);
