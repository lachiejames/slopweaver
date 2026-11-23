import { describe, expect, it } from "vitest";
import { parseDuration, renderAge, renderDuration } from "../../../lib/duration.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("parseDuration", () => {
  it("reads minutes, hours and days", () => {
    expect([parseDuration({ value: "30m" }), parseDuration({ value: "4h" }), parseDuration({ value: "7d" })]).toEqual([
      { ms: 30 * MINUTE },
      { ms: 4 * HOUR },
      { ms: 7 * DAY },
    ]);
  });

  it("reads a fractional amount", () => {
    expect(parseDuration({ value: "1.5h" })).toEqual({ ms: 90 * MINUTE });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDuration({ value: "  4h " })).toEqual({ ms: 4 * HOUR });
  });

  it("REFUSES a bare number rather than guessing at its unit", () => {
    const parsed = parseDuration({ value: "4" });
    expect("error" in parsed).toBe(true);
    expect(parsed).toEqual({
      error:
        "must be a duration with a unit — `30m`, `4h` or `7d` — got `4`. A bare number is refused rather than guessed at.",
    });
  });

  it("refuses zero, which would make every source behind forever", () => {
    expect("error" in parseDuration({ value: "0h" })).toBe(true);
  });

  it("refuses a unit it does not know", () => {
    expect("error" in parseDuration({ value: "4w" })).toBe(true);
  });

  it("refuses a negative amount", () => {
    expect("error" in parseDuration({ value: "-4h" })).toBe(true);
  });

  it("refuses an empty value", () => {
    expect("error" in parseDuration({ value: "" })).toBe(true);
  });
});

describe("renderDuration", () => {
  it("reads back in the largest unit that divides exactly", () => {
    expect([
      renderDuration({ ms: 30 * MINUTE }),
      renderDuration({ ms: 4 * HOUR }),
      renderDuration({ ms: 7 * DAY }),
    ]).toEqual(["30m", "4h", "7d"]);
  });

  it("round-trips what a caller typed, so a tick asked for in hours reports in hours", () => {
    const parsed = parseDuration({ value: "4h" });
    expect("ms" in parsed).toBe(true);
    expect(renderDuration({ ms: (parsed as { ms: number }).ms })).toBe("4h");
  });

  it("falls to minutes for a span no larger unit divides", () => {
    expect(renderDuration({ ms: 90 * MINUTE })).toBe("90m");
  });
});

describe("renderAge", () => {
  it("reads an arbitrary span the way a person would, not in exact units", () => {
    // 1,924 minutes divides exactly into no larger unit, which is where the exact renderer says `1924m`.
    expect([renderAge({ ms: 1924 * MINUTE }), renderDuration({ ms: 1924 * MINUTE })]).toEqual(["1.3d", "1924m"]);
  });

  it("uses hours for a span under a day", () => {
    expect(renderAge({ ms: 200 * MINUTE })).toBe("3.3h");
  });

  it("uses minutes for a span under an hour", () => {
    expect(renderAge({ ms: 45 * MINUTE })).toBe("45.0m");
  });
});
