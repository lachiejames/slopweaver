/**
 * Removing one snapshot pool against a REAL git repository and real process liveness: every slot goes and git
 * forgets every tree, or — while any holder is live, or the directory holds something the pool did not write —
 * nothing is removed and every lease this removal took is put back.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TreeSnapshot } from "../../../codex/snapshot.js";
import { acquirePooledSnapshot } from "../../../codex/snapshotPool.js";
import { reclaimSnapshotPool } from "../../../codex/snapshotPoolReclaim.js";
import { unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const minted: string[] = [];
const held: TreeSnapshot[] = [];

afterEach(() => {
  for (const snapshot of held.splice(0)) {
    snapshot.release();
  }
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A directory this file removes after each test. */
function scratchDir({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  minted.push(dir);
  return dir;
}

/** A packet-shaped repository: one committed file, nothing else. */
function packetRepo(): string {
  const repoRoot = scratchDir({ prefix: "sw-reclaim-repo-" });
  const run = (...args: string[]): string => gitInTemp({ args, cwd: repoRoot });
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  writeFileSync(join(repoRoot, "body.md"), "a description\n");
  run("add", "-A");
  run("commit", "-qm", "packet");
  return repoRoot;
}

/** Git's own registration list, raw: `listWorktrees` omits pool slots by design, so it cannot witness them. */
function registered({ repoRoot }: { repoRoot: string }): string {
  return gitInTemp({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot });
}

/** The state markers in one slot directory. */
function slotMarkers({ slot }: { slot: string }): readonly string[] {
  return readdirSync(slot).filter((entry) => entry.startsWith("state."));
}

/** A pool of two slots: slot-0 still leased by this live process, slot-1 released. */
function twoSlotPool(): { repoRoot: string; poolRoot: string; ledgerPath: string; live: TreeSnapshot } {
  const repoRoot = packetRepo();
  const poolParent = scratchDir({ prefix: "sw-reclaim-pool-" });
  const live = acquirePooledSnapshot({ poolParent, repoRoot })._unsafeUnwrap();
  held.push(live);
  acquirePooledSnapshot({ poolParent, repoRoot })._unsafeUnwrap().release();
  const ledgerPath = join(scratchDir({ prefix: "sw-reclaim-home-" }), "home-reclaim.jsonl");
  return { ledgerPath, live, poolRoot: live.poolRoot!, repoRoot };
}

function reclaim({ ledgerPath, poolRoot, repoRoot }: { ledgerPath: string; poolRoot: string; repoRoot: string }) {
  return reclaimSnapshotPool({
    ledgerPath,
    nowIso: () => "2026-11-28T00:00:00.000Z",
    poolRoot,
    repoRoot,
    session: "t",
  });
}

describe("reclaimSnapshotPool", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("removes every slot, deregisters every tree, and journals what it freed", () => {
    const { ledgerPath, live, poolRoot, repoRoot } = twoSlotPool();
    live.release();
    expect(registered({ repoRoot })).toContain("slot-1");

    const removed = reclaim({ ledgerPath, poolRoot, repoRoot });

    expect(removed.isOk()).toBe(true);
    expect(removed._unsafeUnwrap().removedSlots).toBe(2);
    expect(removed._unsafeUnwrap().freedBytes).toBeGreaterThan(0);
    expect(existsSync(poolRoot)).toBe(false);
    expect(readdirSync(dirname(poolRoot))).toEqual([]);
    expect(registered({ repoRoot })).not.toContain("slot-");
    const row = JSON.parse(readFileSync(ledgerPath, "utf8").trim()) as Record<string, unknown>;
    expect([row["root"], row["takes"], row["removedEntries"], row["witnessHeld"]]).toEqual([
      "snapshot-pool",
      "description-review-pool",
      2,
      true,
    ]);
  });

  it("leaves the whole pool in place while one slot's holder is live, every other slot back to free", () => {
    const { ledgerPath, live, poolRoot, repoRoot } = twoSlotPool();
    const liveMarkers = slotMarkers({ slot: dirname(live.path) });

    const refused = reclaim({ ledgerPath, poolRoot, repoRoot });

    expect(unwrapErr(refused).code).toBe("POOL_SLOT_HELD");
    expect(unwrapErr(refused).message).toBe("left the pool in place: slot-0 live-holder");
    expect(readdirSync(poolRoot).toSorted()).toEqual(["common-dir", "slot-0", "slot-1"]);
    expect(slotMarkers({ slot: dirname(live.path) })).toEqual(liveMarkers);
    expect(slotMarkers({ slot: join(poolRoot, "slot-1") })).toEqual(["state.free"]);
    expect(existsSync(join(live.path, "body.md"))).toBe(true);
    expect(registered({ repoRoot })).toContain("slot-1");
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("puts every claim back when the pool cannot be renamed aside", () => {
    const { ledgerPath, live, poolRoot, repoRoot } = twoSlotPool();
    live.release();
    const pools = dirname(poolRoot);
    chmodSync(pools, 0o555);
    let refused: ReturnType<typeof reclaim>;
    try {
      refused = reclaim({ ledgerPath, poolRoot, repoRoot });
    } finally {
      chmodSync(pools, 0o755);
    }

    expect(unwrapErr(refused).code).toBe("POOL_REMOVE_FAILED");
    expect(
      readdirSync(poolRoot)
        .filter((entry) => entry.startsWith("slot-"))
        .toSorted(),
    ).toEqual(["slot-0", "slot-1"]);
    expect(slotMarkers({ slot: join(poolRoot, "slot-0") })).toEqual(["state.free"]);
    expect(slotMarkers({ slot: join(poolRoot, "slot-1") })).toEqual(["state.free"]);
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("leaves the pool in place when it holds an entry the pool does not write", () => {
    const { ledgerPath, live, poolRoot, repoRoot } = twoSlotPool();
    live.release();
    mkdirSync(join(poolRoot, ".mint-in-flight"));

    const refused = reclaim({ ledgerPath, poolRoot, repoRoot });

    expect(unwrapErr(refused).code).toBe("POOL_UNEXPECTED_ENTRY");
    expect(readdirSync(poolRoot).toSorted()).toEqual([".mint-in-flight", "common-dir", "slot-0", "slot-1"]);
    expect(slotMarkers({ slot: join(poolRoot, "slot-0") })).toEqual(["state.free"]);
    expect(registered({ repoRoot })).toContain("slot-0");
    expect(existsSync(ledgerPath)).toBe(false);
  });
});
