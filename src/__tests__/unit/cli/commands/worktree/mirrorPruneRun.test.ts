import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type MirrorPass,
  pruneMirrors,
  renderMirrorPass,
} from "../../../../../cli/commands/worktree/mirrorPruneRun.js";
import { worktreePathKey } from "../../../../../worktree/location.js";
import { freeMirrorRoot } from "../../../../../worktree/pluginMirrors.js";
import { FROZEN_CLOCK, QUIET_FSEVENTSD } from "../../../worktree/reclaimTrashFixtures.js";

/** Every live register read whole. */
const READ_WHOLE = { cwds: false, ledger: false, openHeads: false, workspaces: null };

describe("pruneMirrors", () => {
  let dir = "";

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("frees only the gone, unheld worktree's mirror, and keeps every other root with its reason", () => {
    dir = mkdtempSync(join(tmpdir(), "mirror-pass-"));
    const repo = join(dir, "repo");
    const home = join(repo, ".claude", "worktrees.noindex");
    const byRoot = join(dir, "data", "slopweaver-inline", "mirror", "by-root");
    const mirrorOf = ({ key }: { key: string }): string => {
      const slot = join(byRoot, key, ".slot-a");
      mkdirSync(slot, { recursive: true });
      writeFileSync(join(slot, "hook.sh"), "x");
      return slot;
    };
    mkdirSync(join(home, "standing"), { recursive: true });
    mkdirSync(join(home, "aliased"), { recursive: true });
    const gone = mirrorOf({ key: join(home, "gone") });
    const standing = mirrorOf({ key: join(home, "standing") });
    const aliased = mirrorOf({ key: join(repo, ".claude", "worktrees", "aliased") });
    const held = mirrorOf({ key: join(home, "held") });
    const cache = mirrorOf({ key: join(dir, "cache", "1.0.0") });
    // The real free over a fixed gauge and a frozen clock, the pass's own deadline included: read live, a loaded
    // machine's fseventsd held the governed delete past its timeout and the gone mirror was never freed. The gauge's
    // reads prove the seam reaches the delete.
    const reads: number[] = [];
    const pass = pruneMirrors({
      apply: true,
      checkouts: [repo],
      deadlineMs: FROZEN_CLOCK() + 60_000,
      live: {
        byBranch: new Map(),
        failed: READ_WHOLE,
        index: new Map([[worktreePathKey({ path: join(home, "held") }), ["live workspace workspace:3"]]]),
        unreadable: [],
      },
      freeRoot: ({ root, timeoutMs }) =>
        freeMirrorRoot({
          gauge: ({ remainingMs }) => {
            reads.push(remainingMs);
            return QUIET_FSEVENTSD();
          },
          now: FROZEN_CLOCK,
          root,
          timeoutMs,
        }),
      now: FROZEN_CLOCK,
      paused: () => null,
      pluginsData: join(dir, "data"),
    });
    expect(reads).toEqual([60_000]);
    expect(pass).toEqual({
      freed: 1,
      kept: new Map([
        ["not a worktree of a declared main checkout — the mirror script's own age rule governs it", 1],
        ["its worktree still exists", 2],
        ["taken since the scan — live workspace workspace:3", 1],
      ]),
      removable: 1,
      removableSlots: 1,
      unreached: 0,
    });
    expect([gone, standing, aliased, held, cache].map((slot) => existsSync(slot))).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it("keeps a root whose free throws, under the error, and goes on to free the next", () => {
    dir = mkdtempSync(join(tmpdir(), "mirror-pass-"));
    const repo = join(dir, "repo");
    const home = join(repo, ".claude", "worktrees.noindex");
    const byRoot = join(dir, "data", "slopweaver-inline", "mirror", "by-root");
    for (const name of ["first", "second"]) {
      mkdirSync(join(byRoot, home, name, ".slot-a"), { recursive: true });
    }
    let calls = 0;
    const pass = pruneMirrors({
      apply: true,
      checkouts: [repo],
      deadlineMs: FROZEN_CLOCK() + 60_000,
      freeRoot: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("fixture free failed");
        }
        return true;
      },
      live: { byBranch: new Map(), failed: READ_WHOLE, index: new Map(), unreadable: [] },
      now: FROZEN_CLOCK,
      paused: () => null,
      pluginsData: join(dir, "data"),
    });
    expect(calls).toBe(2);
    expect(pass).toEqual({
      freed: 1,
      kept: new Map([["freeing its mirror threw — fixture free failed", 1]]),
      removable: 2,
      removableSlots: 2,
      unreached: 0,
    });
  });
});

const pass = (over: Partial<MirrorPass> = {}): MirrorPass => ({
  freed: 0,
  kept: new Map(),
  removable: 533,
  removableSlots: 770,
  unreached: 0,
  ...over,
});

describe("renderMirrorPass", () => {
  it("plans with the count, the slots and how to free them, the largest kept reason first", () => {
    const lines = renderMirrorPass({
      apply: false,
      freedKib: null,
      pass: pass({
        kept: new Map([
          ["its worktree still exists", 26],
          ["a mirror build holds its lock", 5],
          ["not a worktree", 105],
        ]),
      }),
    });
    expect(lines).toEqual([
      "plugin mirrors: 533 removed worktree(s) still hold 770 mirror slot(s) — pass --apply to free them",
      "  kept 105: not a worktree",
      "  kept 26: its worktree still exists",
      "  kept 5: a mirror build holds its lock",
    ]);
  });

  it("reports what an apply freed, the free space it measured and what the budget left", () => {
    const lines = renderMirrorPass({ apply: true, freedKib: 75_400_000, pass: pass({ freed: 500, unreached: 33 }) });
    expect(lines).toEqual([
      "plugin mirrors: freed 500 of 533 removed worktree(s)' mirrors (770 slot(s))",
      "  free space rose 75.4 GB (anything else writing to the disk moves this too)",
      "  33 not reached inside the budget or under the load hold — the next pass finishes them",
    ]);
  });

  it("omits the free-space line when the volume was not read", () => {
    const lines = renderMirrorPass({
      apply: true,
      freedKib: null,
      pass: pass({ freed: 0, removable: 0, removableSlots: 0 }),
    });
    expect(lines).toEqual(["plugin mirrors: freed 0 of 0 removed worktree(s)' mirrors (0 slot(s))"]);
  });
});
