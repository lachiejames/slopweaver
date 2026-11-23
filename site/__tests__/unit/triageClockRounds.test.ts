import { describe, expect, it } from "vitest";

import { TriageClockRounds } from "../../lib/triageClockRounds";

describe("TriageClockRounds", () => {
  it("holds the round a clock was armed in until something arms or stops it", () => {
    const rounds = new TriageClockRounds();
    const round = rounds.arm();
    expect(rounds.holds({ round })).toBe(true);
  });

  it("ends a round already posting the due line once the clock is stopped, as opening another card does", () => {
    const rounds = new TriageClockRounds();
    const posting = rounds.arm();
    rounds.stop();
    expect(rounds.holds({ round: posting })).toBe(false);
  });

  it("ends an earlier round when the next card arms its own clock, and holds only the new one", () => {
    const rounds = new TriageClockRounds();
    const first = rounds.arm();
    const second = rounds.arm();
    expect([rounds.holds({ round: first }), rounds.holds({ round: second })]).toEqual([false, true]);
  });
});
