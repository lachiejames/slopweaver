/**
 * The eyebrow's stamp: a supplied instant written in ISO order on Melbourne's clock with the zone named, so
 * the same zone reads AEDT in summer and AEST in winter, every stamp matches the shape the gate reads back,
 * and an unparseable instant throws rather than degrading to a plausible string.
 */
import { describe, expect, it } from "vitest";

import { MELBOURNE_STAMP, stampMelbourne } from "../../../../outbound/briefing/stamp.js";

describe("stampMelbourne", () => {
  it("writes a January instant on Melbourne's daylight-saving clock as AEDT", () => {
    expect(stampMelbourne({ iso: "2026-01-15T00:00:00.000Z" })).toBe("2026-01-15 11:00:00 AEDT");
  });

  it("writes a July instant on Melbourne's standard clock as AEST", () => {
    expect(stampMelbourne({ iso: "2026-07-15T00:00:00.000Z" })).toBe("2026-07-15 10:00:00 AEST");
  });

  it("rolls the date over when Melbourne is already in the next day", () => {
    expect(stampMelbourne({ iso: "2026-07-15T19:07:42.000Z" })).toBe("2026-07-16 05:07:42 AEST");
  });

  it("produces stamps the gate's MELBOURNE_STAMP recognises, and that pattern refuses a locale-ordered date", () => {
    expect(MELBOURNE_STAMP.test(stampMelbourne({ iso: "2026-01-15T00:00:00.000Z" }))).toBe(true);
    expect(MELBOURNE_STAMP.test(stampMelbourne({ iso: "2026-07-15T00:00:00.000Z" }))).toBe(true);
    expect(MELBOURNE_STAMP.test("15/07/2026, 10:00:00 AEST")).toBe(false);
  });

  it("throws on an unparseable instant", () => {
    expect(() => stampMelbourne({ iso: "not an instant" })).toThrow(RangeError);
  });
});
