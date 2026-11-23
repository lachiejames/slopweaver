/*
 * `planSpawn` choosing a fresh run's tree: which existing worktree it reopens or which conventional path it creates,
 * the branch and base branch it carries, and the host and session name it leaves to the harness.
 */
import { describe, expect, it } from "vitest";

import { planSpawn } from "../../../../cmux/plan.js";
import type { WorktreeInfo } from "../../../../cmux/worktreeList.js";
import { DOC_PATH, REPO_ROOT } from "./harness.js";

describe("planSpawn", () => {
  it("reuses an existing worktree found under a NON-conventional directory name", () => {
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "retrieval-passage-head", path: `${REPO_ROOT}-fleet/passage-head-reserve` },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "retrieval-passage-head",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "passage-head-reserve",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}-fleet/passage-head-reserve`);
    expect(plan.worktreeExists).toBe(true);
  });

  it("leaves the harness to name a handover spawn — its own worktree already makes that name one-per-slug", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.sessionName).toBeUndefined();
    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
  });

  it("reuses the worktree already registered AT the conventional slug path, whatever branch it holds", () => {
    // The exact live failure (`cmux-spawn-existing-worktree-collision`): a parked PR's worktree
    // kept on disk at the slug path, registered and clean, but checked out on `local-15786` — a name no slug
    // guess produces. The branch lookup missed it, the plan said "create", and `git worktree add` died on the
    // directory it should have opened.
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "main", path: REPO_ROOT },
      { branch: "local-15786", path: `${REPO_ROOT}/.claude/worktrees/stack-pr15786-on-pr15837` },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "stack-pr15786-on-pr15837",
      spawnedAt: "2026-08-22T06:15:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees/stack-pr15786-on-pr15837`);
    expect(plan.worktreeExists).toBe(true);
    expect(plan.branch).toBe("local-15786");
  });

  it("prefers the worktree holding the branch over the one at the conventional path when both exist", () => {
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "unrelated", path: `${REPO_ROOT}/.claude/worktrees/a-doc` },
      { branch: "a-branch", path: `${REPO_ROOT}-fleet/elsewhere` },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "a-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}-fleet/elsewhere`);
    expect(plan.branch).toBe("a-branch");
  });

  it("keeps the declared branch when the worktree at the conventional path is a detached HEAD", () => {
    const worktrees: readonly WorktreeInfo[] = [{ branch: null, path: `${REPO_ROOT}/.claude/worktrees/a-doc` }];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "a-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.worktreeExists).toBe(true);
    expect(plan.branch).toBe("a-branch");
  });

  it("always plans a handover spawn for the claude-code host — a handover spawn has never been Codex-driven", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "a-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.host).toBe("claude-code");
  });

  it("falls back to the conventional <repo>/.claude/worktrees.noindex/<slug> path when no worktree holds the branch", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "a-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
    expect(plan.worktreeExists).toBe(false);
  });

  it("uses the slug as the branch when the doc declares none", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.branch).toBe("a-doc");
  });

  it("carries the doc's declared baseBranch through, unchanged", () => {
    const plan = planSpawn({
      baseBranch: "stacked-on-me",
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.baseBranch).toBe("stacked-on-me");
  });

  it("leaves baseBranch undefined when the doc declares none", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees: [],
    });

    expect(plan.baseBranch).toBeUndefined();
  });

  it("also matches a worktree under the worktree-<slug> convention", () => {
    const worktrees: readonly WorktreeInfo[] = [{ branch: "worktree-a-doc", path: `${REPO_ROOT}-fleet/a-doc` }];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [],
      slug: "a-doc",
      spawnedAt: "2026-08-17T00:00:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.worktreeExists).toBe(true);
  });
});
