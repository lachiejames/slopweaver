/**
 * `machine capacity`'s process ranking: the GB display rounding, the exact-bytes threshold, and which ranked
 * process a report names as its hogs.
 */
import { describe, expect, it } from "vitest";

import { bytesToGb, hogsOf, overThresholdGb, type RankedProcess } from "../../../../live/machine/capacityRank.js";

const GIB = 1024 * 1024 * 1024;

const SESSION = { cwd: "/w", pid: 100, sessionId: "s-100" };

const proc = (over: Partial<RankedProcess> & { pid: number; footprintBytes: number }): RankedProcess => ({
  classification: "foreign",
  footprintGb: bytesToGb({ bytes: over.footprintBytes }),
  label: `p${String(over.pid)}`,
  session: undefined,
  ...over,
});

describe("bytesToGb", () => {
  it("rounds to one decimal", () => {
    expect(bytesToGb({ bytes: 1.26 * GIB })).toBe(1.3);
  });
});

describe("overThresholdGb", () => {
  it("judges the exact bytes, so 8200 MiB is over an 8 GB threshold that its rounded display reads as 8", () => {
    const bytes = 8200 * 1024 * 1024;
    expect(bytesToGb({ bytes })).toBe(8);
    expect(overThresholdGb({ bytes, gb: 8 })).toBe(true);
  });

  it("is not over at exactly the threshold", () => {
    expect(overThresholdGb({ bytes: 8 * GIB, gb: 8 })).toBe(false);
  });
});

describe("hogsOf", () => {
  it("names the largest foreign process and every session-spawned child over the threshold, never the session's own claude", () => {
    const ranked = [
      proc({ classification: "fleet", footprintBytes: 20 * GIB, pid: 101, session: SESSION }),
      proc({ classification: "fleet", footprintBytes: 12 * GIB, pid: 100, session: SESSION }),
      proc({ footprintBytes: 9 * GIB, pid: 7 }),
      proc({ classification: "fleet", footprintBytes: 2 * GIB, pid: 102, session: SESSION }),
    ];
    const hogs = hogsOf({ foreignAlertGb: 8, ranked });
    expect(hogs.topForeign!.pid).toBe(7);
    expect(hogs.topFleetChild!.pid).toBe(101);
    expect(hogs.alertingChildren.map((child) => child.pid)).toEqual([101]);
    expect(hogs.fleetChildAlert).toBe(true);
  });

  it("names no hog on an empty ranking", () => {
    const hogs = hogsOf({ foreignAlertGb: 8, ranked: [] });
    expect(hogs.topForeign).toBe(undefined);
    expect(hogs.topFleetChild).toBe(undefined);
    expect(hogs.fleetChildAlert).toBe(false);
  });
});
