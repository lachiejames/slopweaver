import { describe, expect, it } from "vitest";
import {
  clampIsoToClock,
  compareIsoInstants,
  epochSecondsToIso,
  parseIsoMs,
  parseStrictIsoInstantMs,
  parseYyyyMmDdUtcMs,
  yyyyMmDdMinusDays,
  yyyyMmDdTodayPlus,
  yyyyMmDdToEpochSeconds,
} from "../../../lib/date.js";

const FIXED_NOW = new Date("2026-07-19T13:45:00Z");

describe("yyyyMmDdTodayPlus", () => {
  it("returns today for a zero offset", () => {
    expect(yyyyMmDdTodayPlus({ days: 0, now: FIXED_NOW })).toBe("2026-07-19");
  });

  it("adds days", () => {
    expect(yyyyMmDdTodayPlus({ days: 1, now: FIXED_NOW })).toBe("2026-07-20");
  });

  it("subtracts days for a negative offset", () => {
    expect(yyyyMmDdTodayPlus({ days: -1, now: FIXED_NOW })).toBe("2026-07-18");
  });

  it("does not mutate the injected date", () => {
    yyyyMmDdTodayPlus({ days: 30, now: FIXED_NOW });
    expect(FIXED_NOW.toISOString()).toBe("2026-07-19T13:45:00.000Z");
  });
});

describe("yyyyMmDdMinusDays", () => {
  it("crosses a month boundary", () => {
    expect(yyyyMmDdMinusDays({ date: "2026-03-01", days: 1 })).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(yyyyMmDdMinusDays({ date: "2026-01-01", days: 1 })).toBe("2025-12-31");
  });
});

describe("parseYyyyMmDdUtcMs", () => {
  it("returns UTC-midnight ms for a valid date", () => {
    expect(parseYyyyMmDdUtcMs({ date: "1970-01-02" })).toBe(86_400_000);
  });

  it("returns undefined for an unparseable date", () => {
    expect(parseYyyyMmDdUtcMs({ date: "not-a-date" })).toBeUndefined();
  });
});

describe("yyyyMmDdToEpochSeconds", () => {
  it("returns floored epoch seconds at UTC midnight", () => {
    expect(yyyyMmDdToEpochSeconds({ date: "1970-01-02" })).toBe(86_400);
  });

  it("returns undefined for an unparseable date", () => {
    expect(yyyyMmDdToEpochSeconds({ date: "xyz" })).toBeUndefined();
  });
});

describe("parseIsoMs", () => {
  it("returns ms for a valid ISO timestamp", () => {
    expect(parseIsoMs({ tsIso: "1970-01-01T00:00:01.000Z" })).toBe(1000);
  });

  it("returns undefined for an invalid timestamp", () => {
    expect(parseIsoMs({ tsIso: "nonsense" })).toBeUndefined();
  });
});

describe("compareIsoInstants", () => {
  it("orders two instants inside one millisecond, where Date.parse reads them equal", () => {
    expect(Date.parse("2026-11-27T10:00:00.000200Z")).toBe(Date.parse("2026-11-27T10:00:00.000500Z"));
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00.000200Z", right: "2026-11-27T10:00:00.000500Z" })).toBe(-1);
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00.000500Z", right: "2026-11-27T10:00:00.000200Z" })).toBe(1);
  });

  it("orders by the milliseconds first, whatever the finer digits say", () => {
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00.001Z", right: "2026-11-27T10:00:00.000999Z" })).toBe(1);
  });

  it("keeps digits past the nanosecond, since a rollout instant may carry any number", () => {
    expect(
      compareIsoInstants({ left: "2026-11-27T10:00:00.0000000001Z", right: "2026-11-27T10:00:00.0000000002Z" }),
    ).toBe(-1);
  });

  it("reads the same instant written in two offsets, or with and without a zero fraction, as equal", () => {
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00.000500Z", right: "2026-11-27T20:00:00.000500+10:00" })).toBe(
      0,
    );
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00Z", right: "2026-11-27T10:00:00.000000Z" })).toBe(0);
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00.0005Z", right: "2026-11-27T10:00:00.000500Z" })).toBe(0);
  });

  it("reads a string Date.parse accepts that is not an ISO-8601 date-time to the millisecond only", () => {
    expect(compareIsoInstants({ left: "2020-01-01 10:20:3.1234Z", right: "2020-01-01 10:20:3.1235Z" })).toBe(0);
    expect(
      compareIsoInstants({ left: "1970-01-01T00:00:00.000Z", right: "Thu Jan 01 1970 00:00:00 GMT+0000 (x:12.3456)" }),
    ).toBe(0);
  });

  it("orders inside one millisecond with a space separator, lowercase zone or compact offset", () => {
    expect(compareIsoInstants({ left: "2026-11-27 10:00:00.000200z", right: "2026-11-27T10:00:00.000500Z" })).toBe(-1);
    expect(compareIsoInstants({ left: "2026-11-27T20:00:00.000500+1000", right: "2026-11-27T10:00:00.000200Z" })).toBe(
      1,
    );
  });

  it("answers undefined when either side will not parse", () => {
    expect(compareIsoInstants({ left: "not a time", right: "2026-11-27T10:00:00Z" })).toBeUndefined();
    expect(compareIsoInstants({ left: "2026-11-27T10:00:00Z", right: "" })).toBeUndefined();
  });
});

describe("parseStrictIsoInstantMs", () => {
  it("reads a Z instant, a short fraction and an offset as the same instant", () => {
    expect([
      parseStrictIsoInstantMs({ text: "2026-10-07T05:52:56.000Z" }),
      parseStrictIsoInstantMs({ text: "2026-10-07T05:52:56Z" }),
      parseStrictIsoInstantMs({ text: "2026-10-07T05:52:56.5Z" }),
      parseStrictIsoInstantMs({ text: "2026-10-07T16:52:56+11:00" }),
      parseStrictIsoInstantMs({ text: "2026-10-07T00:22:56-05:30" }),
    ]).toEqual([1_791_352_376_000, 1_791_352_376_000, 1_791_352_376_500, 1_791_352_376_000, 1_791_352_376_000]);
  });

  it("reads a year 0–99 as itself, as Date.parse does, never as 1900–1999", () => {
    expect(parseStrictIsoInstantMs({ text: "0099-01-01T00:00:00.000Z" })).toBe(Date.parse("0099-01-01T00:00:00.000Z"));
  });

  it("refuses every string Date.parse would guess at", () => {
    expect(
      [
        "0",
        "2026-10-07",
        "2026-10-07T05:52:56",
        "2026-10-07T05:52:56.000900Z",
        "2026-02-30T00:00:00Z",
        "2026-13-01T00:00:00Z",
        "2026-10-07T24:00:00Z",
        "2026-10-07T05:52:56+24:00",
        "October 7, 2026",
        " 2026-10-07T05:52:56Z",
      ].map((text) => parseStrictIsoInstantMs({ text })),
    ).toEqual(Array.from({ length: 10 }, () => undefined));
  });
});

describe("epochSecondsToIso", () => {
  it("scales whole seconds by exactly 1000 for a known epoch", () => {
    expect(epochSecondsToIso({ seconds: 1_700_000_000 })).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns the epoch itself for zero", () => {
    expect(epochSecondsToIso({ seconds: 0 })).toBe("1970-01-01T00:00:00.000Z");
  });

  it("reads a negative second count as a pre-epoch instant", () => {
    expect(epochSecondsToIso({ seconds: -1_000_000_000 })).toBe("1938-04-24T22:13:20.000Z");
  });

  it("keeps the sub-second part of a fractional second", () => {
    expect(epochSecondsToIso({ seconds: 1_700_000_000.5 })).toBe("2023-11-14T22:13:20.500Z");
  });

  it("converts the largest second count ECMAScript can represent as a Date", () => {
    expect(epochSecondsToIso({ seconds: 8.64e12 })).toBe("+275760-09-13T00:00:00.000Z");
  });

  it("returns undefined one second past that bound", () => {
    expect(epochSecondsToIso({ seconds: 8.64e12 + 1 })).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(epochSecondsToIso({ seconds: Number.NaN })).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(epochSecondsToIso({ seconds: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});

describe("clampIsoToClock", () => {
  it("returns the clock when the timestamp is ahead of it", () => {
    expect(clampIsoToClock({ nowIso: "2026-09-17T23:51:00Z", tsIso: "2026-09-18" })).toBe("2026-09-17T23:51:00Z");
  });

  it("leaves a timestamp behind the clock untouched", () => {
    expect(clampIsoToClock({ nowIso: "2026-09-17T23:51:00Z", tsIso: "2026-09-16T08:00:00Z" })).toBe(
      "2026-09-16T08:00:00Z",
    );
  });

  it("compares the two INSTANTS, not their strings — a bare day equals its own midnight", () => {
    expect(clampIsoToClock({ nowIso: "2026-09-17T00:00:00Z", tsIso: "2026-09-17" })).toBe("2026-09-17");
  });

  it("clamps nothing when the clock is unparseable", () => {
    expect(clampIsoToClock({ nowIso: "not-an-instant", tsIso: "2026-09-18" })).toBe("2026-09-18");
  });

  it("clamps nothing when the timestamp is unparseable", () => {
    expect(clampIsoToClock({ nowIso: "2026-09-17T23:51:00Z", tsIso: "" })).toBe("");
  });
});
