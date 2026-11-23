import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FseventsdCpu } from "../../../worktree/fseventsdGauge.js";
import {
  findMirrorRoots,
  freeMirrorRoot,
  isMirrorSlotDir,
  LOCK_STALE_MS,
  type MirrorRoot,
  mirrorByRootDirs,
  mirrorVerdict,
  rereadMirrorRoot,
  worktreeHomesOf,
} from "../../../worktree/pluginMirrors.js";
import { FROZEN_CLOCK, QUIET_FSEVENTSD } from "./reclaimTrashFixtures.js";

const HOME = "/repo/.claude/worktrees.noindex";
const NOW_MS = Date.parse("2026-10-10T10:00:00.000Z");

const root = (over: Partial<MirrorRoot> = {}): MirrorRoot => ({
  dir: `/data/mirror/by-root${HOME}/gone`,
  key: `${HOME}/gone`,
  lockMtimeMs: null,
  slots: [".slot-a"],
  ...over,
});

describe("isMirrorSlotDir", () => {
  it("names a per-root slot even when the key path itself carries a `mirror` component", () => {
    expect(isMirrorSlotDir({ dir: "/d/mirror/by-root/work/mirror/repo/.slot-b" })).toBe(true);
  });

  it("refuses a slot name outside the mirror layout, a bare `mirror/a`, and a plain checkout", () => {
    expect(isMirrorSlotDir({ dir: "/d/elsewhere/.slot-a" })).toBe(false);
    expect(isMirrorSlotDir({ dir: "/d/mirror/a" })).toBe(false);
    expect(isMirrorSlotDir({ dir: "/work/slopweaver" })).toBe(false);
  });

  it("refuses a slot directly under `by-root`, with no plugin-root key between them", () => {
    expect(isMirrorSlotDir({ dir: "/d/mirror/by-root/.slot-a" })).toBe(false);
    expect(isMirrorSlotDir({ dir: "/d/mirror/by-root/k/.slot-a" })).toBe(true);
  });
});

describe("mirrorVerdict", () => {
  it("removes a gone worktree's mirror that nothing holds", () => {
    const verdict = mirrorVerdict({ held: null, keyExists: false, nowMs: NOW_MS, root: root(), worktreeHomes: [HOME] });
    expect(verdict.kind).toBe("remove");
  });

  it("keeps a root outside every declared worktree home, for the script's age rule", () => {
    const verdict = mirrorVerdict({
      held: null,
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ key: "/Users/x/.claude/plugins/cache/slopweaver/9.9.9" }),
      worktreeHomes: [HOME],
    });
    expect(verdict.reason).toBe(
      "not a worktree of a declared main checkout — the mirror script's own age rule governs it",
    );
  });

  it("keeps the checkout's own worktree home, which is not a worktree under it", () => {
    const verdict = mirrorVerdict({
      held: null,
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ key: HOME }),
      worktreeHomes: [HOME],
    });
    expect(verdict.kind).toBe("keep");
  });

  it("keeps a worktree that still exists", () => {
    const verdict = mirrorVerdict({ held: null, keyExists: true, nowMs: NOW_MS, root: root(), worktreeHomes: [HOME] });
    expect(verdict.reason).toBe("its worktree still exists");
  });

  it("keeps a root whose build lock was taken just now", () => {
    const verdict = mirrorVerdict({
      held: null,
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ lockMtimeMs: NOW_MS }),
      worktreeHomes: [HOME],
    });
    expect(verdict.reason).toBe("a mirror build holds its lock");
  });

  it("keeps a lock exactly as old as the script's own staleness threshold", () => {
    const verdict = mirrorVerdict({
      held: null,
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ lockMtimeMs: NOW_MS - LOCK_STALE_MS }),
      worktreeHomes: [HOME],
    });
    expect(verdict.reason).toBe("a mirror build holds its lock");
  });

  it("removes a gone worktree whose lock is past the threshold, since its holder died and no boot will break it", () => {
    const verdict = mirrorVerdict({
      held: null,
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ lockMtimeMs: NOW_MS - LOCK_STALE_MS - 1 }),
      worktreeHomes: [HOME],
    });
    expect(verdict).toEqual({
      kind: "remove",
      reason: "its worktree is gone and no live session or workspace stands in it",
    });
  });

  it("still keeps a live-register hold behind an abandoned lock", () => {
    const verdict = mirrorVerdict({
      held: "live workspace workspace:7",
      keyExists: false,
      nowMs: NOW_MS,
      root: root({ lockMtimeMs: NOW_MS - 7 * 24 * 60 * 60 * 1000 }),
      worktreeHomes: [HOME],
    });
    expect(verdict).toEqual({ kind: "keep", reason: "live workspace workspace:7" });
  });

  it("keeps a root a live register holds, with that register's reason", () => {
    const verdict = mirrorVerdict({
      held: "live workspace workspace:7",
      keyExists: false,
      nowMs: NOW_MS,
      root: root(),
      worktreeHomes: [HOME],
    });
    expect(verdict).toEqual({ kind: "keep", reason: "live workspace workspace:7" });
  });
});

describe("worktreeHomesOf", () => {
  it("names both spellings of every checkout's worktree home", () => {
    expect(worktreeHomesOf({ checkouts: ["/a", "/b"] })).toEqual([
      "/a/.claude/worktrees.noindex",
      "/a/.claude/worktrees",
      "/b/.claude/worktrees.noindex",
      "/b/.claude/worktrees",
    ]);
  });

  it("is empty with no checkout declared", () => {
    expect(worktreeHomesOf({ checkouts: [] })).toEqual([]);
  });
});

describe("the mirror tree on disk", () => {
  let dir = "";

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  const slot = ({ path }: { path: string }): void => {
    mkdirSync(join(path, "hooks"), { recursive: true });
    writeFileSync(join(path, "hooks", "a.js"), "x");
  };

  it("finds every data root's by-root directory, and only those that exist", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    mkdirSync(join(dir, "slopweaver-inline", "mirror", "by-root"), { recursive: true });
    mkdirSync(join(dir, "other-plugin"), { recursive: true });
    expect(mirrorByRootDirs({ pluginsData: dir })).toEqual([join(dir, "slopweaver-inline", "mirror", "by-root")]);
  });

  it("answers no by-root directory when the data root is absent", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    expect(mirrorByRootDirs({ pluginsData: join(dir, "absent") })).toEqual([]);
  });

  it("finds nested roots, never descends into a slot, and never follows a symlink", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    const byRoot = join(dir, "by-root");
    const outer = join(byRoot, "repo");
    const inner = join(outer, ".claude", "worktrees.noindex", "gone");
    slot({ path: join(outer, ".slot-a") });
    slot({ path: join(outer, ".slot-b") });
    slot({ path: join(inner, ".slot-b") });
    mkdirSync(join(inner, ".sync.lock"));
    // Seconds, as `utimesSync` takes them: the walk must report THIS lock's age, not merely that one stands.
    utimesSync(join(inner, ".sync.lock"), NOW_MS / 1000, NOW_MS / 1000);
    slot({ path: join(outer, ".slot-a", "nested", ".slot-a") });
    slot({ path: join(dir, "elsewhere", ".slot-a") });
    symlinkSync(join(dir, "elsewhere"), join(byRoot, "link"));
    const found = findMirrorRoots({ byRoot }).toSorted((a, b) => a.key.localeCompare(b.key));
    expect(found).toEqual([
      { dir: outer, key: "/repo", lockMtimeMs: null, slots: [join(outer, ".slot-a"), join(outer, ".slot-b")] },
      {
        dir: inner,
        key: "/repo/.claude/worktrees.noindex/gone",
        lockMtimeMs: NOW_MS,
        slots: [join(inner, ".slot-b")],
      },
    ]);
  });

  // The two cases below run the real governed delete over a fixed gauge and a frozen clock: read live, a loaded
  // machine's fseventsd held every quantum past the timeout and the slots were never freed. Each read the delete makes
  // of the gauge is recorded, so the case proves the seam reaches the delete rather than the live read.
  const quietGauge = (): { reads: number[]; gauge: (input: { remainingMs: number }) => FseventsdCpu } => {
    const reads: number[] = [];
    return {
      gauge: ({ remainingMs }) => {
        reads.push(remainingMs);
        return QUIET_FSEVENTSD();
      },
      reads,
    };
  };

  it("frees the slots, current and the marker, keeping the directory and the lock", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    slot({ path: join(dir, ".slot-a") });
    slot({ path: join(dir, ".slot-b") });
    symlinkSync(".slot-a", join(dir, "current"));
    writeFileSync(join(dir, ".last-sync"), "1");
    writeFileSync(join(dir, ".sync.lock"), "");
    const { gauge, reads } = quietGauge();
    const freed = freeMirrorRoot({
      gauge,
      now: FROZEN_CLOCK,
      root: { dir, key: "/k", lockMtimeMs: null, slots: [join(dir, ".slot-a"), join(dir, ".slot-b")] },
      timeoutMs: 60_000,
    });
    expect(freed).toBe(true);
    expect(reads).toEqual([60_000, 60_000]);
    expect(
      [".slot-a", ".slot-b", "current", ".last-sync", ".sync.lock"].map((name) => existsSync(join(dir, name))),
    ).toEqual([false, false, false, false, true]);
  });

  it("leaves a current that is a real directory, not the script's link, and still frees the slots and marker", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    slot({ path: join(dir, ".slot-a") });
    mkdirSync(join(dir, "current"));
    writeFileSync(join(dir, "current", "sentinel"), "x");
    writeFileSync(join(dir, ".last-sync"), "1");
    const { gauge, reads } = quietGauge();
    const freed = freeMirrorRoot({
      gauge,
      now: FROZEN_CLOCK,
      root: { dir, key: "/k", lockMtimeMs: null, slots: [join(dir, ".slot-a")] },
      timeoutMs: 60_000,
    });
    expect(freed).toBe(true);
    expect(reads).toEqual([60_000]);
    expect([".slot-a", ".last-sync", "current/sentinel"].map((name) => existsSync(join(dir, name)))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("re-reads a lock taken after the walk found the root", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    slot({ path: join(dir, ".slot-a") });
    const walked: MirrorRoot = { dir, key: "/k", lockMtimeMs: null, slots: [join(dir, ".slot-a")] };
    mkdirSync(join(dir, ".sync.lock"));
    utimesSync(join(dir, ".sync.lock"), NOW_MS / 1000, NOW_MS / 1000);
    expect(rereadMirrorRoot({ root: walked }).lockMtimeMs).toBe(NOW_MS);
  });

  it("re-reads a lock released after the walk found it", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    slot({ path: join(dir, ".slot-a") });
    const walked: MirrorRoot = { dir, key: "/k", lockMtimeMs: NOW_MS, slots: [join(dir, ".slot-a")] };
    expect(rereadMirrorRoot({ root: walked }).lockMtimeMs).toBe(null);
  });

  it("reports the slots still standing when no time is left to delete them", () => {
    dir = mkdtempSync(join(tmpdir(), "mirrors-"));
    slot({ path: join(dir, ".slot-a") });
    const freed = freeMirrorRoot({
      root: { dir, key: "/k", lockMtimeMs: null, slots: [join(dir, ".slot-a")] },
      timeoutMs: 0,
    });
    expect(freed).toBe(false);
  });
});
