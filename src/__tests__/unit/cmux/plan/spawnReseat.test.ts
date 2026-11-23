/*
 * `planSpawn` reseating a parked run: which worktree, and which branch, a run whose seat was parked is reopened in —
 * never the main checkout, however the parked tree, its branch or main's path is spelled.
 */
import { describe, expect, it } from "vitest";

import { planSpawn } from "../../../../cmux/plan.js";
import type { WorktreeInfo } from "../../../../cmux/worktreeList.js";
import { PARK_NO_BRANCH } from "../../../../handover/parkedEvent.js";
import { DOC_PATH, REPO_ROOT } from "./harness.js";

describe("planSpawn", () => {
  it("reseats a parked run into the worktree its parked seat was closed on, over the doc's declared branch", () => {
    const worktrees: readonly WorktreeInfo[] = [
      { branch: "declared-branch", path: `${REPO_ROOT}-fleet/declared` },
      { branch: "the-branch-it-parked-on", path: `${REPO_ROOT}-fleet/parked-seat` },
    ];

    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "declared-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: [
        { atIso: "2026-10-04T01:00:00.000Z", branch: "the-branch-it-parked-on", docHash: "h", kind: "started" },
        { atIso: "2026-10-04T02:00:00.000Z", kind: "question", question: "Which label?" },
        {
          atIso: "2026-10-04T03:00:00.000Z",
          branch: "the-branch-it-parked-on",
          kind: "parked",
          question: "Which label?",
          screenTail: "❯ ",
          sessionId: "s-1",
          workspaceRef: "workspace:238",
          worktree: `${REPO_ROOT}-fleet/parked-seat`,
        },
      ],
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees,
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}-fleet/parked-seat`);
    expect(plan.branch).toBe("the-branch-it-parked-on");
  });

  /** A run that parked a seat standing in `worktree`, while its cycle opened on `run-branch`. */
  function parkedRunEvents({ worktree }: { worktree: string }): Parameters<typeof planSpawn>[0]["runEvents"] {
    return [
      { atIso: "2026-10-04T01:00:00.000Z", branch: "run-branch", docHash: "h", kind: "started" },
      {
        atIso: "2026-10-04T03:00:00.000Z",
        branch: "run-branch",
        kind: "parked",
        question: "Which label?",
        screenTail: "❯ ",
        sessionId: "s-1",
        workspaceRef: "workspace:9",
        worktree,
      },
    ];
  }

  //a seat named with --workspace stood in a tree on another branch, and the branch lookup
  // reopened the writer's tree instead of the one the seat was closed in.
  it("reseats into the journalled worktree PATH when the parked seat stood on another branch than the run's", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: `${REPO_ROOT}-fleet/foreign` }),
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [
        { branch: "main", path: REPO_ROOT },
        { branch: "run-branch", path: `${REPO_ROOT}-fleet/writer` },
        { branch: "foreign-branch", path: `${REPO_ROOT}-fleet/foreign` },
      ],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}-fleet/foreign`);
    expect(plan.branch).toBe("foreign-branch");
  });

  //a seat opened BENEATH a foreign tree journals the subdirectory, which no worktree root
  // equals, and the branch fallback reopened the writer's tree.
  it("reseats into the deepest worktree holding a journalled subdirectory, not the main checkout above it", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: `${REPO_ROOT}/.claude/worktrees.noindex/foreign/apps/web` }),
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [
        { branch: "main", path: REPO_ROOT },
        { branch: "run-branch", path: `${REPO_ROOT}/.claude/worktrees.noindex/writer` },
        { branch: "foreign-branch", path: `${REPO_ROOT}/.claude/worktrees.noindex/foreign` },
      ],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/foreign`);
    expect(plan.branch).toBe("foreign-branch");
  });

  //a run parked on the branch the main checkout holds reopened main by branch.
  it("never reseats into the main checkout by branch either, when the parked branch is the one main holds", () => {
    const events = parkedRunEvents({ worktree: REPO_ROOT }).map((event) =>
      event.kind === "parked" ? { ...event, branch: "main" } : event,
    );
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: events,
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [{ branch: "main", path: REPO_ROOT }],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
    expect(plan.worktreeExists).toBe(false);
    expect(plan.branch).toBe("a-doc");
  });

  //close-done keeps no prune hold on a parked tree, so the reseat must rebuild it from the
  // branch the checkpoint recorded — not the doc's declaration or the slug, which may name another branch.
  it("rebuilds a pruned parked tree on the branch the checkpoint recorded", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "declared-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: `${REPO_ROOT}-fleet/pruned` }),
      slug: "a-doc",
      spawnedAt: "2026-10-10T04:00:00.000Z",
      template: "code",
      worktrees: [{ branch: "main", path: REPO_ROOT }],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
    expect(plan.worktreeExists).toBe(false);
    expect(plan.branch).toBe("run-branch");
  });

  it("never hands git the no-branch sentence when the checkpoint recorded none", () => {
    const events = parkedRunEvents({ worktree: `${REPO_ROOT}-fleet/pruned` }).map((event) =>
      event.kind === "parked" ? { ...event, branch: PARK_NO_BRANCH } : event,
    );
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: events,
      slug: "a-doc",
      spawnedAt: "2026-10-10T04:00:00.000Z",
      template: "code",
      worktrees: [{ branch: "main", path: REPO_ROOT }],
    });

    expect(plan.branch).toBe("a-doc");
  });

  //with the parked tree gone, the generic fallback found main by the doc's declared branch.
  it("never reseats into the main checkout by the doc's declared branch once the parked tree is gone", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: "declared-branch",
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: `${REPO_ROOT}-fleet/parked-seat` }),
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [{ branch: "declared-branch", path: REPO_ROOT }],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
    expect(plan.worktreeExists).toBe(false);
  });

  //a doc whose `repo:` is a symlink spelled main differently from git's physical path.
  it("never reseats into git's main worktree when the doc names the main checkout through another path", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: "/physical/repo" }).map((event) =>
        event.kind === "parked" ? { ...event, branch: "main" } : event,
      ),
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [{ branch: "main", path: "/physical/repo" }],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}/.claude/worktrees.noindex/a-doc`);
    expect(plan.worktreeExists).toBe(false);
  });

  it("never reseats into the main checkout a seat was parked in, and falls back to the run's branch", () => {
    const plan = planSpawn({
      baseBranch: undefined,
      declaredBranch: undefined,
      docPath: DOC_PATH,
      repoRoot: REPO_ROOT,
      runEvents: parkedRunEvents({ worktree: REPO_ROOT }),
      slug: "a-doc",
      spawnedAt: "2026-10-04T04:00:00.000Z",
      template: "code",
      worktrees: [
        { branch: "main", path: REPO_ROOT },
        { branch: "run-branch", path: `${REPO_ROOT}-fleet/writer` },
      ],
    });

    expect(plan.cwd).toBe(`${REPO_ROOT}-fleet/writer`);
    expect(plan.branch).toBe("run-branch");
  });
});
