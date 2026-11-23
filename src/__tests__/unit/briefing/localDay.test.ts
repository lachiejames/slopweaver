/**
 * The briefing's day boundary, pinned rather than trusted.
 *
 * Every instant below was checked against Node's own `Australia/Melbourne` data. The two DST cases are why
 * this is a module and not a subtraction: on the autumn changeover the local clock repeats 02:00–02:59 and on the spring
 * changeover it skips 02:00–02:59, so a fixed +10 or +11 offset is wrong twice a year — and wrong in the
 * direction that silently moves a tick into the wrong fold of the owner's page.
 */
import { describe, expect, it } from "vitest";

import { BRIEFING_TIME_ZONE, localDayKey } from "../../../briefing/localDay.js";

describe("localDayKey", () => {
  it("names the zone the page is read in", () => {
    expect(BRIEFING_TIME_ZONE).toBe("Australia/Melbourne");
  });

  it("rolls the day at winter midnight, which is 14:00Z", () => {
    expect(localDayKey({ iso: "2026-06-30T13:59:59.000Z" })).toBe("2026-06-30");
    expect(localDayKey({ iso: "2026-06-30T14:00:00.000Z" })).toBe("2026-07-01");
  });

  it("rolls the day at summer midnight, which is 13:00Z", () => {
    expect(localDayKey({ iso: "2026-12-31T12:59:59.000Z" })).toBe("2026-12-31");
    expect(localDayKey({ iso: "2026-12-31T13:00:00.000Z" })).toBe("2027-01-01");
  });

  it("keeps both sides of the April rollback on the same local day", () => {
    expect(localDayKey({ iso: "2026-04-04T15:59:59.000Z" })).toBe("2026-04-05");
    expect(localDayKey({ iso: "2026-04-04T16:00:00.000Z" })).toBe("2026-04-05");
  });

  it("keeps both sides of the October jump on the same local day", () => {
    expect(localDayKey({ iso: "2026-10-03T15:59:59.000Z" })).toBe("2026-10-04");
    expect(localDayKey({ iso: "2026-10-03T16:00:00.000Z" })).toBe("2026-10-04");
  });

  it("puts a UTC-morning sweep on the owner's own day rather than the machine's", () => {
    // 09:30 Melbourne falls on the previous UTC day. A UTC key would fold the owner's whole morning
    // under the previous day.
    expect(localDayKey({ iso: "2026-09-09T23:30:00.000Z" })).toBe("2026-09-10");
  });

  it("answers the empty string for an instant it cannot read, rather than a plausible day", () => {
    expect(localDayKey({ iso: "not an instant" })).toBe("");
  });
});
