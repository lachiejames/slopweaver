import { describe, expect, it } from "vitest";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { machineCapacityJson } from "../../../../../live/machine/capacityRender.js";
import type { DiskReading } from "../../../../../live/machine/diskFootprint.js";
import { HEALTHY_GAUGES, NO_DISPATCH, OVERLOADED_TOP_TEXT } from "./fixtures.js";

/** A volume reading with `availableKib` free, every other figure beside the point. */
const diskWith = ({ availableKib }: { availableKib: number }): DiskReading => ({
  registeredTotal: undefined,
  repos: [],
  volume: { availableKib, totalKib: 971_298_980, usedPct: 85 },
});

/*
 * The floor these cases judge against: the owner's 40 GB, room for seven 5.6 GB seat trees — the 6-seat boots burst
 * and the next — whatever the session count (`diskFloorFor`, `capacityHolds.ts`).
 */

/** 39.9 GB as `df -k` would count it: 38964843 KiB x 1024 B = 39,899,999,232 B. */
const JUST_UNDER_FLOOR_KIB = 38_964_843;

/** Exactly 40 GB: 39062500 KiB x 1024 B = 40,000,000,000 B. */
const AT_FLOOR_KIB = 39_062_500;

/** A healthy machine on every graded subject, so a disk hold is the only thing that can fire. */
const QUIET_READING = {
  ...HEALTHY_GAUGES,
  comms: [],
  processes: [],
  swapText: "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M",
  topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n",
} as const;

describe("the disk floor hold", () => {
  it("HOLDs on disk at 39.9 GB df-available, naming both numbers, the derivation and the remedy", () => {
    const report = buildMachineCapacityReport({
      ...QUIET_READING,
      disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }),
    });
    expect(report.diskHoldFreeGb).toBe(40);
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["disk"]);
    expect(report.graded).toEqual(["memory", "cpu"]);
    expect(report.verdict).toBe(
      "machine capacity: HOLD on disk (disk 39.9 GB free (df, Finder shows at least this), hold below 40 GB — " +
        "the owner's floor, room for a 5.6 GB seat tree each for the 6-seat boots burst and the next; " +
        "run slopweaver worktree prune --apply) — 1-min load 1 · idle unmeasured · no foreign process observed · swap 0.5/4 GB · " +
        "compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("does not hold at exactly the floor", () => {
    const report = buildMachineCapacityReport({ ...QUIET_READING, disk: diskWith({ availableKib: AT_FLOOR_KIB }) });
    expect(report.hold).toBe(false);
    expect(report.holdSubjects).toEqual([]);
  });

  it("never holds on a disk reading it did not take, or a volume df could not read", () => {
    expect(buildMachineCapacityReport({ ...QUIET_READING, disk: undefined }).hold).toBe(false);
    const unread: DiskReading = { registeredTotal: undefined, repos: [], volume: undefined };
    expect(buildMachineCapacityReport({ ...QUIET_READING, disk: unread }).hold).toBe(false);
  });

  it("names disk after cpu when the load also holds", () => {
    const report = buildMachineCapacityReport({
      ...QUIET_READING,
      disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }),
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.holdSubjects).toEqual(["cpu", "disk"]);
  });

  it("names no culprit on a disk-only hold, because a full volume is no process's to end", () => {
    const report = buildMachineCapacityReport({
      ...QUIET_READING,
      disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }),
    });
    expect(report.culprit).toBeUndefined();
    expect(report.verdict).not.toContain("SUBJECT");
  });

  it("carries the floor it actually judged against into the report and the JSON, an override included", () => {
    const report = buildMachineCapacityReport({
      ...QUIET_READING,
      disk: diskWith({ availableKib: JUST_UNDER_FLOOR_KIB }),
      diskHoldFreeGb: 10,
    });
    expect(report.hold).toBe(false);
    expect(report.diskHoldFreeGb).toBe(10);
    expect(machineCapacityJson({ dispatch: NO_DISPATCH, report }).diskHoldFreeGb).toBe(10);
  });
});
