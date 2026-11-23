/*
 * `codex gauge`'s reading age — whole hours between the observation and the read, never NaN.
 */
import { describe, expect, it } from "vitest";
import { readingAgeHours } from "../defaultThresholds.js";

describe("readingAgeHours", () => {
  it("reports whole hours between two instants", () => {
    expect(readingAgeHours({ nowIso: "2026-09-13T12:00:00.000Z", observedAtIso: "2026-09-13T05:51:14.803Z" })).toBe(6);
  });

  it("reports 0 for a reading taken this hour rather than rounding up", () => {
    expect(readingAgeHours({ nowIso: "2026-09-13T06:50:00.000Z", observedAtIso: "2026-09-13T05:51:14.803Z" })).toBe(0);
  });

  it("returns undefined for an instant that will not parse, rather than NaN hours", () => {
    expect(readingAgeHours({ nowIso: "not a date", observedAtIso: "2026-09-13T05:51:14.803Z" })).toBeUndefined();
  });
});
