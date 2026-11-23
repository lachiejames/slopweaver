import { describe, expect, it } from "vitest";

import { mean, median } from "../../../velocity/stats.js";

describe("mean", () => {
  it("averages a sample", () => {
    expect(mean({ values: [1, 2, 3] })).toBe(2);
  });

  it("returns undefined for an empty sample", () => {
    expect(mean({ values: [] })).toBe(undefined);
  });
});

describe("median", () => {
  it("returns the middle value of an odd-sized sample", () => {
    expect(median({ values: [5, 1, 3] })).toBe(3);
  });

  it("averages the two middle values of an even-sized sample", () => {
    expect(median({ values: [1, 2, 3, 4] })).toBe(2.5);
  });

  it("returns undefined for an empty sample", () => {
    expect(median({ values: [] })).toBe(undefined);
  });

  it("does not mutate the input array", () => {
    const values = [3, 1, 2];
    median({ values });
    expect(values).toEqual([3, 1, 2]);
  });
});
