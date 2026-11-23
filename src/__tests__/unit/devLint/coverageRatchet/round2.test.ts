/*
 * `round2`: a percentage rounded to the two decimals every floor is written at.
 */
import { describe, expect, it } from "vitest";

import { round2 } from "../../../../devLint/coverageFloor.js";

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2({ value: 85.126 })).toBe(85.13);
  });
});
