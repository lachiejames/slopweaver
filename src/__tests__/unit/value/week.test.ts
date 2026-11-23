/**
 * The ISO week a value sample files under: the week belongs to the year its Thursday falls in, so either end of
 * the calendar year can file under the neighbouring one.
 */
import { describe, expect, it } from "vitest";

import { isoWeekOfDay } from "../../../value/week.js";

describe("isoWeekOfDay", () => {
  it("files a Monday and the Sunday before it under consecutive weeks", () => {
    expect(isoWeekOfDay({ day: "2026-11-23" })).toBe("2026-W48");
    expect(isoWeekOfDay({ day: "2026-11-22" })).toBe("2026-W47");
  });

  it("files a day under the year its week's Thursday falls in, at both ends of the year", () => {
    expect(isoWeekOfDay({ day: "2024-12-30" })).toBe("2025-W01");
    expect(isoWeekOfDay({ day: "2026-01-01" })).toBe("2026-W01");
    expect(isoWeekOfDay({ day: "2027-01-03" })).toBe("2026-W53");
    expect(isoWeekOfDay({ day: "2027-01-04" })).toBe("2027-W01");
  });

  it("answers no week for a day that is not one", () => {
    expect(isoWeekOfDay({ day: "not-a-day" })).toBe(undefined);
    expect(isoWeekOfDay({ day: "2026-13-01" })).toBe(undefined);
    expect(isoWeekOfDay({ day: "2026-11-23T00:00:00Z" })).toBe(undefined);
  });
});
