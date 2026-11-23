import { describe, expect, it } from "vitest";
import {
  comparePerf,
  HEAP_DRIFT_FLOOR_MIB,
  heapAllowance,
  type PerfBaseline,
  type PerfRecord,
  withRecord,
} from "../../../perf/baseline.js";

const RECORD: PerfRecord = {
  label: "gate:named-object-params",
  peakHeapMib: 3830,
  phases: [{ label: "createProgram", liveMib: 2314 }],
  recordedAt: "2026-09-20",
  topModules: [{ module: "node_modules/typescript", share: 0.79 }],
  wallMs: 40_000,
};

const BASELINE: PerfBaseline = { subjects: [RECORD] };

describe("heapAllowance", () => {
  it("takes the percentage band on a large reading", () => {
    expect(heapAllowance({ baselineMib: 3830 })).toBe(3906.6);
  });

  it("takes the absolute floor on a small one, so GC noise is not a regression", () => {
    expect(heapAllowance({ baselineMib: 100 })).toBe(100 + HEAP_DRIFT_FLOOR_MIB);
  });

  it("puts the floor clear of the 7 MiB spread three identical runs have shown", () => {
    expect(HEAP_DRIFT_FLOOR_MIB).toBeGreaterThan(7);
  });
});

describe("comparePerf", () => {
  it("reports no baseline, and no regression, for a subject never recorded", () => {
    const comparison = comparePerf({
      baseline: { subjects: [] },
      label: "gate:new-one",
      peakHeapMib: 900,
      wallMs: 1000,
    });
    expect(comparison.baseline).toBeUndefined();
    expect(comparison.heap.regressed).toBe(false);
    expect(comparison.heap.baselineMib).toBeUndefined();
    expect(comparison.heap.measuredMib).toBe(900);
  });

  it("calls a reading inside the band unchanged", () => {
    const comparison = comparePerf({
      baseline: BASELINE,
      label: "gate:named-object-params",
      peakHeapMib: 3860,
      wallMs: 40_000,
    });
    expect(comparison.heap.regressed).toBe(false);
    expect(comparison.heap.allowedMib).toBe(3906.6);
  });

  it("calls a reading past the band a regression", () => {
    const comparison = comparePerf({
      baseline: BASELINE,
      label: "gate:named-object-params",
      peakHeapMib: 3950,
      wallMs: 40_000,
    });
    expect(comparison.heap.regressed).toBe(true);
  });

  it("notes a wall-time drift without ever calling it a regression", () => {
    const comparison = comparePerf({
      baseline: BASELINE,
      label: "gate:named-object-params",
      peakHeapMib: 3830,
      wallMs: 90_000,
    });
    expect(comparison.wall.drifted).toBe(true);
    expect(comparison.heap.regressed).toBe(false);
  });

  it("leaves wall drift alone inside the advisory band", () => {
    const comparison = comparePerf({
      baseline: BASELINE,
      label: "gate:named-object-params",
      peakHeapMib: 3830,
      wallMs: 48_000,
    });
    expect(comparison.wall.drifted).toBe(false);
  });

  it("does not regress when this run could not read a heap at all", () => {
    const comparison = comparePerf({
      baseline: BASELINE,
      label: "gate:named-object-params",
      peakHeapMib: undefined,
      wallMs: 40_000,
    });
    expect(comparison.heap.regressed).toBe(false);
    expect(comparison.heap.measuredMib).toBeUndefined();
  });

  it("does not regress when the recorded run could not read a heap either", () => {
    const unmeasured: PerfBaseline = { subjects: [{ ...RECORD, peakHeapMib: null }] };
    const comparison = comparePerf({
      baseline: unmeasured,
      label: "gate:named-object-params",
      peakHeapMib: 9_999,
      wallMs: 40_000,
    });
    expect(comparison.heap.regressed).toBe(false);
    expect(comparison.heap.baselineMib).toBeUndefined();
  });
});

describe("withRecord", () => {
  it("replaces a subject's own row and keeps the document sorted", () => {
    const seeded: PerfBaseline = { subjects: [{ ...RECORD, label: "lane:unit", peakHeapMib: 10 }, RECORD] };
    const next = withRecord({ baseline: seeded, record: { ...RECORD, peakHeapMib: 4000 } });
    expect(next.subjects.map((subject) => subject.label)).toEqual(["gate:named-object-params", "lane:unit"]);
    expect(next.subjects[0]!.peakHeapMib).toBe(4000);
  });

  it("adds a subject the document has never held", () => {
    const next = withRecord({ baseline: { subjects: [] }, record: RECORD });
    expect(next.subjects).toEqual([RECORD]);
  });
});
