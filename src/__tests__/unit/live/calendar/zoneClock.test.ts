/**
 * Unit: the zone clock — a zone's offset at an instant, the instant a wall-clock minute names across both DST
 * edges, and a UTC date's local midnight, including the one instant the second offset pass cannot read.
 */
import { describe, expect, it } from "vitest";
import { renderInZone } from "../../../../live/calendar/wallClockText.js";
import { DAY_MS, localMidnightOfUtcDate, localMinuteToMs, zoneOffsetMs } from "../../../../live/calendar/zoneClock.js";

const T = ({ iso }: { iso: string }): number => Date.parse(iso);

/** The last instant a `Date` can hold, 8.64e15 ms after the epoch. */
const LAST_DATE_MS = 8_640_000_000_000_000;

describe("zoneOffsetMs", () => {
  it("reads Melbourne as +10:00 in September and +11:00 in November", () => {
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-09-14T00:00:00Z" }), zone: "Australia/Melbourne" })).toBe(
      10 * 3_600_000,
    );
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-11-14T00:00:00Z" }), zone: "Australia/Melbourne" })).toBe(
      11 * 3_600_000,
    );
    expect(zoneOffsetMs({ atMs: 0, zone: "Not/AZone" })).toBeUndefined();
  });

  it("reads a whole-second offset to the second, every one of the six fields counted", () => {
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-09-14T00:00:59.999Z" }), zone: "UTC" })).toBe(0);
    expect(zoneOffsetMs({ atMs: T({ iso: "2026-09-14T00:00:00Z" }), zone: "Asia/Kathmandu" })).toBe(
      5 * 3_600_000 + 45 * 60_000,
    );
  });

  it("is undefined for an instant no Date can hold, even in a zone Intl knows", () => {
    expect(zoneOffsetMs({ atMs: LAST_DATE_MS + DAY_MS, zone: "UTC" })).toBeUndefined();
  });
});

describe("localMinuteToMs", () => {
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

  it.each([
    { expected: "2026-04-04T15:00:00Z", minute: 120 },
    { expected: "2026-04-04T15:46:00Z", minute: 166 },
    { expected: "2026-04-04T15:59:00Z", minute: 179 },
  ])(
    "resolves repeated minute $minute to its first occurrence, wherever it sits in the repeated hour",
    ({ expected, minute }) => {
      // A bisection over the local clock lands on the SECOND occurrence for some of these, because the clock
      // steps back an hour at the fall-back and is not monotone across it.
      expect(localMinuteToMs({ dayMs: T({ iso: "2026-04-05T12:00:00Z" }), minute, zone: "Australia/Melbourne" })).toBe(
        T({ iso: expected }),
      );
    },
  );

  it("resolves the minute just after the repeated hour to the one instant it names", () => {
    expect(
      localMinuteToMs({ dayMs: T({ iso: "2026-04-05T12:00:00Z" }), minute: 180, zone: "Australia/Melbourne" }),
    ).toBe(T({ iso: "2026-04-04T17:00:00Z" }));
  });

  it("is undefined for a zone Intl does not know", () => {
    expect(localMinuteToMs({ dayMs: T({ iso: "2026-10-04T12:00:00Z" }), minute: 540, zone: "Not/AZone" })).toBe(
      undefined,
    );
  });
});

describe("localMidnightOfUtcDate", () => {
  it("anchors a UTC date's local midnight on the same date even fourteen hours east", () => {
    expect(localMidnightOfUtcDate({ utcDayMs: T({ iso: "2026-09-13T00:00:00Z" }), zone: "Pacific/Kiritimati" })).toBe(
      T({ iso: "2026-09-12T10:00:00Z" }),
    );
    expect(localMidnightOfUtcDate({ utcDayMs: T({ iso: "2026-09-13T00:00:00Z" }), zone: "America/Los_Angeles" })).toBe(
      T({ iso: "2026-09-13T07:00:00Z" }),
    );
  });

  it("is undefined for a zone Intl does not know", () => {
    expect(localMidnightOfUtcDate({ utcDayMs: T({ iso: "2026-09-13T00:00:00Z" }), zone: "Not/AZone" })).toBe(undefined);
  });

  it("keeps the first pass's guess when the guess is past the last instant a Date can hold", () => {
    // West of Greenwich the guess is LATER than the UTC midnight, so at the very last representable date it
    // falls off the end of the range: the second offset cannot be read, and the first offset stands.
    const firstOffset = zoneOffsetMs({ atMs: LAST_DATE_MS, zone: "America/Los_Angeles" })!;
    expect(firstOffset).toBeLessThan(0);
    expect(zoneOffsetMs({ atMs: LAST_DATE_MS - firstOffset, zone: "America/Los_Angeles" })).toBe(undefined);
    expect(localMidnightOfUtcDate({ utcDayMs: LAST_DATE_MS, zone: "America/Los_Angeles" })).toBe(
      LAST_DATE_MS - firstOffset,
    );
  });
});
