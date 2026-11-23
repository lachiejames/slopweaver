/**
 * Which dry hours run together as one spell, and what ended it: a reset ends one, a last-five-hours lift only
 * reprieves it until that plan resets, and a spell still dry where following stops is `unended`.
 */
import { describe, expect, it } from "vitest";

import {
  type DrySpell,
  finishSpells,
  newSpellTracker,
  spellEndClause,
  spellRunning,
  trackHour,
} from "../../../claude/survivalSpells.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

const HOUR_MS = 3_600_000;
const WEEK_MS = 168 * HOUR_MS;
const T0 = Date.parse("2026-09-30T00:00:00.000Z");

/** An instant `hours` after {@link T0}. */
function at({ hours }: { hours: number }): number {
  return T0 + hours * HOUR_MS;
}

/** One plan as the tracker reads it after an hour's routing. */
function plan({
  alias,
  takenThisHour = 0,
  rolledAtMs,
  resetMs,
}: {
  alias: string;
  takenThisHour?: number;
  rolledAtMs?: number;
  resetMs: number;
}) {
  return { alias, resetMs, rolledAtMs, takenThisHour };
}

describe("trackHour", () => {
  it("closes a spell on the plan whose week rolled, at the instant it reset", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    const idle = [plan({ alias: "plan-one", resetMs: at({ hours: 2 }) })];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans: idle, tracker });
    trackHour({ atMs: at({ hours: 1 }), dry: true, mayOpen: true, plans: idle, tracker });
    const rolled = [
      plan({
        alias: "plan-one",
        resetMs: at({ hours: 2 }) + WEEK_MS,
        rolledAtMs: at({ hours: 2 }),
        takenThisHour: 0.1,
      }),
    ];
    trackHour({ atMs: at({ hours: 2 }), dry: false, mayOpen: true, plans: rolled, tracker });

    expect(spellRunning({ tracker })).toBe(false);
    expect(finishSpells({ plans: rolled, stoppedAtMs: at({ hours: 10 }), tracker })).toEqual([
      {
        endedAtIso: "2026-09-30T02:00:00.000Z",
        endedBy: "reset",
        endedByAlias: "plan-one",
        hours: 2,
        reliefHours: 0,
        startIso: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });

  it("rejoins dry hours that resume before the lifted plan resets into one spell, counting the reprieve", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    const lifted = [plan({ alias: "plan-two", resetMs: at({ hours: 4 }), takenThisHour: 0.02 })];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 1 }), dry: false, mayOpen: true, plans: lifted, tracker });
    expect(spellRunning({ tracker })).toBe(true);
    trackHour({ atMs: at({ hours: 2 }), dry: true, mayOpen: true, plans: lifted, tracker });
    const rolled = [
      plan({
        alias: "plan-two",
        resetMs: at({ hours: 4 }) + WEEK_MS,
        rolledAtMs: at({ hours: 4 }),
        takenThisHour: 0.1,
      }),
    ];
    trackHour({ atMs: at({ hours: 4 }), dry: false, mayOpen: true, plans: rolled, tracker });

    expect(finishSpells({ plans: rolled, stoppedAtMs: at({ hours: 10 }), tracker })).toEqual([
      {
        endedAtIso: "2026-09-30T04:00:00.000Z",
        endedBy: "reset",
        endedByAlias: "plan-two",
        hours: 2,
        reliefHours: 1,
        startIso: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });

  it("settles a reprieved spell as ended by the lift once its plan resets with no dry hour between", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    const lifted = [plan({ alias: "plan-two", resetMs: at({ hours: 3 }), takenThisHour: 0.02 })];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 1 }), dry: false, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 3 }), dry: false, mayOpen: true, plans: lifted, tracker });

    expect(spellRunning({ tracker })).toBe(false);
    expect(finishSpells({ plans: lifted, stoppedAtMs: at({ hours: 10 }), tracker })).toEqual([
      {
        endedAtIso: "2026-09-29T22:00:00.000Z",
        endedBy: "final-hours",
        endedByAlias: "plan-two",
        hours: 1,
        reliefHours: 0,
        startIso: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });

  it("dates a lift-ended spell from the install's spend-out window, not a fixed five hours", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: 2 * HOUR_MS });
    const lifted = [plan({ alias: "plan-two", resetMs: at({ hours: 3 }), takenThisHour: 0.02 })];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 1 }), dry: false, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 3 }), dry: false, mayOpen: true, plans: lifted, tracker });

    expect(
      finishSpells({ plans: lifted, stoppedAtMs: at({ hours: 10 }), tracker }).map((spell) => spell.endedAtIso),
    ).toEqual(["2026-09-30T01:00:00.000Z"]);
  });

  it("opens no new spell past the horizon, where only a running one is followed", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    trackHour({
      atMs: at({ hours: 0 }),
      dry: true,
      mayOpen: false,
      plans: [plan({ alias: "plan-one", resetMs: at({ hours: 5 }) })],
      tracker,
    });

    expect(spellRunning({ tracker })).toBe(false);
  });
});

describe("finishSpells", () => {
  it("ends a spell still open as unended where following stopped, naming the next plan to reset", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    const plans = [
      plan({ alias: "plan-one", resetMs: at({ hours: 30 }) }),
      plan({ alias: "plan-three", resetMs: at({ hours: 20 }) }),
    ];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans, tracker });

    expect(finishSpells({ plans, stoppedAtMs: at({ hours: 10 }), tracker })).toEqual([
      {
        endedAtIso: "2026-09-30T10:00:00.000Z",
        endedBy: "unended",
        endedByAlias: "plan-three",
        hours: 1,
        reliefHours: 0,
        startIso: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });

  it("stands a reprieve still waiting when following stopped as ended by the lift", () => {
    const tracker = newSpellTracker({ spendOutBeforeResetMs: THRESHOLDS.spendOutBeforeResetMs });
    const lifted = [plan({ alias: "plan-two", resetMs: at({ hours: 40 }), takenThisHour: 0.02 })];
    trackHour({ atMs: at({ hours: 0 }), dry: true, mayOpen: true, plans: lifted, tracker });
    trackHour({ atMs: at({ hours: 1 }), dry: false, mayOpen: true, plans: lifted, tracker });

    expect(
      finishSpells({ plans: lifted, stoppedAtMs: at({ hours: 10 }), tracker }).map((spell) => spell.endedBy),
    ).toEqual(["final-hours"]);
  });
});

describe("spellEndClause", () => {
  const spell: DrySpell = {
    endedAtIso: "2026-09-30T11:00:00.000Z",
    endedBy: "reset",
    endedByAlias: "plan-five",
    hours: 11,
    reliefHours: 0,
    startIso: "2026-09-29T23:00:00.000Z",
  };

  it("says which plan's reset ended a spell, to the minute", () => {
    expect(spellEndClause({ spell, thresholds: THRESHOLDS })).toBe("plan-five resets at 2026-09-30T11:00Z");
  });

  it("says a final-hours lift lets a plan spend past the route bar", () => {
    expect(spellEndClause({ spell: { ...spell, endedBy: "final-hours" }, thresholds: THRESHOLDS })).toBe(
      "plan-five enters its week's final hours at 2026-09-30T11:00Z and may spend past 95%",
    );
  });

  it("names the install's route bar, not 95, when the register moved it", () => {
    expect(
      spellEndClause({ spell: { ...spell, endedBy: "final-hours" }, thresholds: { ...THRESHOLDS, routeAt: 0.85 } }),
    ).toBe("plan-five enters its week's final hours at 2026-09-30T11:00Z and may spend past 85%");
  });

  it("says an unended spell is demand no reset relieves", () => {
    expect(spellEndClause({ spell: { ...spell, endedBy: "unended" }, thresholds: THRESHOLDS })).toBe(
      "past 2026-09-30T11:00Z: demand the fleet cannot hold at any reset",
    );
  });
});
