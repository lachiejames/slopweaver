/*
 * How long a triage card's clock runs: the minutes the owner named, else ten on a briefing and two on any other card.
 */
import { describe, expect, it } from "vitest";

import { clockLengthWords, clockMinutesValid, triageClockLengthMs } from "../../lib/triageWalkClock";

describe("triageClockLengthMs", () => {
  it("gives a card two minutes and a briefing ten when the owner named none", () => {
    expect([
      triageClockLengthMs({ briefing: false, minutes: undefined }),
      triageClockLengthMs({ briefing: true, minutes: undefined }),
    ]).toEqual([120_000, 600_000]);
  });

  it("gives the minutes the owner named, briefing or not", () => {
    expect([
      triageClockLengthMs({ briefing: false, minutes: 10 }),
      triageClockLengthMs({ briefing: true, minutes: 1 }),
    ]).toEqual([600_000, 60_000]);
  });
});

describe("clockLengthWords", () => {
  it("says one minute singular and every other length plural", () => {
    expect([
      clockLengthWords({ lengthMs: 60_000 }),
      clockLengthWords({ lengthMs: 120_000 }),
      clockLengthWords({ lengthMs: 600_000 }),
    ]).toEqual(["1 minute", "2 minutes", "10 minutes"]);
  });
});

describe("clockMinutesValid", () => {
  it("takes a whole number from 1 to 120 and nothing else", () => {
    expect([1, 120, 0, 121, 2.5, "10", undefined].map((minutes) => clockMinutesValid(minutes))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
