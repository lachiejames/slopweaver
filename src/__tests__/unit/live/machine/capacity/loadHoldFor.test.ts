import { describe, expect, it } from "vitest";
import { DEFAULT_LOAD_HOLD, loadHoldFor } from "../../../../../live/machine/capacityHolds.js";

describe("loadHoldFor", () => {
  it("holds at 45 on this device's own 15 cores — 3 x the cores", () => {
    expect(loadHoldFor({ cores: 15 })).toBe(45);
  });

  it("is exactly 3 x an odd core count, so no flooring is left to do", () => {
    expect(loadHoldFor({ cores: 9 })).toBe(27);
  });

  it("scales with the core count", () => {
    expect(loadHoldFor({ cores: 8 })).toBe(24);
  });

  it("falls back to the documented default when the core count could not be read", () => {
    expect(loadHoldFor({ cores: undefined })).toBe(DEFAULT_LOAD_HOLD);
  });

  it("treats a zero core count as unreadable rather than dividing the fleet down to nothing", () => {
    expect(loadHoldFor({ cores: 0 })).toBe(DEFAULT_LOAD_HOLD);
  });
});
