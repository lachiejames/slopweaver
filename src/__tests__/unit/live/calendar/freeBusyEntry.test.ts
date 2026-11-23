/**
 * Unit: one calendar's free/busy entry read apart — the errors Google raised and its busy periods — including
 * the entry Google answered with nothing in it, which must read as answered and empty, never as refused.
 */
import { describe, expect, it } from "vitest";
import { busyPeriods, freeBusyErrorReasons } from "../../../../live/calendar/freeBusyEntry.js";

describe("freeBusyErrorReasons", () => {
  it("is empty for an entry carrying no errors, omitted or an empty list", () => {
    expect([freeBusyErrorReasons({ entry: {} }), freeBusyErrorReasons({ entry: { errors: [] } })]).toStrictEqual([
      [],
      [],
    ]);
  });

  it("names each error's reason in Google's order, and an error with no reason as unknown", () => {
    expect(
      freeBusyErrorReasons({
        entry: {
          errors: [
            { domain: "global", reason: "notFound" },
            { domain: "calendar", reason: null },
            { domain: "calendar" },
            { domain: "global", reason: "groupTooBig" },
          ],
        },
      }),
    ).toStrictEqual(["notFound", "unknown", "unknown", "groupTooBig"]);
  });
});

describe("busyPeriods", () => {
  it("is empty for an entry with no busy key", () => {
    expect(busyPeriods({ entry: {} })).toStrictEqual([]);
  });

  it("reads each period as epoch-millisecond bounds, unmerged and in Google's order", () => {
    expect(
      busyPeriods({
        entry: {
          busy: [
            { end: "2026-09-14T01:30:00Z", start: "2026-09-14T00:30:00Z" },
            { end: "2026-09-14T01:00:00Z", start: "2026-09-14T00:00:00Z" },
          ],
        },
      }),
    ).toStrictEqual([
      { endMs: Date.parse("2026-09-14T01:30:00Z"), startMs: Date.parse("2026-09-14T00:30:00Z") },
      { endMs: Date.parse("2026-09-14T01:00:00Z"), startMs: Date.parse("2026-09-14T00:00:00Z") },
    ]);
  });

  it("leaves out a period missing a bound or carrying one that is not an instant", () => {
    expect(
      busyPeriods({
        entry: {
          busy: [
            { start: "2026-09-14T00:00:00Z" },
            { end: null, start: "2026-09-14T00:00:00Z" },
            { end: "not a time", start: "2026-09-14T00:00:00Z" },
          ],
        },
      }),
    ).toStrictEqual([]);
  });
});
