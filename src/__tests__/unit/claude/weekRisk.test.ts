/**
 * The Claude plan week projected off the survival trend: at risk when the guarded run still runs dry, clear when the
 * reset comes first, and unmeasurable on a monthly-spend plan or a forecast that could not be made.
 */
import { describe, expect, it } from "vitest";

import type { HostDrySpell, HostWeekProjection } from "../../../capacity/weekRisk.js";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import { forecastSurvival, type SurvivalRead } from "../../../claude/survivalForecast.js";
import { claudeWeekProjection, journalSpanHours } from "../../../claude/weekRisk.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { registered } from "../monitor/fleetRunsDryFixtures.js";

const NOW = "2026-10-01T00:00:00.000Z";
const HOUR_MS = 3_600_000;
const OPENING = { demandShare: 0.9, minDryHours: 4 } as const;
const REGISTER: readonly RegisteredPlan[] = [registered({ alias: "a", provider: "claude" })];

/** An instant `hours` from {@link NOW}. */
function at({ hours }: { hours: number }): string {
  return new Date(Date.parse(NOW) + hours * HOUR_MS).toISOString();
}

/** Plan `a` drawing 0.1 of its week every ten hours up to 90%, the first sample 91h ago. */
function journal({ resetHours }: { resetHours: number }): DrawdownSample[] {
  return [-91, -81, -71, -61, -51, -41, -31, -21, -11, -1].map((hours, index) => ({
    kind: "sample",
    observedAtIso: at({ hours }),
    planAlias: "a",
    resetAtIso: at({ hours: resetHours }),
    schemaVersion: 1,
    utilization: index * 0.1,
    window: "seven-day",
  }));
}

/** {@link journal}'s forecast, its week resetting `resetHours` from now. */
function forecast({ resetHours }: { resetHours: number }): SurvivalRead {
  return forecastSurvival({
    demandBasis: "trailing",
    nowIso: NOW,
    plans: [{ alias: "a", paused: undefined, usageLimitPercent: 100 }],
    samples: journal({ resetHours }),
    thresholds: DEFAULT_THRESHOLDS.claude,
    weeks: 1,
  });
}

/** The journal's own span, 91h. */
const SPAN = 91;

describe("journalSpanHours", () => {
  it("measures from the earliest sample inside the trailing week, and is 0 with none inside it", () => {
    expect(journalSpanHours({ nowIso: NOW, samples: journal({ resetHours: 60 }) })).toBe(91);
    const old = journal({ resetHours: 60 }).map((sample) => ({ ...sample, observedAtIso: at({ hours: -200 }) }));
    expect(journalSpanHours({ nowIso: NOW, samples: old })).toBe(0);
  });
});

describe("claudeWeekProjection", () => {
  it("is at risk when the guarded run still runs dry before the reset, naming the plan whose reset ends it", () => {
    const projection = claudeWeekProjection({
      criterion: OPENING,
      read: forecast({ resetHours: 60 }),
      registered: REGISTER,
      spanHours: SPAN,
    });
    expect(projection.kind).toBe("at-risk");
    const spell = spellOf({ projection });
    // The spell ends at the week's last-five-hours spend-out lift, five hours before its 60h reset.
    expect([spell.host, spell.endedById, spell.endIso, spell.identity]).toEqual([
      "claude",
      "claude:a",
      at({ hours: 55 }),
      ["claude:a@100"],
    ]);
    expect(spell.hours).toBeGreaterThanOrEqual(4);
    expect(spell.planLines).toEqual([
      "a: 90% used of a 100% limit, 10% of a week left before its 2026-10-03T12:00Z reset; the routed draw fills it 2026-10-01T10:00Z, 2d2h before that reset",
    ]);
    expect(spell.basis).toContain("Claude, projected at 90% of the trailing draw");
  });

  it("is clear when the reset comes before any spell long enough to count", () => {
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: forecast({ resetHours: 3 }),
        registered: REGISTER,
        spanHours: SPAN,
      }).kind,
    ).toBe("clear");
  });

  it("never prints a later window's fill beside this window's reset", () => {
    // Plan b, resetting at 100h, carries a's draw until a's 3h reset; a then refills and caps again a week later, in
    // its NEXT window, which is no fill of the window that ended earlier.
    const b = [-61, -51, -41, -31, -21, -11, -1].map((hours, index) => ({
      kind: "sample" as const,
      observedAtIso: at({ hours }),
      planAlias: "b",
      resetAtIso: at({ hours: 100 }),
      schemaVersion: 1 as const,
      utilization: index * 0.15,
      window: "seven-day" as const,
    }));
    const read = forecastSurvival({
      demandBasis: "trailing",
      nowIso: NOW,
      plans: [
        { alias: "a", paused: undefined, usageLimitPercent: 100 },
        { alias: "b", paused: undefined, usageLimitPercent: 100 },
      ],
      samples: [...journal({ resetHours: 3 }), ...b],
      thresholds: DEFAULT_THRESHOLDS.claude,
      weeks: 1,
    });
    const projection = claudeWeekProjection({
      criterion: OPENING,
      read,
      registered: [...REGISTER, registered({ alias: "b", provider: "claude" })],
      spanHours: SPAN,
    });
    expect(projection.kind).toBe("clear");
    expect((projection as Extract<HostWeekProjection, { kind: "clear" }>).lines!.slice(1)).toEqual([
      "a: 90% used of a 100% limit, 10% of a week left before its 2026-10-01T03:00Z reset; the routed draw does not fill it before its last spend-out hours",
      "b: 90% used of a 100% limit, 10% of a week left before its 2026-10-05T04:00Z reset; the routed draw fills it 2026-10-03T15:00Z, 1d13h before that reset",
    ]);
  });

  it("is unmeasurable on a routable monthly-spend plan, a forecast that could not be made, or a journal under a day", () => {
    const monthly = [...REGISTER, registered({ alias: "m", allowance: "monthly-spend", provider: "claude" })];
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: forecast({ resetHours: 60 }),
        registered: monthly,
        spanHours: SPAN,
      }),
    ).toEqual({
      kind: "unmeasurable",
      why: "Claude plan m is a monthly-spend plan, which no week measures",
    });
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: { because: "a is stale", kind: "unmeasurable" },
        registered: REGISTER,
        spanHours: SPAN,
      }),
    ).toEqual({ kind: "unmeasurable", why: "Claude forecast: a is stale" });
    // A journal begun an hour ago divides almost no draw by a whole week: a gap, never a clear week.
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: forecast({ resetHours: 3 }),
        registered: REGISTER,
        spanHours: 1,
      }),
    ).toEqual({
      kind: "unmeasurable",
      why: "the Claude drawdown journal spans 1.0h, under the 24h a trailing rate needs",
    });
  });

  it("is unmeasurable, never at risk, when a routable plan is one the forecast does not start", () => {
    // The same forecast reads at risk over plan a alone (the first case); plan b, unstarted, may carry the week.
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: forecast({ resetHours: 60 }),
        registered: [...REGISTER, registered({ alias: "b", provider: "claude" })],
        spanHours: SPAN,
      }),
    ).toEqual({
      kind: "unmeasurable",
      why: "Claude plan b is routable but the forecast does not start it, so the week is not measured",
    });
  });

  it("is clear with no routable Claude plan", () => {
    expect(
      claudeWeekProjection({
        criterion: OPENING,
        read: forecast({ resetHours: 60 }),
        registered: [registered({ alias: "c", provider: "codex" })],
        spanHours: SPAN,
      }),
    ).toEqual({ kind: "clear", why: "no Claude plan is routable, so there is no Claude week to run out" });
  });
});

/** The spell inside an at-risk projection, throwing otherwise so the assertion carries no branch. */
function spellOf({ projection }: { projection: HostWeekProjection }): HostDrySpell {
  if (projection.kind !== "at-risk") {
    throw new Error(`expected a spell, got: ${projection.why}`);
  }
  return projection.spell;
}
