/**
 * Settling the reclaim trash without deleting it: what `session close-done` does each sweep, leaving every delete
 * to `worktree prune --apply`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settleReclaimTrash } from "../../../worktree/reclaimTrash.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reclaim-settle-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("settleReclaimTrash", () => {
  it("deletes no batch, counting every one as waiting for the prune", () => {
    const root = join(dir, "trash");
    for (const batch of ["a-1", "b-2"]) {
      mkdirSync(join(root, batch, "0"), { recursive: true });
      writeFileSync(join(root, batch, "0", "f.js"), "x\n");
    }

    expect(settleReclaimTrash({ roots: [root] })).toEqual({ restored: 0, waiting: 2 });
    expect(readdirSync(root)).toEqual(["a-1", "b-2"]);
  });

  it("still puts an orphaned pending batch back into the tree git kept", () => {
    const root = join(dir, "trash");
    const worktree = join(dir, "seat");
    const batch = join(root, "seat-1");
    mkdirSync(join(worktree, ".git"), { recursive: true });
    mkdirSync(join(batch, "0", "pkg"), { recursive: true });
    writeFileSync(join(batch, "0", "pkg", "index.js"), "module.exports = 1;\n");
    const moves = [{ from: join(worktree, "node_modules"), to: join(batch, "0") }];
    // A pid no process holds: darwin's ceiling is 99998, Linux's 4194304.
    writeFileSync(join(batch, "pending.json"), JSON.stringify({ moves, pid: 99_999_999, worktree }));

    expect(settleReclaimTrash({ roots: [root] })).toEqual({ restored: 1, waiting: 0 });
    expect(existsSync(join(worktree, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  });

  it("reads an absent root as an empty one", () => {
    expect(settleReclaimTrash({ roots: [join(dir, "never-made")] })).toEqual({ restored: 0, waiting: 0 });
  });
});
