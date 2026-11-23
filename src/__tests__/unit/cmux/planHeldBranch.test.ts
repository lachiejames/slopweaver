/**
 * {@link planSpawn} over a worktree a rebase or bisect holds a branch in — beside `./plan/spawnWorktree.test.ts`.
 * MEASURED, on a spawn the fleet refused: a landing row declared the branch
 * a finished run's tree held mid-rebase; the plan said "create" and `git worktree add` refused it as "already used
 * by worktree".
 */
import { describe, expect, it } from "vitest";

import { planSpawn } from "../../../cmux/plan.js";
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";

const REPO_ROOT = "/repo/slopweaver";
const HELD_TREE = `${REPO_ROOT}/.claude/worktrees.noindex/backup-ssd`;

describe("planSpawn over a held branch", () => {
  it("reuses a detached worktree whose rebase holds the declared branch, and reports that branch", () => {
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "main", path: REPO_ROOT },
      { branch: null, heldBranches: ["backup-ssd"], path: HELD_TREE },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "backup-ssd",
      docPath: `${REPO_ROOT}/.claude/worktrees/land-backup-ssd/handover.md`,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "land-backup-ssd",
      spawnedAt: "2026-11-08T00:47:20.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(HELD_TREE);
    expect(plan.worktreeExists).toBe(true);
    expect(plan.branch).toBe("backup-ssd");
  });

  // A rebase of another branch started mid-bisect holds both, the rebase's listed first.
  it("reports the declared branch a bisect holds when a rebase in the same tree holds another first", () => {
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "main", path: REPO_ROOT },
      { branch: null, heldBranches: ["other", "backup-ssd"], path: HELD_TREE },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "backup-ssd",
      docPath: `${REPO_ROOT}/.claude/worktrees/land-backup-ssd/handover.md`,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "land-backup-ssd",
      spawnedAt: "2026-11-08T00:47:20.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(HELD_TREE);
    expect(plan.worktreeExists).toBe(true);
    expect(plan.branch).toBe("backup-ssd");
  });
});
