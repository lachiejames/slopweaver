import { describe, expect, it } from "vitest";
import { parseSwapUsage } from "../../../../../live/machine/capacityParse.js";
import { SAMPLE_SWAP_TEXT } from "./fixtures.js";

describe("parseSwapUsage", () => {
  it("decodes used/total in GB from the M-suffixed sysctl line", () => {
    expect(parseSwapUsage({ text: SAMPLE_SWAP_TEXT })).toEqual({ totalGb: 4, usedGb: 6.2 });
  });

  it("decodes a G-suffixed total", () => {
    expect(parseSwapUsage({ text: "vm.swapusage: total = 8.00G  used = 2.00G  free = 6.00G" })).toEqual({
      totalGb: 8,
      usedGb: 2,
    });
  });

  it("returns undefined when the line does not parse", () => {
    expect(parseSwapUsage({ text: "not a swapusage line" })).toBeUndefined();
  });
});
