/**
 * Which existing worktree a spawn reopens. The whole plan through `planSpawn` is `./plan/spawnWorktree.test.ts`'s
 * and `./plan/spawnReseat.test.ts`'s; this pins the search it delegates, parked and not.
 */
import { describe, expect, it } from "vitest";

import { existingSpawnTree, findExistingWorktree } from "../../../cmux/spawnTree.js";
import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import type { ParkedEvent } from "../../../handover/parkedEvent.js";

const MAIN: WorktreeInfo = { branch: "feat/x", path: "/repo" };
const TREE: WorktreeInfo = { branch: "feat/y", path: "/repo/.claude/worktrees.noindex/y" };
const AT_PATH: WorktreeInfo = { branch: "local-15786", path: "/repo/.claude/worktrees.noindex/x" };

const PARKED: ParkedEvent = {
  atIso: "2026-10-04T04:00:00.000Z",
  branch: "feat/y",
  kind: "parked",
  question: "Which slide order?",
  screenTail: "❯ ",
  sessionId: "session-a",
  workspaceRef: "workspace:9",
  worktree: TREE.path,
};

const CONVENTIONAL = "/repo/.claude/worktrees.noindex/x";

describe("findExistingWorktree", () => {
  it("prefers a tree holding a candidate branch", () => {
    expect(
      findExistingWorktree({ candidates: ["feat/x"], conventionalPath: CONVENTIONAL, worktrees: [MAIN, AT_PATH] }),
    ).toEqual(MAIN);
  });

  it("falls to the tree registered at the conventional path", () => {
    expect(
      findExistingWorktree({ candidates: ["feat/z"], conventionalPath: CONVENTIONAL, worktrees: [MAIN, AT_PATH] }),
    ).toEqual(AT_PATH);
  });
});

describe("existingSpawnTree", () => {
  it("searches every tree, the main checkout included, for a run never parked", () => {
    const found = existingSpawnTree({
      candidates: ["feat/x"],
      conventionalPath: CONVENTIONAL,
      parked: undefined,
      repoRoot: "/repo",
      worktrees: [MAIN, TREE],
    });

    expect(found).toEqual(MAIN);
  });

  it("reopens the parked tree ahead of a declared branch held elsewhere", () => {
    const found = existingSpawnTree({
      candidates: ["feat/x"],
      conventionalPath: CONVENTIONAL,
      parked: PARKED,
      repoRoot: "/repo",
      worktrees: [MAIN, TREE],
    });

    expect(found).toEqual(TREE);
  });

  it("never answers with the main checkout once the parked tree is gone", () => {
    const found = existingSpawnTree({
      candidates: ["feat/x"],
      conventionalPath: "/repo/.claude/worktrees.noindex/none",
      parked: { ...PARKED, branch: "feat/gone", worktree: "/gone" },
      repoRoot: "/repo",
      worktrees: [MAIN],
    });

    expect(found).toBe(undefined);
  });
});
