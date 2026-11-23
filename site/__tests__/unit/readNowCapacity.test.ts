/*
 * `readCapacity` and the disk floor: a capture carrying `diskHoldFreeGb` hands it on, and one from before the field
 * still reads, with the floor absent rather than invented.
 */
import { describe, expect, it } from "vitest";

import { readCapacity } from "../../components/live/readNow";

/** The least `machine capacity --json` document `readCapacity` accepts, with a case's keys laid over it. */
const payload = (over: Record<string, unknown>): Record<string, unknown> => ({
  alert: false,
  diskFreeGb: 150,
  diskUsedPct: 85,
  fleet: { orphanCount: 0, sessions: [] },
  graded: ["memory", "cpu"],
  hold: false,
  holdSubjects: [],
  load: { load1: 4, load15: 4, load5: 4 },
  loadHold: 45,
  swapTotalGb: 4,
  swapUsedGb: 1,
  verdict: "machine capacity: ok",
  ...over,
});

describe("readCapacity — the disk floor", () => {
  it("hands on the floor a capture carries", () => {
    expect(readCapacity(payload({ diskHoldFreeGb: 30 }))!.diskHoldFreeGb).toBe(30);
  });

  it("still reads a capture from before the floor was carried, leaving it absent", () => {
    const capacity = readCapacity(payload({}))!;

    expect(capacity.diskFreeGb).toBe(150);
    expect(capacity.diskHoldFreeGb).toBe(undefined);
  });
});

describe("readCapacity — top's idle percentage", () => {
  it("reads the idle percentage off the hidden-cpu block, the figure the load hold clears on", () => {
    const hiddenCpu = { busyCores: 5.3, hiddenFromTop: [], idlePct: 64.4, unattributedCores: 2.8, visibleCores: 2.6 };
    const capacity = readCapacity(payload({ hiddenCpu }))!;

    expect(capacity.idlePct).toBe(64.4);
    expect(capacity.unattributedCores).toBe(2.8);
    expect(capacity.loadHold).toBe(45);
  });

  it("reads idle with no core count, which leaves the residual unattributed figure absent", () => {
    const capacity = readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: 12.5 } }))!;

    expect(capacity.idlePct).toBe(12.5);
    expect(capacity.unattributedCores).toBe(undefined);
  });

  it("leaves idle absent for a capture with no hidden-cpu block", () => {
    expect(readCapacity(payload({}))!.idlePct).toBe(undefined);
    expect(readCapacity(payload({ hiddenCpu: { busyCores: 5.3, unattributedCores: 2.8 } }))!.idlePct).toBe(undefined);
  });

  it("refuses a present idle that is not a percentage, so no tile renders a figure top could not have read", () => {
    expect(readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: 101 } }))).toBe(undefined);
    expect(readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: -1 } }))).toBe(undefined);
    expect(readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: "40" } }))).toBe(undefined);
    expect(readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: 0 } }))!.idlePct).toBe(0);
    expect(readCapacity(payload({ hiddenCpu: { hiddenFromTop: [], idlePct: 100 } }))!.idlePct).toBe(100);
  });
});
