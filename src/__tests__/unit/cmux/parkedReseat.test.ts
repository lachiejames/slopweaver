/**
 * Which tree a parked seat's reseat reopens. The whole reseat through `planSpawn` is `./plan/spawnReseat.test.ts`'s;
 * this pins the two lookups it is built from.
 */
import { describe, expect, it } from "vitest";

import { fleetWorktrees, parkedWorktreeOf } from "../../../cmux/parkedReseat.js";
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";

const MAIN: WorktreeInfo = { branch: "main", path: "/repo" };
const TREE: WorktreeInfo = { branch: "feat/x", path: "/repo/.claude/worktrees.noindex/x" };
const OTHER: WorktreeInfo = { branch: "feat/y", path: "/repo/.claude/worktrees.noindex/y" };

const parked = ({ worktree, branch }: { worktree: string; branch: string }): ParkedEvent => ({
  atIso: "2026-10-04T04:00:00.000Z",
  branch,
  kind: "parked",
  question: "Which slide order?",
  screenTail: "❯ ",
  sessionId: "session-a",
  workspaceRef: "workspace:9",
  worktree,
});

describe("fleetWorktrees", () => {
  it("drops git's first-listed main and the doc's repo root", () => {
    expect(fleetWorktrees({ repoRoot: "/repo", worktrees: [MAIN, TREE, OTHER] })).toEqual([TREE, OTHER]);
  });
});

describe("parkedWorktreeOf", () => {
  it("finds the deepest tree holding a subdirectory the seat stood in", () => {
    const found = parkedWorktreeOf({
      parked: parked({ branch: "feat/y", worktree: `${TREE.path}/apps/web` }),
      worktrees: [MAIN, TREE, OTHER],
    });

    expect(found).toEqual(TREE);
  });

  it("falls to the journalled branch when no tree holds the path", () => {
    const found = parkedWorktreeOf({
      parked: parked({ branch: "feat/y", worktree: "/gone" }),
      worktrees: [TREE, OTHER],
    });

    expect(found).toEqual(OTHER);
  });

  it("finds nothing when neither key matches", () => {
    expect(parkedWorktreeOf({ parked: parked({ branch: "feat/z", worktree: "/gone" }), worktrees: [TREE] })).toBe(
      undefined,
    );
  });
});
