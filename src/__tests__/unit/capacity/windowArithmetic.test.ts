/**
 * The ceiling arithmetic: a raw usage under a usage limit never rounds up onto it, and a set of windows reads as its
 * tightest one's headroom.
 */
import { describe, expect, it } from "vitest";

import { share, usedOf, windowsHeadroom } from "../../../capacity/windowArithmetic.js";

describe("usedOf", () => {
  it("holds a raw value just under the limit below it, so the window still reads open", () => {
    expect(usedOf({ available: 30, raw: 29.999_999_9 })).toBe(29.99);
  });

  it("keeps a raw value at the limit at the limit", () => {
    expect(usedOf({ available: 30, raw: 30 })).toBe(30);
  });

  it("rounds an ordinary value to two decimals", () => {
    expect(usedOf({ available: 100, raw: 41.234_5 })).toBe(41.23);
  });

  it("rounds a raw value just under 100 up to 100 on a window with no usage limit, exactly as main did", () => {
    expect(usedOf({ available: 100, raw: 99.999_999_9 })).toBe(100);
  });
});

describe("share", () => {
  it("clamps above one and below zero", () => {
    expect([share({ value: 1.4 }), share({ value: -0.2 })]).toStrictEqual([1, 0]);
  });

  it("rounds to four decimals", () => {
    expect(share({ value: 0.123_456 })).toBe(0.1235);
  });
});

describe("windowsHeadroom", () => {
  it("is null over no windows", () => {
    expect(windowsHeadroom({ windows: [] })).toBeNull();
  });

  it("reads the tightest window, each against its own available share", () => {
    const headroom = windowsHeadroom({
      windows: [
        { available: 100, resetAtIso: null, used: 20, window: "five_hour" },
        { available: 30, resetAtIso: null, used: 24, window: "seven_day" },
      ],
    });
    expect(headroom).toBe(0.2);
  });
});
