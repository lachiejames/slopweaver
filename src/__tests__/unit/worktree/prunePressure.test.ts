import { describe, expect, it } from "vitest";

import { worktreePruneFloorGb } from "../../../worktree/pruneFloor.js";
import { diskPressureFrom, pressureReclaimPolicy } from "../../../worktree/prunePressure.js";

/** GB (decimal) in KiB, as `df -k` reports it. */
const gbInKib = ({ gb }: { gb: number }): number => (gb * 1_000_000_000) / 1024;

describe("pressureReclaimPolicy", () => {
  it("drops dependencies on a routine apply", () => {
    expect(pressureReclaimPolicy({ diskPressure: false, mergedOnly: false })).toEqual({ runDepsPass: true });
  });

  it("never drops dependencies on a routine merged-only apply", () => {
    expect(pressureReclaimPolicy({ diskPressure: false, mergedOnly: true })).toEqual({ runDepsPass: false });
  });

  it("under disk pressure skips the hardlink-only dependency drop", () => {
    expect(pressureReclaimPolicy({ diskPressure: true, mergedOnly: false })).toEqual({ runDepsPass: false });
  });
});

describe("worktreePruneFloorGb", () => {
  it("is the owner's 100 GB, above capacity's 40 GB disk hold, whatever the fleet's size", () => {
    expect(worktreePruneFloorGb()).toBe(100);
  });
});

describe("diskPressureFrom", () => {
  it("reads 59.6 GB free as pressure", () => {
    expect(diskPressureFrom({ availableKib: gbInKib({ gb: 59.6 }), floorGb: 100 })).toBe(true);
  });

  it("reads 99.9 GB free as pressure against the prune floor", () => {
    expect(diskPressureFrom({ availableKib: gbInKib({ gb: 99.9 }), floorGb: worktreePruneFloorGb() })).toBe(true);
  });

  it("reads 262.5 GB free as routine — the reading the per-session floor once drained under pressure", () => {
    expect(diskPressureFrom({ availableKib: gbInKib({ gb: 262.5 }), floorGb: worktreePruneFloorGb() })).toBe(false);
  });

  it("reads an unreadable volume as routine, the safe side", () => {
    expect(diskPressureFrom({ availableKib: null, floorGb: 100 })).toBe(false);
  });

  it("reads exactly the floor as routine", () => {
    expect(diskPressureFrom({ availableKib: gbInKib({ gb: 100.8 }), floorGb: 100.8 })).toBe(false);
  });
});
