/**
 * `cmux spawn`'s foreign-tree gate: the two ways it lets a spawn through before reading any journal. The verdict
 * itself is `../../../cmux/treeOccupancy.test.ts`'s, and the scan `../../../cmux/treeHolderScan.test.ts`'s.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foreignTreeRefusal } from "../../../../../cli/commands/cmux/spawnTreeGate.js";

const TREE = "/repo/.claude/worktrees.noindex/seat-a";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tree-gate-"));
  mkdirSync(join(home, "runs"));
  // Another row's open run in the very tree, so only the early returns can explain an undefined.
  writeFileSync(
    join(home, "runs", "other-row.jsonl"),
    `${JSON.stringify({ atIso: "2026-01-01T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" })}\n${JSON.stringify(
      {
        atIso: "2026-01-01T00:00:01.000Z",
        host: "claude-code",
        kind: "launched",
        pid: 1,
        sessionId: "s",
        worktree: TREE,
      },
    )}\n`,
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("foreignTreeRefusal", () => {
  it("asks nothing of a tree the spawn creates, which nothing can hold", () => {
    expect(
      foreignTreeRefusal({
        env: {},
        home,
        plan: { cwd: TREE, repoRoot: "/repo", slug: "this-row", worktreeExists: false },
      }),
    ).toBeUndefined();
  });

  it("lets the spawn through when the hatch is set", () => {
    expect(
      foreignTreeRefusal({
        env: { SLOPWEAVER_ALLOW_FOREIGN_WORKTREE_HOLDER: "1" },
        home,
        plan: { cwd: TREE, repoRoot: "/repo", slug: "this-row", worktreeExists: true },
      }),
    ).toBeUndefined();
  });
});
