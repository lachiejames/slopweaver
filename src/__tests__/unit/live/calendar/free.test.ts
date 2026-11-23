/**
 * Unit: the availability arithmetic behind `calendar free` — merging, gaps, clipping to local hours across a
 * DST edge, the meeting-length filter, the window snap, and the document builder against a plain fake.
 */
import { describe, expect, it } from "vitest";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  clipToDailyHours,
  gapsWithin,
  mergeIntervals,
  parseAvailability,
  readCalendarFree,
  slotsOfAtLeast,
  snapWindowToLocalDays,
} from "../../../../live/calendar/free.js";
import type { CalendarFreeBusyApi } from "../../../../live/calendar/freeApi.js";
import { parseDailyHours, renderInZone, renderMinute } from "../../../../live/calendar/wallClockText.js";
import { localMidnightOfUtcDate, localMinuteToMs, zoneOffsetMs } from "../../../../live/calendar/zoneClock.js";

const T = ({ iso }: { iso: string }): number => Date.parse(iso);

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals and drops empty ones", () => {
    expect(
      mergeIntervals({
        intervals: [
          { endMs: 30, startMs: 20 },
          { endMs: 10, startMs: 0 },
          { endMs: 20, startMs: 10 },
          { endMs: 5, startMs: 5 },
          { endMs: 50, startMs: 40 },
        ],
      }),
    ).toStrictEqual([
      { endMs: 30, startMs: 0 },
      { endMs: 50, startMs: 40 },
    ]);
  });
});

describe("gapsWithin", () => {
  it("returns the open stretches inside the window, ignoring busy time outside it", () => {
    expect(
      gapsWithin({
        busy: [
          { endMs: 5, startMs: -10 },
          { endMs: 30, startMs: 20 },
          { endMs: 200, startMs: 90 },
        ],
        window: { endMs: 100, startMs: 0 },
      }),
    ).toStrictEqual([
      { endMs: 20, startMs: 5 },
      { endMs: 90, startMs: 30 },
    ]);
  });

  it("is the whole window when nothing is busy", () => {
    expect(gapsWithin({ busy: [], window: { endMs: 100, startMs: 0 } })).toStrictEqual([{ endMs: 100, startMs: 0 }]);
  });

  it("is empty when a busy interval covers the window", () => {
    expect(gapsWithin({ busy: [{ endMs: 100, startMs: 0 }], window: { endMs: 100, startMs: 0 } })).toStrictEqual([]);
  });
});

describe("zone arithmetic", () => {
  it("reads Melbourne as +10:00 in September and +11:00 in November", () => {
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-09-14T00:00:00Z" }), zone: "Australia/Melbourne" })).toBe(
      10 * 3_600_000,
    );
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-11-14T00:00:00Z" }), zone: "Australia/Melbourne" })).toBe(
      11 * 3_600_000,
    );
    expect(zoneOffsetMs({ atMs: 0, zone: "Not/AZone" })).toBeUndefined();
  });

  it("puts 09:00 local on the right instant either side of the DST transition (spring forward, 02:00 → 03:00)", () => {
    expect(
      localMinuteToMs({ dayMs: T({ iso: "2026-10-03T00:00:00Z" }), minute: 540, zone: "Australia/Melbourne" }),
    ).toBe(T({ iso: "2026-10-02T23:00:00Z" }));
    expect(
      localMinuteToMs({ dayMs: T({ iso: "2026-10-04T12:00:00Z" }), minute: 540, zone: "Australia/Melbourne" }),
    ).toBe(T({ iso: "2026-10-03T22:00:00Z" }));
  });

  it("resolves a wall-clock minute the spring-forward gap deletes to the TRANSITION, the first instant that exists", () => {
    // Melbourne on the spring-forward day: 02:00 local jumps to 03:00, so 02:30 does not exist. Backwards (01:30) hands
    // back an hour nobody asked for; an hour along (03:30) loses half an hour that does exist. 03:00 is the
    // first moment the clock reaches the request.
    const resolved = localMinuteToMs({
      dayMs: T({ iso: "2026-10-04T12:00:00Z" }),
      minute: 150,
      zone: "Australia/Melbourne",
    });
    expect(resolved).toBe(T({ iso: "2026-10-03T16:00:00Z" }));
    expect(renderInZone({ atMs: resolved!, zone: "Australia/Melbourne" })).toBe("2026-10-04 Sun 03:00");
  });

  it("clips to a window whose start the DST gap deletes without including time before it", () => {
    const gaps = [{ endMs: T({ iso: "2026-10-03T17:00:00Z" }), startMs: T({ iso: "2026-10-03T13:00:00Z" }) }];
    const clipped = clipToDailyHours({
      between: { endMinute: 240, startMinute: 150 },
      gaps,
      zone: "Australia/Melbourne",
    });
    expect(clipped).toStrictEqual([
      { endMs: T({ iso: "2026-10-03T17:00:00Z" }), startMs: T({ iso: "2026-10-03T16:00:00Z" }) },
    ]);
  });

  it("reads the 24:00 end-of-day boundary as the NEXT local midnight, not an hour into the next day", () => {
    // `--between 09:00-24:00` closes at minute 1440, which no clock ever reads, so the check is taken
    // modulo the day; across the spring-forward transition the close otherwise landed at 01:00 on the 5th.
    const close = localMinuteToMs({
      dayMs: T({ iso: "2026-10-04T12:00:00Z" }),
      minute: 1440,
      zone: "Australia/Melbourne",
    });
    expect(renderInZone({ atMs: close!, zone: "Australia/Melbourne" })).toBe("2026-10-05 Mon 00:00");
    expect(close).toBe(T({ iso: "2026-10-04T13:00:00Z" }));
  });

  it("resolves an AMBIGUOUS minute the fall-back repeats to its FIRST occurrence", () => {
    // Melbourne on the fall-back day: 03:00 local falls back to 02:00, so 02:30 happens twice — once at +11
    // and again an hour later at +10. The earlier one is the answer a reader means by "02:30".
    expect(
      localMinuteToMs({ dayMs: T({ iso: "2026-04-05T12:00:00Z" }), minute: 150, zone: "Australia/Melbourne" }),
    ).toBe(T({ iso: "2026-04-04T15:30:00Z" }));
  });

  it("anchors a UTC date's local midnight on the same date even fourteen hours east", () => {
    expect(localMidnightOfUtcDate({ utcDayMs: T({ iso: "2026-09-13T00:00:00Z" }), zone: "Pacific/Kiritimati" })).toBe(
      T({ iso: "2026-09-12T10:00:00Z" }),
    );
    expect(localMidnightOfUtcDate({ utcDayMs: T({ iso: "2026-09-13T00:00:00Z" }), zone: "America/Los_Angeles" })).toBe(
      T({ iso: "2026-09-13T07:00:00Z" }),
    );
  });

  it("snaps a UTC-day window to the same dates' local midnights, and leaves an unknown zone alone", () => {
    const window = { endMs: T({ iso: "2026-09-16T00:00:00Z" }), startMs: T({ iso: "2026-09-13T00:00:00Z" }) };
    expect(snapWindowToLocalDays({ window, zone: "Australia/Melbourne" })).toStrictEqual({
      endMs: T({ iso: "2026-09-15T14:00:00Z" }),
      startMs: T({ iso: "2026-09-12T14:00:00Z" }),
    });
    expect(snapWindowToLocalDays({ window, zone: "Not/AZone" })).toStrictEqual(window);
  });
});

describe("clipToDailyHours", () => {
  it("keeps only the 09:00–17:00 pieces of a two-day gap, in local time", () => {
    const gap = { endMs: T({ iso: "2026-09-15T14:00:00Z" }), startMs: T({ iso: "2026-09-13T14:00:00Z" }) };
    expect(
      clipToDailyHours({ between: { endMinute: 1020, startMinute: 540 }, gaps: [gap], zone: "Australia/Melbourne" }),
    ).toStrictEqual([
      { endMs: T({ iso: "2026-09-14T07:00:00Z" }), startMs: T({ iso: "2026-09-13T23:00:00Z" }) },
      { endMs: T({ iso: "2026-09-15T07:00:00Z" }), startMs: T({ iso: "2026-09-14T23:00:00Z" }) },
    ]);
  });

  it("passes gaps through untouched with no hours", () => {
    const gaps = [{ endMs: 10, startMs: 0 }];
    expect(clipToDailyHours({ between: undefined, gaps, zone: "UTC" })).toStrictEqual(gaps);
  });
});

describe("slotsOfAtLeast", () => {
  it("keeps gaps at least the meeting length, inclusive", () => {
    expect(
      slotsOfAtLeast({
        gaps: [
          { endMs: 29 * 60_000, startMs: 0 },
          { endMs: 30 * 60_000, startMs: 0 },
        ],
        minutes: 30,
      }),
    ).toStrictEqual([{ endMs: 30 * 60_000, startMs: 0 }]);
  });
});

describe("parseAvailability", () => {
  it("reads busy periods, merging them, and keeps Google's error reasons as a fact about the calendar", () => {
    expect(
      parseAvailability({
        calendarId: "a@x.test",
        entry: {
          busy: [
            { end: "2026-09-14T01:00:00Z", start: "2026-09-14T00:00:00Z" },
            { end: "2026-09-14T01:30:00Z", start: "2026-09-14T00:30:00Z" },
          ],
          errors: [{ domain: "global", reason: "notFound" }],
        },
      }),
    ).toStrictEqual({
      busy: [{ endMs: T({ iso: "2026-09-14T01:30:00Z" }), startMs: T({ iso: "2026-09-14T00:00:00Z" }) }],
      calendarId: "a@x.test",
      error: "notFound",
    });
  });

  it("still reads an error Google gave no reason for as a refusal, labelled unknown", () => {
    expect(
      parseAvailability({ calendarId: "a@x.test", entry: { errors: [{ domain: "global" }, { reason: "notFound" }] } }),
    ).toStrictEqual({ busy: [], calendarId: "a@x.test", error: "unknown, notFound" });
  });

  it("treats a calendar the response omitted as an error, never as free", () => {
    expect(parseAvailability({ calendarId: "gone@x.test", entry: undefined }).error).toBe(
      "the response carried no entry for this calendar",
    );
  });
});

describe("parseDailyHours / renderMinute / renderInZone", () => {
  it("round-trips HH:MM-HH:MM and refuses an out-of-range hour", () => {
    expect(parseDailyHours({ text: "09:00-17:30" })).toStrictEqual({ endMinute: 1050, startMinute: 540 });
    expect(parseDailyHours({ text: "09:00-24:00" })).toStrictEqual({ endMinute: 1440, startMinute: 540 });
    expect(parseDailyHours({ text: "25:00-26:00" })).toBeUndefined();
    expect(renderMinute({ minute: 1050 })).toBe("17:30");
  });

  it("renders an instant as local wall-clock text with the weekday", () => {
    expect(renderInZone({ atMs: T({ iso: "2026-09-14T23:00:00Z" }), zone: "Australia/Melbourne" })).toBe(
      "2026-09-15 Tue 09:00",
    );
    expect(renderInZone({ atMs: T({ iso: "2026-09-14T23:00:00Z" }), zone: "Not/AZone" })).toBe(
      "2026-09-14T23:00:00.000Z",
    );
  });
});

/** A fake seam that answers one fixed free/busy response and records the request it was given. */
function fakeApi({
  calendars,
  requests,
}: {
  calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { domain: string; reason: string }[] }>;
  requests: { calendarIds: readonly string[]; timeMinIso: string; timeMaxIso: string }[];
}): CalendarFreeBusyApi {
  return {
    queryFreeBusy: async (args) => {
      requests.push(args);
      return ok({ calendars });
    },
  };
}

describe("readCalendarFree", () => {
  it("asks Google for the local-day window and reports the common slots in the zone", async () => {
    const requests: { calendarIds: readonly string[]; timeMinIso: string; timeMaxIso: string }[] = [];
    const result = unwrap(
      await readCalendarFree({
        account: "me@x.test",
        api: fakeApi({
          calendars: {
            "a@x.test": { busy: [{ end: "2026-09-14T00:30:00Z", start: "2026-09-13T23:00:00Z" }] },
            primary: { busy: [{ end: "2026-09-14T02:00:00Z", start: "2026-09-14T01:00:00Z" }] },
          },
          requests,
        }),
        between: { endMinute: 720, startMinute: 540 },
        calendarIds: ["primary", "a@x.test"],
        minutes: 30,
        nowIso: () => "2026-09-13T01:00:00.000Z",
        timeMaxIso: "2026-09-15T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
        zone: "Australia/Melbourne",
        zoneEstablished: true,
      }),
    );
    expect(requests).toStrictEqual([
      {
        calendarIds: ["primary", "a@x.test"],
        timeMaxIso: "2026-09-14T14:00:00.000Z",
        timeMinIso: "2026-09-13T14:00:00.000Z",
      },
    ]);
    // Local day of the 14th, 09:00–12:00: busy 09:00–10:30 (a) and 11:00–12:00 (primary) leaves exactly 10:30–11:00.
    expect(result.free.slots).toStrictEqual([
      { endMs: T({ iso: "2026-09-14T01:00:00Z" }), startMs: T({ iso: "2026-09-14T00:30:00Z" }) },
    ]);
    expect(result.document.coverage.detail).toBe(
      "1 open stretch(es) of at least 30 min across 2 calendar(s) between 2026-09-14 Mon 00:00 and 2026-09-15 Tue 00:00 Australia/Melbourne",
    );
    expect(result.document.readAtIso).toBe("2026-09-13T01:00:00.000Z");
    expect(result.document.coverage.residue).toContain(
      "slots are clipped to 09:00–12:00 on each local day in Australia/Melbourne",
    );
  });

  it("makes common availability UNKNOWN when any calendar refused, and says which", async () => {
    const result = unwrap(
      await readCalendarFree({
        account: "me@x.test",
        api: fakeApi({
          calendars: { "b@x.test": { errors: [{ domain: "global", reason: "notFound" }] }, primary: { busy: [] } },
          requests: [],
        }),
        between: undefined,
        calendarIds: ["primary", "b@x.test"],
        minutes: 30,
        nowIso: () => "2026-09-13T01:00:00.000Z",
        timeMaxIso: "2026-09-15T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
        zone: "UTC",
        zoneEstablished: false,
      }),
    );
    expect(result.free.slots).toBeUndefined();
    expect(result.document.coverage.detail).toBe("common availability not established across 2 calendar(s)");
    expect(result.document.coverage.residue).toContain(
      "common availability is UNKNOWN: b@x.test (notFound) — a calendar that refused is not a free one",
    );
    expect(result.document.coverage.residue).toContain(
      "the account's own time zone was not established, so hours and rendering use UTC",
    );
  });

  it("refuses more calendars than one query may name, before calling Google", async () => {
    const requests: { calendarIds: readonly string[]; timeMinIso: string; timeMaxIso: string }[] = [];
    const error = unwrapErr(
      await readCalendarFree({
        account: "me@x.test",
        api: fakeApi({ calendars: {}, requests }),
        between: undefined,
        calendarIds: Array.from({ length: 51 }, (_, i) => `${String(i)}@x.test`),
        minutes: 30,
        nowIso: () => "2026-09-13T01:00:00.000Z",
        timeMaxIso: "2026-09-15T00:00:00.000Z",
        timeMinIso: "2026-09-14T00:00:00.000Z",
        zone: "UTC",
        zoneEstablished: true,
      }),
    );
    expect(error.code).toBe("API_FAILED");
    expect(error.message).toBe("free/busy takes at most 50 calendars in one read; 51 were named");
    expect(requests).toStrictEqual([]);
  });
});
