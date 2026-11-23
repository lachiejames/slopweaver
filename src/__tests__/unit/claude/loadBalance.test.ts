import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { renderAcceptance } from "../../../claude/loadBalance.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { acceptanceShortfall, headroomToReset, planExcludedBy, rankClaudePlans } from "./defaultThresholds.js";

const OBSERVED = "2026-09-09T14:40:00.000Z";
const RESET = "2026-09-13T03:00:00.000Z";

/**
 * One window at a utilization.
 *
 * @param utilization the fraction spent
 * @param status how the provider grades it
 * @param resetAtIso when it resets
 * @returns the reading
 */
const window = ({
  resetAtIso = RESET,
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status, utilization });

/**
 * One plan's gauge.
 *
 * @param alias the plan's label
 * @param week the plan-wide seven-day utilization
 * @param fable the Fable seven-day utilization, omitted for a gauge with no Fable reading
 * @param fiveHour the five-hour utilization
 * @param weekReset when the plan-wide week resets
 * @param fableReset when the Fable week resets
 * @returns the gauge
 */
const gauge = ({
  alias,
  fable,
  fableReset = RESET,
  fiveHour = 0.1,
  usageLimitPercent = 100,
  week,
  weekReset = RESET,
}: {
  alias: string;
  fable?: number;
  fableReset?: string;
  fiveHour?: number;
  usageLimitPercent?: UsageLimitPercent;
  week: number;
  weekReset?: string;
}): ClaudePlanGauge => ({
  alias,
  allowance: WEEKLY_WINDOW,
  fiveHour: window({ utilization: fiveHour }),
  observedAtIso: OBSERVED,
  sevenDay: window({ resetAtIso: weekReset, utilization: week }),
  usageLimitPercent,
  ...(fable === undefined ? {} : { sevenDayFable: window({ resetAtIso: fableReset, utilization: fable }) }),
});

/** One day after {@link OBSERVED}. */
const IN_A_DAY = "2026-09-10T14:40:00.000Z";
/** Six days after {@link OBSERVED}. */
const IN_SIX_DAYS = "2026-09-15T14:40:00.000Z";

/** The chair's read of the incident: plan-four 22h from its reset, plan-three 142h from its own. */
const INCIDENT_OBSERVED = "2026-10-10T05:00:00.000Z";
const INCIDENT_NEAR_RESET = "2026-10-11T03:00:00.000Z";
const INCIDENT_FAR_RESET = "2026-10-16T03:00:00.000Z";

/**
 * One plan as the chair read it in the incident, every window resetting together.
 *
 * @param alias the plan's label
 * @param week the plan-wide seven-day utilization
 * @param fable the Fable seven-day utilization, omitted for a gauge with no Fable reading
 * @param reset when both weeks reset
 * @returns the gauge
 */
const incidentGauge = ({
  alias,
  fable,
  reset,
  week,
}: {
  alias: string;
  fable?: number;
  reset: string;
  week: number;
}): ClaudePlanGauge => ({
  alias,
  allowance: WEEKLY_WINDOW,
  fiveHour: window({ utilization: 0.1 }),
  observedAtIso: INCIDENT_OBSERVED,
  sevenDay: window({ resetAtIso: reset, utilization: week }),
  usageLimitPercent: 100,
  ...(fable === undefined ? {} : { sevenDayFable: window({ resetAtIso: reset, utilization: fable }) }),
});

describe("rankClaudePlans — the incident: a plan near its wall never outranks one that has barely started", () => {
  // MEASURED: `claude gauge` printed `next fable spawn -> plan-four` at 86% week / 78% fable, 22h
  // from its reset, over plan-three at 1% / 0%. Ranked in points per hour, the near-reset plan always looked
  // most behind; ranked in points below its level line it is 7 behind and the empty plan 15.
  it("sends the Fable chair to the empty plan, not the one 22 hours from its reset at 78%", () => {
    const ranking = rankClaudePlans({
      gauges: [
        incidentGauge({ alias: "plan-four", fable: 0.78, reset: INCIDENT_NEAR_RESET, week: 0.86 }),
        incidentGauge({ alias: "plan-three", fable: 0, reset: INCIDENT_FAR_RESET, week: 0.01 }),
      ],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plan-three", "plan-four"]);
  });

  it("sends an all-models spawn the same way", () => {
    const ranking = rankClaudePlans({
      gauges: [
        incidentGauge({ alias: "plan-four", fable: 0.78, reset: INCIDENT_NEAR_RESET, week: 0.86 }),
        incidentGauge({ alias: "plan-three", fable: 0, reset: INCIDENT_FAR_RESET, week: 0.01 }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plan-three", "plan-four"]);
  });

  it("sends a spawn the same way on the weekly fallback, when no plan carried a Fable reading", () => {
    const ranking = rankClaudePlans({
      gauges: [
        incidentGauge({ alias: "plan-four", reset: INCIDENT_NEAR_RESET, week: 0.86 }),
        incidentGauge({ alias: "plan-three", reset: INCIDENT_FAR_RESET, week: 0.01 }),
      ],
      modelClass: "fable",
    });

    expect(ranking.basis).toBe("weekly-fallback");
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plan-three", "plan-four"]);
  });
});

describe("headroomToReset — points below the level line, never points per hour", () => {
  const at = ({ resetAtIso, utilization }: { resetAtIso: string; utilization: number }): number =>
    headroomToReset({
      claim: "seven_day",
      observedAtIso: OBSERVED,
      usageLimitPercent: 100,
      window: window({ resetAtIso, utilization }),
    });

  it("reads a week that has just opened as owing nothing yet", () => {
    // Opened exactly now: seven days to its reset, so the line is still at zero.
    expect(at({ resetAtIso: "2026-09-16T14:40:00.000Z", utilization: 0 })).toBe(0);
  });

  it("lines up to 95% at the reset less five hours, away from a reset", () => {
    // Six hours out the cap is 0.95 and the line reaches it at the reset less five: 162 of 163 hours gone.
    expect(at({ resetAtIso: "2026-09-09T20:40:00.000Z", utilization: 0.9 })).toBeCloseTo((0.95 * 162) / 163 - 0.9, 10);
  });

  it("switches to the 100% line at exactly five hours out, the boundary inclusive", () => {
    expect(at({ resetAtIso: "2026-09-09T19:40:00.000Z", utilization: 0.9 })).toBeCloseTo(163 / 168 - 0.9, 10);
  });

  it("lifts the line to 100% at the reset inside the last five hours", () => {
    // Observed one hour before the reset: the cap is 1, so the line is 167/168 of it.
    expect(at({ resetAtIso: "2026-09-09T15:40:00.000Z", utilization: 0.96 })).toBeCloseTo(167 / 168 - 0.96, 10);
  });

  it("reads a plan ahead of its line as negative", () => {
    // One day into the week: line 0.95 × 24/163.
    expect(at({ resetAtIso: IN_SIX_DAYS, utilization: 0.55 })).toBeCloseTo((0.95 * 24) / 163 - 0.55, 10);
  });

  it("answers -Infinity for a reset that does not parse", () => {
    expect(at({ resetAtIso: "not an instant", utilization: 0 })).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("rankClaudePlans — weighed by reset: the plan furthest below its own level line wins", () => {
  it("sends an all-models spawn to 60% resetting tomorrow over 55% resetting in six days, which level alone got backwards", () => {
    // tomorrow: 24 points below its line; six days: 41 points above its own.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "six-days", week: 0.55, weekReset: IN_SIX_DAYS }),
        gauge({ alias: "tomorrow", week: 0.6, weekReset: IN_A_DAY }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["tomorrow", "six-days"]);
  });

  it("sends a Fable spawn on the Fable week's own reset, not the plan-wide one", () => {
    // Both plan-wide weeks sit at 10%, under every line, so the Fable week is the binding one on each plan and the
    // case proves which reset it is lined up to rather than the binding-week key.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "six-days", fable: 0.3, fableReset: IN_SIX_DAYS, week: 0.1, weekReset: IN_A_DAY }),
        gauge({ alias: "tomorrow", fable: 0.5, fableReset: IN_A_DAY, week: 0.1, weekReset: IN_SIX_DAYS }),
      ],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["tomorrow", "six-days"]);
  });

  it("lines a window inside its last five hours up to 100%, so a plan at 96% two hours out still wins", () => {
    // Lined up to 95% it would read as AHEAD and lose; its last 4 points strand at the reset unless spent now.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "days-out", week: 0.5, weekReset: "2026-09-13T18:40:00.000Z" }),
        gauge({ alias: "two-hours", week: 0.96, weekReset: "2026-09-09T16:40:00.000Z" }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.excluded).toEqual([]);
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["two-hours", "days-out"]);
  });

  it("ranks a week read after its own reset first, since that week has already rolled over", () => {
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "fresh", week: 0.1, weekReset: IN_SIX_DAYS }),
        gauge({ alias: "rolled", week: 0.5, weekReset: "2026-09-09T14:00:00.000Z" }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["rolled", "fresh"]);
  });

  it("ranks a week whose reset does not parse behind every one that does", () => {
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "unparsed", week: 0.1, weekReset: "not an instant" }),
        gauge({ alias: "parsed", week: 0.9, weekReset: IN_SIX_DAYS }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["parsed", "unparsed"]);
  });
});

describe("rankClaudePlans — on one reset: least Fable used wins", () => {
  it("sends a Fable spawn to the LEAST-used Fable plan, the case that killed the gap-only draft", () => {
    // gap-only ranking prefers plan-heavy (gap -15) over plan-light (gap -10), which is backwards.
    // plan-heavy's week stays UNDER ROTATE_AT_UTILIZATION so it is actually RANKED: at 0.95 it is excluded
    // before the comparison happens and the case proves the gate instead of the ordering.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "plan-heavy", fable: 0.75, week: 0.9 }),
        gauge({ alias: "plan-light", fable: 0.1, week: 0.2 }),
      ],
      modelClass: "fable",
    });

    expect(ranking.excluded).toEqual([]);
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plan-light", "plan-heavy"]);
    expect(ranking.basis).toBe("full");
  });

  it("honours the owner's own 60-versus-5 example", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "sixty", fable: 0.6, week: 0.3 }), gauge({ alias: "five", fable: 0.05, week: 0.3 })],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["five", "sixty"]);
  });

  it("breaks a binding-week tie toward the plan whose Fable week is furthest behind its own week", () => {
    // Both weeks stay UNDER the 95% gate on purpose: at 0.95 or above the plan is excluded before it is
    // ever ranked, so a fixture past the gate would prove the gate rather than the tie-break. Both plan-wide weeks
    // read the same 50% on the same reset, so the binding headroom ties and the gap decides.
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "level", fable: 0.3, week: 0.5 }), gauge({ alias: "behind", fable: 0.1, week: 0.5 })],
      modelClass: "fable",
    });

    expect(ranking.ranked[0]!.alias).toBe("behind");
  });
});

describe("rankClaudePlans — gates", () => {
  it("excludes a plan whose plan-wide week is refused, even with Fable allowed and half left", () => {
    const ranking = rankClaudePlans({
      gauges: [
        {
          alias: "week-dead",
          allowance: WEEKLY_WINDOW,
          fiveHour: window({ utilization: 0.1 }),
          observedAtIso: OBSERVED,
          sevenDay: window({ status: "rejected", utilization: 1 }),
          sevenDayFable: window({ utilization: 0.5 }),
          usageLimitPercent: 100,
        },
        gauge({ alias: "healthy", fable: 0.4, week: 0.4 }),
      ],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["healthy"]);
    expect(ranking.excluded[0]!.alias).toBe("week-dead");
    expect(ranking.excluded[0]!.reason).toBe("seven_day refused");
  });

  it("keeps a Fable-spent plan ELIGIBLE for an all-models spawn", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "fable-spent", fable: 1, week: 0.3 })],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["fable-spent"]);
    expect(ranking.excluded).toEqual([]);
  });

  it("excludes at the 95 percent boundary", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "at-bar", fable: 0.1, week: 0.95 })],
      modelClass: "fable",
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.excluded[0]!.reason).toBe("seven_day at 95%");
  });

  it("still ranks a plan at 85 percent, which the old cap excluded", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "was-barred", fable: 0.1, week: 0.85 })],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["was-barred"]);
    expect(ranking.excluded).toEqual([]);
  });

  it("returns an empty ranking when every plan is barred", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "a", fable: 0.96, week: 0.96 }), gauge({ alias: "b", fable: 0.95, week: 0.95 })],
      modelClass: "fable",
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.excluded).toHaveLength(2);
  });
});

describe("rankClaudePlans — absent is not measured", () => {
  it("DEFERS a Fable-unmeasured plan behind a measured one, never treating absence as zero", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "unread", week: 0.1 }), gauge({ alias: "measured", fable: 0.5, week: 0.5 })],
      modelClass: "fable",
    });

    expect(ranking.ranked[0]!.alias).toBe("measured");
    expect(ranking.deferredUnmeasured).toEqual(["unread"]);
    expect(ranking.basis).toBe("full");
  });

  it("falls back to the weekly key and SAYS SO when no plan carried a Fable reading", () => {
    const ranking = rankClaudePlans({
      gauges: [gauge({ alias: "high", week: 0.6 }), gauge({ alias: "low", week: 0.2 })],
      modelClass: "fable",
    });

    expect(ranking.basis).toBe("weekly-fallback");
    expect(ranking.ranked.map((g) => g.alias)).toEqual(["low", "high"]);
    expect(ranking.deferredUnmeasured).toEqual(["high", "low"]);
  });

  it("drops the cross-window key for the WHOLE all-models comparison when Fable coverage is partial", () => {
    // With the cross-window key applied, "partial" would sort by a term the other two cannot supply.
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "partial", fable: 0.9, week: 0.5 }),
        gauge({ alias: "plain-low", week: 0.2 }),
        gauge({ alias: "plain-high", week: 0.7 }),
      ],
      modelClass: "all-models",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["plain-low", "partial", "plain-high"]);
  });
});

describe("rankClaudePlans — the fleet's real state today", () => {
  it("routes both classes to the single readable plan", () => {
    const only = [gauge({ alias: "plan-one", fable: 0.38, week: 0.31 })];

    expect(rankClaudePlans({ gauges: only, modelClass: "fable" }).ranked[0]!.alias).toBe("plan-one");
    expect(rankClaudePlans({ gauges: only, modelClass: "all-models" }).ranked[0]!.alias).toBe("plan-one");
  });

  it("keeps configured order as the final tie-break across four identical plans", () => {
    const ranking = rankClaudePlans({
      gauges: [
        gauge({ alias: "one", fable: 0.2, week: 0.2 }),
        gauge({ alias: "two", fable: 0.2, week: 0.2 }),
        gauge({ alias: "three", fable: 0.2, week: 0.2 }),
        gauge({ alias: "four", fable: 0.2, week: 0.2 }),
      ],
      modelClass: "fable",
    });

    expect(ranking.ranked.map((g) => g.alias)).toEqual(["one", "two", "three", "four"]);
  });
});

describe("planExcludedBy", () => {
  it("names the five-hour window when it is the one that bars the spawn", () => {
    const blocked = planExcludedBy({
      gauge: gauge({ alias: "busy", fable: 0.1, fiveHour: 0.96, week: 0.1 }),
      modelClass: "all-models",
    });

    expect(blocked!.reason).toBe("five_hour at 96%");
    expect(blocked!.alias).toBe("busy");
  });

  it("answers undefined for a plan that can take the spawn", () => {
    const blocked = planExcludedBy({ gauge: gauge({ alias: "fine", fable: 0.2, week: 0.2 }), modelClass: "fable" });

    expect(blocked).toBeUndefined();
  });
});

describe("acceptanceShortfall — the owner's own success criterion", () => {
  it("REFUSES to grade when fewer plans are readable than configured — a sign-in census is not a balance verdict", () => {
    const result = acceptanceShortfall({
      configured: 4,
      gauges: [gauge({ alias: "plan-one", fable: 0.38, week: 0.31 })],
    });

    expect(result.verdict).toBe("unmeasurable");
    expect(result.readable).toBe(1);
    expect(result.configured).toBe(4);
  });

  it("refuses to grade an entirely unreadable fleet", () => {
    const result = acceptanceShortfall({ configured: 4, gauges: [] });

    expect(result.verdict).toBe("unmeasurable");
    expect(result.readable).toBe(0);
  });

  it("reports not-triggered when every plan is readable but none has hit a limit", () => {
    const result = acceptanceShortfall({
      configured: 2,
      gauges: [gauge({ alias: "a", fable: 0.5, week: 0.5 }), gauge({ alias: "b", fable: 0.4, week: 0.4 })],
    });

    expect(result.verdict).toBe("not-triggered");
    expect(result.anyPlanAtLimit).toBe(false);
  });

  it("reports SHORT and names the plans under the bar once a limit has been hit", () => {
    const result = acceptanceShortfall({
      configured: 3,
      gauges: [
        gauge({ alias: "spent", fable: 1, week: 1 }),
        gauge({ alias: "idle", fable: 0.1, week: 0.2 }),
        gauge({ alias: "nearly", fable: 0.95, week: 0.95 }),
      ],
    });

    expect(result.verdict).toBe("short");
    expect(result.shortOfBar).toEqual(["idle"]);
  });

  it("reports MET for the balanced end state the owner's test describes", () => {
    const result = acceptanceShortfall({
      configured: 4,
      gauges: [
        gauge({ alias: "a", fable: 1, week: 0.95 }),
        gauge({ alias: "b", fable: 0.92, week: 0.91 }),
        gauge({ alias: "c", fable: 0.9, week: 0.9 }),
        gauge({ alias: "d", fable: 0.93, week: 0.97 }),
      ],
    });

    expect(result.verdict).toBe("met");
    expect(result.shortOfBar).toEqual([]);
    expect(result.readable).toBe(4);
  });

  it("counts an UNREAD Fable window as short, since the test asks to SEE 90 percent", () => {
    const result = acceptanceShortfall({ configured: 1, gauges: [gauge({ alias: "unread-fable", week: 1 })] });

    expect(result.verdict).toBe("short");
    expect(result.shortOfBar).toEqual(["unread-fable"]);
  });
});

describe("renderAcceptance", () => {
  it("renders the fleet's real state: a limit hit with every plan under the bar", () => {
    // The four live readings, the first time the owner's test had four plans to grade.
    const line = renderAcceptance({
      shortfall: acceptanceShortfall({
        configured: 4,
        gauges: [
          gauge({ alias: "plan-one", fable: 0.64, week: 0.52 }),
          gauge({ alias: "plan-two", fable: 0.86, week: 0.7 }),
          gauge({ alias: "plan-three", fable: 1, week: 0.66 }),
          gauge({ alias: "plan-four", fable: 0.52, week: 1 }),
        ],
      }),
    });

    expect(line).toBe(
      "acceptance: SHORT — a limit was hit while plan-one, plan-two, plan-three, plan-four sat under 90% on a window; by the owner's test the load balancing is not working",
    );
  });

  it("says UNMEASURABLE with the readable-over-configured count, never a verdict", () => {
    const line = renderAcceptance({
      shortfall: acceptanceShortfall({ configured: 4, gauges: [gauge({ alias: "plan-one", fable: 0.3, week: 0.3 })] }),
    });

    expect(line).toContain("UNMEASURABLE");
    expect(line).toContain("1/4 plans readable");
  });

  it("says the test has not run rather than passed when no limit has been hit", () => {
    const line = renderAcceptance({
      shortfall: acceptanceShortfall({
        configured: 2,
        gauges: [gauge({ alias: "a", fable: 0.3, week: 0.3 }), gauge({ alias: "b", fable: 0.2, week: 0.2 })],
      }),
    });

    expect(line).toContain("not triggered");
    expect(line).toContain("has not run rather than passed");
  });

  it("says MET for the end state the owner described", () => {
    const line = renderAcceptance({
      shortfall: acceptanceShortfall({
        configured: 2,
        gauges: [gauge({ alias: "a", fable: 1, week: 0.95 }), gauge({ alias: "b", fable: 0.93, week: 0.91 })],
      }),
    });

    expect(line).toContain("MET");
  });

  it("renders no organisation, no email and no store path", () => {
    const line = renderAcceptance({
      shortfall: acceptanceShortfall({ configured: 1, gauges: [gauge({ alias: "plan-one", fable: 1, week: 0.5 })] }),
    });

    expect(line).not.toContain("@");
    expect(line).not.toContain("/Users/");
  });
});

describe("planExcludedBy spends a weekly window out near its own reset", () => {
  /** The Fable week 30 minutes from ITS reset at 97%, while the plan-wide week is days away at 40%. */
  const fableClosing: ClaudePlanGauge = {
    alias: "plan-one",
    allowance: WEEKLY_WINDOW,
    fiveHour: window({ utilization: 0.1 }),
    observedAtIso: OBSERVED,
    sevenDay: window({ utilization: 0.4 }),
    sevenDayFable: window({ resetAtIso: "2026-09-09T15:10:00.000Z", utilization: 0.97 }),
    usageLimitPercent: 100,
  };

  it("takes a FABLE spawn on a Fable week at 97% that resets in half an hour", () => {
    expect(planExcludedBy({ gauge: fableClosing, modelClass: "fable" })).toBeUndefined();
  });

  it("refuses the same Fable week at 97% when its own reset is days away", () => {
    const fableOpen: ClaudePlanGauge = { ...fableClosing, sevenDayFable: window({ utilization: 0.97 }) };
    expect(planExcludedBy({ gauge: fableOpen, modelClass: "fable" })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: RESET,
      kind: "routing-bar",
      reason: "seven_day_fable at 97%",
    });
  });

  it("leaves an all-models spawn untouched by the Fable window either way", () => {
    expect(planExcludedBy({ gauge: fableClosing, modelClass: "all-models" })).toBeUndefined();
  });

  it("never lifts the FIVE-HOUR window, whose reset replenishes rather than strands it", () => {
    const fiveHourClosing: ClaudePlanGauge = {
      alias: "plan-one",
      allowance: WEEKLY_WINDOW,
      fiveHour: window({ resetAtIso: "2026-09-09T14:50:00.000Z", utilization: 0.97 }),
      observedAtIso: OBSERVED,
      sevenDay: window({ utilization: 0.4 }),
      usageLimitPercent: 100,
    };
    expect(planExcludedBy({ gauge: fiveHourClosing, modelClass: "all-models" })).toStrictEqual({
      alias: "plan-one",
      eligibleAtIso: "2026-09-09T14:50:00.000Z",
      kind: "routing-bar",
      reason: "five_hour at 97%",
    });
  });
});
