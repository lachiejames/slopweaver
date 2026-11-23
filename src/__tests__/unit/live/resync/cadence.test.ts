import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { cadenceNote, deriveResyncCadence } from "../../../../live/resync/cadence.js";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe("deriveResyncCadence", () => {
  it("turns the four-hour default every atlas declares into a four-hourly cron", () => {
    const cadence = deriveResyncCadence({ windowMs: 4 * HOUR });
    expect(cadence.isOk()).toBe(true);
    expect(unwrap(cadence)).toBe("0 */4 * * *");
  });

  it("caps a window longer than a day at daily rather than stepping the day-of-month field", () => {
    const cadence = deriveResyncCadence({ windowMs: 2 * 24 * HOUR });
    expect(cadence.isOk()).toBe(true);
    expect(unwrap(cadence)).toBe("0 0 * * *");
  });

  it("keeps a window just short of a week on daily rather than stepping the day-of-month field", () => {
    expect(unwrap(deriveResyncCadence({ windowMs: 6 * 24 * HOUR }))).toBe("0 0 * * *");
    expect(unwrap(deriveResyncCadence({ windowMs: 36 * HOUR }))).toBe("0 0 * * *");
  });

  it("turns a window of a week or more into a weekly cron on the day-of-week field", () => {
    expect(unwrap(deriveResyncCadence({ windowMs: 7 * 24 * HOUR }))).toBe("0 0 * * 0");
    expect(unwrap(deriveResyncCadence({ windowMs: 14 * 24 * HOUR }))).toBe("0 0 * * 0");
    expect(unwrap(deriveResyncCadence({ windowMs: 90 * 24 * HOUR }))).toBe("0 0 * * 0");
  });

  it("spells a whole day as midnight rather than a twenty-four-hour step", () => {
    expect(unwrap(deriveResyncCadence({ windowMs: 24 * HOUR }))).toBe("0 0 * * *");
  });

  it("picks the largest hour that divides a day, so every firing is evenly spaced", () => {
    expect(unwrap(deriveResyncCadence({ windowMs: 5 * HOUR }))).toBe("0 */4 * * *");
    expect(unwrap(deriveResyncCadence({ windowMs: 7 * HOUR }))).toBe("0 */6 * * *");
    expect(unwrap(deriveResyncCadence({ windowMs: 23 * HOUR }))).toBe("0 */12 * * *");
  });

  it("picks the largest minute that divides an hour for a sub-hour window", () => {
    expect(unwrap(deriveResyncCadence({ windowMs: 45 * MINUTE }))).toBe("*/30 * * * *");
    expect(unwrap(deriveResyncCadence({ windowMs: 7 * MINUTE }))).toBe("*/6 * * * *");
    expect(unwrap(deriveResyncCadence({ windowMs: MINUTE }))).toBe("*/1 * * * *");
  });

  it("refuses a window finer than a five-field cron can express", () => {
    const cadence = deriveResyncCadence({ windowMs: 30_000 });
    expect(cadence.isErr()).toBe(true);
    expect(cadence._unsafeUnwrapErr()[0]).toContain("the finest a five-field cron expresses is one minute");
  });

  it("refuses a window that is not a finite number of milliseconds", () => {
    expect(unwrapErr(deriveResyncCadence({ windowMs: Number.NaN }))).toEqual([
      "a freshness window of NaNms cannot become a cron cadence — the finest a five-field cron expresses " +
        "is one minute, and a window shorter than that would schedule a resync it can never keep up with",
    ]);
    expect(unwrapErr(deriveResyncCadence({ windowMs: Number.POSITIVE_INFINITY }))).toEqual([
      "a freshness window of Infinityms cannot become a cron cadence — the finest a five-field cron " +
        "expresses is one minute, and a window shorter than that would schedule a resync it can never keep up with",
    ]);
  });
});

describe("cadenceNote", () => {
  it("says so when a capped cadence resyncs more often than the window asked for", () => {
    const note = cadenceNote({ cadence: "0 0 * * *", windowMs: 2 * 24 * HOUR });
    expect(note).toBe(
      "declares a 2d window and is scheduled daily — a five-field cron cannot express a period between " +
        "a day and a week without the day-of-month field lying about its interval, so it resyncs more " +
        "often than it asks to",
    );
  });

  it("says so when a weekly cadence resyncs more often than a longer window asked for", () => {
    expect(cadenceNote({ cadence: "0 0 * * 0", windowMs: 14 * 24 * HOUR })).toBe(
      "declares a 14d window and is scheduled weekly — weekly is the coarsest period a five-field cron " +
        "expresses honestly, so it resyncs more often than it asks to",
    );
  });

  it("says nothing when the cadence matches the window's own period", () => {
    expect(cadenceNote({ cadence: "0 */4 * * *", windowMs: 4 * HOUR })).toBe(null);
    expect(cadenceNote({ cadence: "0 0 * * *", windowMs: 24 * HOUR })).toBe(null);
    expect(cadenceNote({ cadence: "0 0 * * 0", windowMs: 7 * 24 * HOUR })).toBe(null);
  });
});
