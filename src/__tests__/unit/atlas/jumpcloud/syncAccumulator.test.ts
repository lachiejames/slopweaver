import { describe, expect, it } from "vitest";

import type { JumpcloudResumeEntry } from "../../../../atlas/jumpcloud/resume.js";
import { absorbJumpcloudCall, emptyJumpcloudAccumulator } from "../../../../atlas/jumpcloud/syncAccumulator.js";

const NO_RECORDS = { entities: [], projections: [], providerIds: [] } as const;

function entry(over: Partial<JumpcloudResumeEntry> = {}): JumpcloudResumeEntry {
  return {
    at: "2026-09-04T10:00:00.000Z",
    complete: true,
    declaredTotal: null,
    empty: false,
    endpoint: "/api/systems",
    incompleteIsClearable: false,
    isRoot: true,
    key: "v1-systems-list|/api/systems",
    kind: "systems",
    pagesExhausted: true,
    reason: "read 1 record",
    records: [],
    surface: "v1-systems-list",
    ...over,
  };
}

describe("the walk's accumulator", () => {
  it("starts with no epoch, no total and every page exhausted", () => {
    const fresh = emptyJumpcloudAccumulator();
    expect(fresh.firstAt).toBe(null);
    expect(fresh.declaredTotal).toBe(null);
    expect(fresh.pagesExhausted).toBe(true);
    expect(fresh.resumed).toBe(0);
  });

  it("keeps the FIRST declared total, and takes a later one only while none was seen", () => {
    const accumulator = emptyJumpcloudAccumulator();
    absorbJumpcloudCall({ accumulator, entry: entry({ declaredTotal: null }), observed: NO_RECORDS });
    expect(accumulator.declaredTotal).toBe(null);
    absorbJumpcloudCall({ accumulator, entry: entry({ declaredTotal: 7 }), observed: NO_RECORDS });
    absorbJumpcloudCall({ accumulator, entry: entry({ declaredTotal: 9 }), observed: NO_RECORDS });
    expect(accumulator.declaredTotal).toBe(7);
  });

  it("folds an entry's journalled drops, and an older entry carrying none adds nothing", () => {
    const accumulator = emptyJumpcloudAccumulator();
    absorbJumpcloudCall({ accumulator, entry: entry(), observed: NO_RECORDS });
    absorbJumpcloudCall({
      accumulator,
      entry: entry({ dropped: [{ pointer: "/password", reason: "depth-limit" }] }),
      observed: NO_RECORDS,
    });
    expect(accumulator.journalledDrops).toEqual([{ pointer: "/password", reason: "depth-limit" }]);
  });

  it("widens the epoch by each entry's own instant and records ids per surface", () => {
    const accumulator = emptyJumpcloudAccumulator();
    const observed = { entities: [], projections: [], providerIds: ["sys-1"] };
    absorbJumpcloudCall({ accumulator, entry: entry({ at: "2026-09-04T12:00:00.000Z" }), observed });
    absorbJumpcloudCall({ accumulator, entry: entry({ at: "2026-09-04T09:00:00.000Z" }), observed });
    expect(accumulator.firstAt).toBe("2026-09-04T09:00:00.000Z");
    expect(accumulator.lastAt).toBe("2026-09-04T12:00:00.000Z");
    expect(accumulator.providerIdsBySurface).toEqual({ "v1-systems-list": ["sys-1", "sys-1"] });
  });

  it("names an incomplete call, and lists it as clearable only when a later run could clear it", () => {
    const accumulator = emptyJumpcloudAccumulator();
    absorbJumpcloudCall({
      accumulator,
      entry: entry({ complete: false, empty: true, incompleteIsClearable: true, pagesExhausted: false }),
      observed: NO_RECORDS,
    });
    expect(accumulator.incompleteOperations).toEqual(["v1-systems-list"]);
    expect(accumulator.clearableIncomplete).toEqual(["v1-systems-list at /api/systems: read 1 record"]);
    expect(accumulator.emptyOperations).toEqual(["v1-systems-list"]);
    expect(accumulator.pagesExhausted).toBe(false);
  });
});
