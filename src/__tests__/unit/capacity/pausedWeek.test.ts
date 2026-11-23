/**
 * `pausedWeekOf`: a paused plan's week read out of the `machine capacity` document in force at its pause — exactly
 * that plan's `seven-day` window, or a named reason when the document cannot give it.
 */
import { describe, expect, it } from "vitest";

import { pausedWeekOf } from "../../../capacity/pausedWeek.js";

const READ_AT = "2026-10-09T07:05:00.000Z";

/** A machine ceiling, which every capacity reading carries exactly once. */
const MACHINE = {
  headroom: 0.5,
  id: "machine",
  kind: "machine",
  reason: null,
  status: "open",
  windows: [{ available: 22, resetAtIso: null, used: 11, window: "load1" }],
};

/** One whole earlier `machine capacity --json` document carrying these ceilings. */
function document({ ceilings }: { ceilings: readonly unknown[] }): unknown {
  return {
    ceilings: { ceilings, lowest: null, observedAtIso: READ_AT, problems: [], routes: [], selectedRoute: null },
    verdict: "machine capacity: ok",
  };
}

/** plan-two read open, its week 80% used and resetting at the fixture reset instant. */
const PLAN_TWO_OPEN = {
  headroom: 0.2,
  id: "claude:plan-two",
  kind: "claude",
  reason: null,
  status: "open",
  windows: [
    { available: 100, resetAtIso: "2026-10-09T09:00:00.000Z", used: 12, window: "five-hour" },
    { available: 100, resetAtIso: "2026-10-10T22:00:00.000Z", used: 80, window: "seven-day" },
  ],
};

describe("pausedWeekOf", () => {
  it("reads the plan's seven-day window and the earlier reading's own instant", () => {
    expect(pausedWeekOf({ alias: "plan-two", document: document({ ceilings: [MACHINE, PLAN_TWO_OPEN] }) })).toEqual({
      available: 100,
      kind: "read",
      readAtIso: READ_AT,
      resetAtIso: "2026-10-10T22:00:00.000Z",
      used: 80,
    });
  });

  it("says the earlier reading carried no such plan", () => {
    expect(pausedWeekOf({ alias: "plan-nine", document: document({ ceilings: [MACHINE, PLAN_TWO_OPEN] }) })).toEqual({
      kind: "unavailable",
      why: "the reading before the pause carried no plan-nine",
    });
  });

  it("says the plan had no week then, naming its status — already paused, say", () => {
    const paused = { ...PLAN_TWO_OPEN, headroom: 0, reason: "paused — earlier", status: "paused", windows: [] };
    expect(pausedWeekOf({ alias: "plan-two", document: document({ ceilings: [MACHINE, paused] }) })).toEqual({
      kind: "unavailable",
      why: "the reading before the pause carried no week for plan-two (paused)",
    });
  });

  it("refuses a document from before the ceilings field, and one whose ceilings will not read", () => {
    expect(pausedWeekOf({ alias: "plan-two", document: { verdict: "machine capacity: ok" } })).toEqual({
      kind: "unavailable",
      why: "the reading before the pause predates the plans' ceilings",
    });
    expect(pausedWeekOf({ alias: "plan-two", document: document({ ceilings: [PLAN_TWO_OPEN] }) })).toEqual({
      kind: "unavailable",
      why: "the plans' ceilings in the reading before the pause did not read",
    });
  });
});
