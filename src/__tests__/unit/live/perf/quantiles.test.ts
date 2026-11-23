import { describe, expect, it } from "vitest";
import { percentile, summarise } from "../../../../live/perf/quantiles.js";

describe("percentile", () => {
  it("reads the nearest rank rather than interpolating between two measured values", () => {
    expect(percentile({ fraction: 0.95, sorted: [1, 2] })).toBe(2);
    expect(percentile({ fraction: 0.5, sorted: [1, 2] })).toBe(1);
  });

  it("answers undefined on an empty sample, never zero", () => {
    expect(percentile({ fraction: 0.5, sorted: [] })).toBeUndefined();
  });

  it("clamps a fraction of 0 to the first element rather than to rank -1", () => {
    expect(percentile({ fraction: 0, sorted: [7, 8, 9] })).toBe(7);
  });

  it("reads the last element at fraction 1", () => {
    expect(percentile({ fraction: 1, sorted: [7, 8, 9] })).toBe(9);
  });
});

describe("summarise", () => {
  it("sorts a copy, leaving the caller's array in its original order", () => {
    const samples = [9, 1, 5];
    const distribution = summarise({ samples })!;
    expect(samples).toEqual([9, 1, 5]);
    expect(distribution.p50).toBe(5);
    expect(distribution.max).toBe(9);
    expect(distribution.count).toBe(3);
  });

  it("answers undefined for an empty sample — no measurement is not a measurement of zero", () => {
    expect(summarise({ samples: [] })).toBeUndefined();
  });

  it("reports a single sample as its own p50, p95 and max", () => {
    expect(summarise({ samples: [42] })).toEqual({ count: 1, max: 42, p50: 42, p95: 42 });
  });

  it("keeps a lone outlier out of p50 and out of p95, reporting it as max", () => {
    // Nearest rank over 20 samples puts p95 at the 19th, so ONE outlier in 20 is a max rather than a p95 —
    // which is why `max` is carried at all instead of being inferred from p95.
    const distribution = summarise({ samples: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 600] })!;
    expect(distribution.p50).toBe(1);
    expect(distribution.p95).toBe(1);
    expect(distribution.max).toBe(600);
    expect(distribution.count).toBe(20);
  });

  it("reports a p95 the moment the top 5% is fully outlying", () => {
    const distribution = summarise({ samples: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 600, 900] })!;
    expect(distribution.p95).toBe(600);
    expect(distribution.max).toBe(900);
  });
});
