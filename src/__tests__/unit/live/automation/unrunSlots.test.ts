/**
 * How many scheduled times went by with no run. Every cadence here is hourly or minute-stepped, so the count is the
 * same in every timezone the cron walk could run in.
 */
import { describe, expect, it } from "vitest";

import { unrunSlotsOf } from "../../../../live/automation/unrunSlots.js";

describe("unrunSlotsOf", () => {
  it("counts every hour after the oldest firing with no firing row, up to the one now due", () => {
    // 01, 02, 04 went by; 05 is due, not gone by.
    expect(
      unrunSlotsOf({
        cadence: "0 * * * *",
        nowIso: "2026-10-09T05:30:00.000Z",
        slotIsos: ["2026-10-09T03:00:00.000Z", "2026-10-09T00:00:00.000Z"],
      }),
    ).toEqual({ bound: "exact", count: 3 });
  });

  it("does not count the newest time when nothing ran it yet, because it is due rather than gone by", () => {
    expect(
      unrunSlotsOf({
        cadence: "*/15 * * * *",
        nowIso: "2026-10-09T01:05:00.000Z",
        slotIsos: ["2026-10-09T00:00:00.000Z", "2026-10-09T00:15:00.000Z", "2026-10-09T00:30:00.000Z"],
      }),
    ).toEqual({ bound: "exact", count: 1 });
  });

  it("is zero when every scheduled time ran", () => {
    expect(
      unrunSlotsOf({
        cadence: "0 * * * *",
        nowIso: "2026-10-09T02:10:00.000Z",
        slotIsos: ["2026-10-09T00:00:00.000Z", "2026-10-09T01:00:00.000Z", "2026-10-09T02:00:00.000Z"],
      }),
    ).toEqual({ bound: "exact", count: 0 });
  });

  it("says a floor when the walk reaches its cap", () => {
    expect(
      unrunSlotsOf({
        cadence: "* * * * *",
        nowIso: "2026-10-10T00:00:00.000Z",
        slotIsos: ["2026-10-09T00:00:00.000Z"],
      }),
    ).toEqual({ bound: "at-least", count: 1001 });
  });

  it("counts a time at the cap that a later time at or before now proves went by", () => {
    // Every minute 00:00..16:40 ran; 16:41 went by unrun, which 16:42 proves; 16:42 is still pending at the cap.
    const ran = Array.from({ length: 1001 }, (_, minute) =>
      new Date(Date.parse("2026-10-01T00:00:00.000Z") + minute * 60_000).toISOString(),
    );
    expect(unrunSlotsOf({ cadence: "* * * * *", nowIso: "2026-10-01T16:42:30.000Z", slotIsos: ran })).toEqual({
      bound: "at-least",
      count: 1,
    });
  });

  it("never drops a counted time at the cap when a recorded time lies past it", () => {
    // 00:01..16:40 are 1000 unrun; 16:41 ran, and 16:42 proves it went by.
    expect(
      unrunSlotsOf({
        cadence: "* * * * *",
        nowIso: "2026-10-02T00:00:00.000Z",
        slotIsos: ["2026-10-01T00:00:00.000Z", "2026-10-01T16:41:00.000Z"],
      }),
    ).toEqual({ bound: "at-least", count: 1000 });
  });

  it("is a whole count when the cap lands on the time now due", () => {
    // The 1000th counted time, 16:40, is due; the next, 16:41, is after now.
    expect(
      unrunSlotsOf({
        cadence: "* * * * *",
        nowIso: "2026-10-01T16:40:30.000Z",
        slotIsos: ["2026-10-01T00:00:00.000Z"],
      }),
    ).toEqual({ bound: "exact", count: 999 });
  });

  it("counts nothing without a recorded firing or a cadence that parses", () => {
    expect([
      unrunSlotsOf({ cadence: "0 * * * *", nowIso: "2026-10-09T05:00:00.000Z", slotIsos: [] }),
      unrunSlotsOf({
        cadence: "not a cron",
        nowIso: "2026-10-09T05:00:00.000Z",
        slotIsos: ["2026-10-09T00:00:00.000Z"],
      }),
    ]).toEqual([null, null]);
  });
});
