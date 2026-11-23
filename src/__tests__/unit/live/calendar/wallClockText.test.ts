/**
 * Unit: wall-clock text at its edges — the whole day as hours, what `parseDailyHours` refuses, the two ends of
 * `renderMinute`'s range, and one instant rendered in a zone west of Greenwich.
 */
import { describe, expect, it } from "vitest";
import { parseDailyHours, renderInZone, renderMinute } from "../../../../live/calendar/wallClockText.js";

describe("parseDailyHours", () => {
  it("reads the whole day, up to the 24:00 close", () => {
    expect(parseDailyHours({ text: "00:00-24:00" })).toStrictEqual({ endMinute: 1440, startMinute: 0 });
  });

  it("refuses equal and reversed hours", () => {
    expect(parseDailyHours({ text: "09:00-09:00" })).toBeUndefined();
    expect(parseDailyHours({ text: "17:00-09:00" })).toBeUndefined();
  });

  it("refuses an out-of-range minute and text that is not two wall-clock times", () => {
    expect(parseDailyHours({ text: "09:60-17:00" })).toBeUndefined();
    expect(parseDailyHours({ text: "9:00-17:00" })).toBeUndefined();
    expect(parseDailyHours({ text: "" })).toBeUndefined();
  });
});

describe("renderMinute", () => {
  it("pads both fields at the two ends of the day", () => {
    expect(renderMinute({ minute: 0 })).toBe("00:00");
    expect(renderMinute({ minute: 1440 })).toBe("24:00");
  });
});

describe("renderInZone", () => {
  it("renders the local date, weekday and time, which can be the day before the UTC date", () => {
    expect(renderInZone({ atMs: Date.parse("2026-03-02T02:30:00Z"), zone: "America/New_York" })).toBe(
      "2026-03-01 Sun 21:30",
    );
  });
});
