/**
 * `holdReasons` directly: the disk floor's clause and where it sits among the other holds, and `diskFloorFor`, the
 * derivation behind it; and `./cpuLoadHold.ts`'s load rule. The whole report around them is `capacity/`'s.
 */
import { describe, expect, it } from "vitest";

import { diskFloorFor, holdReasons, SEAT_TREE_GB } from "../../../../live/machine/capacityHolds.js";
import { cpuLoadHolding, IDLE_HOLD_FLOOR_PCT, loadHoldFor } from "../../../../live/machine/cpuLoadHold.js";
import type { DiskReading } from "../../../../live/machine/diskFootprint.js";
import { DEFAULT_RECENT_BOOTS_HOLD } from "../../../../live/machine/recentBoots.js";

/** The derived floor: a 5.6 GB tree each for the 6-seat boots burst, the next and one spare — 44.8 GB. */
const DERIVED_FLOOR = diskFloorFor();

/** 43652343 KiB x 1024 B = 44,699,999,232 B, which every surface prints as 44.7 GB — a hair under the 44.8 GB floor. */
const JUST_UNDER_FLOOR_KIB = 43_652_343;

/** Exactly 44.8 GB in 1 KiB blocks: 44.8e9 / 1024. */
const AT_FLOOR_KIB = 43_750_000;

/**
 * 256347656 KiB x 1024 B = 262,499,999,744 B, printed as 262.5 GB: the free space `machine capacity` read while
 * the old per-live-session floor held 53 sessions at 308 GB.
 */
const HELD_AT_262_GB_KIB = 256_347_656;

/** 150 GB in 1 KiB blocks: the free space Finder showed on the 85%-full volume the owner read held. */
const HIS_150_GB_KIB = 146_484_375;

/** A disk reading whose volume has the stated free blocks. */
const diskWith = ({ availableKib }: { availableKib: number }): DiskReading => ({
  registeredTotal: 12,
  repos: [],
  volume: { availableKib, totalKib: 971_298_980, usedPct: 85 },
});

/** Every input but the disk, each one quiet, so a clause can only come from the disk floor or the load. */
const QUIET = {
  boots: { boots: [], hold: 6, windowSeconds: 180 },
  compressor: undefined,
  diskFloor: DERIVED_FLOOR,
  fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [] },
  hookStallHoldSeconds: 120,
  idlePct: undefined,
  loadHold: 45,
  segmentsHoldPct: 40,
  swapfileCount: undefined,
  swapfileHoldCount: 12,
};

describe("diskFloorFor", () => {
  it("sizes a seat tree at the largest one measured, and a burst at the boots hold", () => {
    expect(SEAT_TREE_GB).toBe(5.6);
    expect(DEFAULT_RECENT_BOOTS_HOLD).toBe(6);
  });

  it("holds room for a tree each for the boots burst, the next and one spare — 8 trees, 44.8 GB", () => {
    expect(DERIVED_FLOOR).toStrictEqual({
      gb: 44.8,
      why: "a 5.6 GB seat tree each for the 6-seat boots burst, the next and one spare",
    });
    expect(DERIVED_FLOOR.gb).toBe(Math.round((DEFAULT_RECENT_BOOTS_HOLD + 1 + 1) * SEAT_TREE_GB * 10) / 10);
  });

  it("takes a pinned floor over the derived one", () => {
    expect(diskFloorFor({ pinnedGb: 10 })).toStrictEqual({ gb: 10, why: "the floor the caller set" });
  });
});

describe("holdReasons — the disk floor", () => {
  it("holds on disk a hair under the floor, naming both numbers, the derivation and the remedy", () => {
    expect(
      holdReasons({ ...QUIET, disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }), load: undefined }),
    ).toStrictEqual([
      {
        subject: "disk",
        text:
          "disk 44.7 GB free (df, Finder shows at least this), hold below 44.8 GB — a 5.6 GB seat tree each for " +
          "the 6-seat boots burst, the next and one spare; run slopweaver worktree prune --apply",
      },
    ]);
  });

  it("does not hold an 85%-full volume with 150 GB free — a reading that is no reason to hold", () => {
    expect(holdReasons({ ...QUIET, disk: diskWith({ availableKib: HIS_150_GB_KIB }), load: undefined })).toStrictEqual(
      [],
    );
  });

  it("does not hold 262.5 GB free, which the per-live-session floor held at 308 GB", () => {
    expect(
      holdReasons({ ...QUIET, disk: diskWith({ availableKib: HELD_AT_262_GB_KIB }), load: undefined }),
    ).toStrictEqual([]);
  });

  it("does not hold at exactly the floor", () => {
    expect(holdReasons({ ...QUIET, disk: diskWith({ availableKib: AT_FLOOR_KIB }), load: undefined })).toStrictEqual(
      [],
    );
  });

  it("does not hold one KiB under the floor, which every surface prints as 44.8 GB free", () => {
    expect(
      holdReasons({ ...QUIET, disk: diskWith({ availableKib: AT_FLOOR_KIB - 1 }), load: undefined }),
    ).toStrictEqual([]);
  });

  it("does not hold when the disk or its volume was not read", () => {
    const unreadVolume: DiskReading = { registeredTotal: undefined, repos: [], volume: undefined };

    expect(holdReasons({ ...QUIET, disk: undefined, load: undefined })).toStrictEqual([]);
    expect(holdReasons({ ...QUIET, disk: unreadVolume, load: undefined })).toStrictEqual([]);
  });

  it("puts the disk clause after a cpu one", () => {
    const subjects = holdReasons({
      ...QUIET,
      disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }),
      load: { load1: 46, load15: 46, load5: 46 },
    }).map((reason) => reason.subject);

    expect(subjects).toStrictEqual(["cpu", "disk"]);
  });
});

describe("cpuLoadHolding", () => {
  it("opens with the 20% floor and the 45 hold", () => {
    expect(IDLE_HOLD_FLOOR_PCT).toBe(20);
    expect(loadHoldFor({ cores: 15 })).toBe(45);
  });

  it.each([
    { expected: false, idlePct: undefined, label: "below the hold, idle unread", load1: 44.99 },
    { expected: false, idlePct: 5, label: "below the hold, however busy", load1: 44.99 },
    { expected: false, idlePct: 40, label: "at the hold with 40% idle", load1: 45 },
    { expected: true, idlePct: 19.9, label: "at the hold with 19.9% idle", load1: 45 },
    { expected: true, idlePct: 19.96, label: "over the hold at top's two-place 19.96% idle", load1: 46.5 },
    { expected: false, idlePct: 20, label: "at the hold with idle exactly at the floor", load1: 45 },
    { expected: true, idlePct: undefined, label: "at the hold with idle unread, so load judges alone", load1: 45 },
    { expected: true, idlePct: 3, label: "far over the hold at 3% idle", load1: 146 },
    { expected: false, idlePct: 60, label: "far over the hold at 60% idle", load1: 146 },
    { expected: false, idlePct: 3, label: "load unread", load1: undefined },
  ])("$label -> $expected", ({ expected, idlePct, load1 }) => {
    expect(cpuLoadHolding({ idlePct, load1, loadHold: 45 })).toBe(expected);
  });
});

describe("holdReasons — the cpu clause", () => {
  const OVER_LOAD = { load: { load1: 46.5, load15: 46.5, load5: 46.5 } };

  it("names the measured idle against its floor when the load holds under 20% idle", () => {
    expect(holdReasons({ ...QUIET, ...OVER_LOAD, disk: undefined, idlePct: 3 })).toStrictEqual([
      { subject: "cpu", text: "1-min load 46.5, hold at 45, 3% idle, under the 20% floor" },
    ]);
  });

  it("says idle went unmeasured, so load judged alone, when no idle was read", () => {
    expect(holdReasons({ ...QUIET, ...OVER_LOAD, disk: undefined, idlePct: undefined })).toStrictEqual([
      { subject: "cpu", text: "1-min load 46.5, hold at 45, idle unmeasured, so load judged alone" },
    ]);
  });

  it("holds nothing on the same load at 40% idle", () => {
    expect(holdReasons({ ...QUIET, ...OVER_LOAD, disk: undefined, idlePct: 40 })).toStrictEqual([]);
  });
});
