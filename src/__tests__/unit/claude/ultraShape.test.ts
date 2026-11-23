import { describe, expect, it } from "vitest";

import {
  chairBudgetLines as chairBudgetLinesAt,
  chairPlansOf,
  chairProbeOf,
  chairReadingLine,
  sweptUnreadOf,
} from "../../../claude/chairBudgetAlert.js";
import type { ClaudePlanGauge } from "../../../claude/contracts.js";
import { fleetBudgetAlert } from "../../../claude/fleetAlert.js";
import { renderGaugeLines } from "../../../claude/gaugeRender.js";
import { renderSpawnRoute } from "../../../claude/routeSpawn.js";
import { parseClaudeGauge } from "../../../claude/usage.js";
import { unwrap } from "../../../lib/result.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { rankClaudePlans, routeSpawnToPlan, selectClaudeAccount, THRESHOLDS } from "./defaultThresholds.js";

/** `chairBudgetLines` at the default thresholds. */
function chairBudgetLines(options: Omit<Parameters<typeof chairBudgetLinesAt>[0], "thresholds">): readonly string[] {
  return chairBudgetLinesAt({ ...options, thresholds: THRESHOLDS });
}

/** A paused chair plan's configured usage policy: a weekly window, no usage limit set. */
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

/** When the capture was taken, near enough: every reset below is days after it. */
const OBSERVED = "2026-11-02T05:40:00.000Z";

/**
 * One plan's rate-limit headers in the Ultra shape — no `5h` trio — with the numbers each plan's store
 * answered in that capture (`slopweaver claude gauge --json`), so the routing below is judged on what the fleet
 * actually read that morning.
 *
 * @param alias the plan
 * @param week the plan-wide week's utilization
 * @param reset the epoch second every window resets at, as the provider sent it
 * @param fable the Fable week's utilization
 * @param fableStatus how the provider grades the Fable week
 * @param weekStatus how the provider grades the plan-wide week
 * @returns the parsed gauge, paired with a weekly-window allowance and no usage limit set
 */
const ultra = ({
  alias,
  fable,
  fableStatus = "allowed",
  reset,
  week,
  weekStatus = "allowed",
}: {
  alias: string;
  fable: string;
  fableStatus?: string;
  reset: string;
  week: string;
  weekStatus?: string;
}): ClaudePlanGauge => ({
  allowance: WEEKLY_WINDOW,
  usageLimitPercent: 100,
  ...unwrap(
    parseClaudeGauge({
      alias,
      headers: {
        "anthropic-ratelimit-unified-7d-reset": reset,
        "anthropic-ratelimit-unified-7d-status": weekStatus,
        "anthropic-ratelimit-unified-7d-utilization": week,
        "anthropic-ratelimit-unified-7d_oi-reset": reset,
        "anthropic-ratelimit-unified-7d_oi-status": fableStatus,
        "anthropic-ratelimit-unified-7d_oi-utilization": fable,
        "anthropic-ratelimit-unified-representative-claim": "seven_day",
        "anthropic-ratelimit-unified-status": weekStatus,
      },
      observedAtIso: OBSERVED,
    }),
  ),
});

const PLAN_ONE = ultra({ alias: "plan-one", fable: "0.0", reset: "1794106800", week: "0.56" });
const PLAN_THREE = ultra({ alias: "plan-three", fable: "0.0", reset: "1793905200", week: "0.07" });
const PLAN_FOUR = ultra({ alias: "plan-four", fable: "0.0", reset: "1794088800", week: "0.11" });
const PLAN_FIVE = ultra({
  alias: "plan-five",
  fable: "0.85",
  fableStatus: "allowed_warning",
  reset: "1793790000",
  week: "0.42",
});
const FLEET = [PLAN_ONE, PLAN_THREE, PLAN_FOUR, PLAN_FIVE];

describe("routing on the Ultra shape", () => {
  it("excludes no plan for a missing five-hour window and picks the plan furthest behind for a Fable spawn", () => {
    const ranking = rankClaudePlans({ gauges: FLEET, modelClass: "fable" });
    expect(ranking.excluded).toStrictEqual([]);
    // plan-one's empty Fable week no longer lifts it past plan-five: its plan-wide week, at 56% with the latest
    // reset, is the further ahead of its line, and a Fable seat walls on the binding week (`fableSeatThresholds`).
    expect(ranking.ranked.map((gauge) => gauge.alias)).toStrictEqual([
      "plan-three",
      "plan-four",
      "plan-five",
      "plan-one",
    ]);
  });

  it("routes an all-models spawn on the week alone", () => {
    const ranking = rankClaudePlans({ gauges: FLEET, modelClass: "all-models" });
    expect(ranking.ranked[0]!.alias).toBe("plan-three");
  });

  it("restores the automatic spawn pick and names no five-hour window the plan does not have", () => {
    const route = routeSpawnToPlan({ gauges: FLEET, model: "claude-fable-5-1" });
    expect(route.kind).toBe("route");
    expect(renderSpawnRoute({ route })).toBe(
      "claude routing: plan-three for a fable spawn — fable-week 0%, all-models week 7%, read 2026-11-02T05:40:00.000Z",
    );
  });

  it("lets the rotation selector choose among Ultra plans", () => {
    expect(selectClaudeAccount({ gauges: FLEET })).toStrictEqual({ excluded: [], kind: "rotate", to: "plan-five" });
  });

  it("reads a week past 1 rather than refusing the gauge, and routing excludes that plan — failing safe", () => {
    const past = ultra({ alias: "plan-past", fable: "0.0", reset: "1793790000", week: "1.01" });
    expect(past.sevenDay.utilization).toBe(1.01);
    const ranking = rankClaudePlans({ gauges: [past, PLAN_THREE], modelClass: "all-models" });
    expect(ranking.ranked.map((gauge) => gauge.alias)).toStrictEqual(["plan-three"]);
    expect(ranking.excluded.map((exclusion) => exclusion.alias)).toStrictEqual(["plan-past"]);
  });

  it("ranks a plan with no five-hour limit ahead of an otherwise identical plan that still has one", () => {
    const legacy: ClaudePlanGauge = {
      ...PLAN_THREE,
      alias: "plan-legacy",
      fiveHour: { resetAtIso: "2026-11-02T08:00:00.000Z", status: "allowed", utilization: 0 },
    };
    const ranking = rankClaudePlans({ gauges: [legacy, PLAN_THREE], modelClass: "all-models" });
    expect(ranking.ranked.map((gauge) => gauge.alias)).toStrictEqual(["plan-three", "plan-legacy"]);
  });
});

describe("what the owner reads on the Ultra shape", () => {
  it("draws no five-hour column at all when no plan in the table carries that window", () => {
    const lines = renderGaugeLines({ cells: [], gauges: [PLAN_THREE], thresholds: THRESHOLDS });
    expect(lines[0]).toBe("plan          account  7-day all         7-day fable       resets");
    expect(lines[1]).toBe(
      "plan-three    UNREAD        #.........   7%       ..........   0%  2026-11-05T19:00:00.000Z",
    );
  });

  it("draws the five-hour column as no limit beside a plan that still has one, never as an empty bar", () => {
    const legacy: ClaudePlanGauge = {
      ...PLAN_THREE,
      alias: "plan-legacy",
      fiveHour: { resetAtIso: "2026-11-02T08:00:00.000Z", status: "allowed", utilization: 0 },
    };
    const lines = renderGaugeLines({ cells: [], gauges: [PLAN_THREE, legacy], thresholds: THRESHOLDS });
    expect(lines[0]).toBe("plan           account  5-hour            7-day all         7-day fable       resets");
    expect(lines[1]).toBe(
      "plan-three     UNREAD        no 5h limit           #.........   7%       ..........   0%  2026-11-05T19:00:00.000Z",
    );
  });

  it("raises no five-hour react-now line for a plan that has no five-hour window", () => {
    const alert = fleetBudgetAlert({ configured: 4, gauges: FLEET, thresholds: THRESHOLDS });
    expect(alert.reactNow).toStrictEqual([
      "REACT NOW — plan-five fable week at 85%, resets 2026-11-04T11:00:00.000Z: it stops Fable spawns; move them to plan-three",
    ]);
  });
});

describe("chairBudgetLines", () => {
  it("says the chair's own plan is nearing its Fable wall, and where to hand the chair", () => {
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: FLEET })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose Fable week is at 85% (allowed_warning), resets 2026-11-04T11:00:00.000Z: hand the chair to plan-three before it walls",
    ]);
  });

  it("says nothing when the chair's plan is healthy, even while another plan warns", () => {
    expect(chairBudgetLines({ chair: { plans: ["plan-three"] }, gauges: FLEET })).toStrictEqual([]);
  });

  it("says nothing about a chair it could not read", () => {
    expect(chairBudgetLines({ chair: { plans: [] }, gauges: FLEET })).toStrictEqual([]);
  });

  it("warns a SPLIT chair about its nearing plan, though no unanimous plan earns the mark", () => {
    // Counterexample: two live chair sessions mid hand-off, one on a plan the provider
    // grades allowed_warning at 50% — under every fleet threshold, so only the chair line can say it.
    const warned = ultra({
      alias: "plan-five",
      fable: "0.0",
      reset: "1793790000",
      week: "0.50",
      weekStatus: "allowed_warning",
    });
    const sessions = [
      { pid: 1, plan: { alias: "plan-five", kind: "store" as const }, sessionId: "chair-a" },
      { pid: 2, plan: { alias: "plan-three", kind: "store" as const }, sessionId: "chair-b" },
      { pid: 3, plan: { kind: "unresolved" as const, why: "no credential" }, sessionId: "chair-c" },
    ];
    expect(chairPlansOf({ sessions })).toStrictEqual(["plan-five", "plan-three"]);
    expect(
      chairBudgetLines({ chair: { plans: chairPlansOf({ sessions }) }, gauges: [warned, PLAN_THREE] }),
    ).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose week is at 50% (allowed_warning), resets 2026-11-04T11:00:00.000Z: hand the chair to plan-three before it walls",
    ]);
  });

  it("says a chair plan the sweep took no reading of is UNKNOWN, never silent", () => {
    // A second counterexample: a split chair on two paused plans has only one probed, so the
    // other had no gauge, no probe and no failure, and its 99% week reached neither surface.
    expect(chairBudgetLines({ chair: { plans: ["plan-b"] }, gauges: [PLAN_THREE] })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-b, whose reading failed (this sweep took no reading of it), so how near its wall it is is UNKNOWN: hand the chair to plan-three before it walls",
    ]);
  });

  it("calls a refused window CAPPED", () => {
    const capped = ultra({
      alias: "plan-five",
      fable: "0.2",
      reset: "1793790000",
      week: "1.0",
      weekStatus: "rejected",
    });
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: [capped, PLAN_THREE] })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose week is CAPPED, resets 2026-11-04T11:00:00.000Z: hand the chair to plan-three before it walls",
    ]);
  });

  it("warns at 99% in a week's last hours, where routing's own cap has lifted to the wall", () => {
    // Counterexample: a reset 09:00 is under five hours from OBSERVED, so `spendCapFor`
    // reads 1.0 here and an alert keyed on it would first speak at the wall.
    const lastHours = ultra({ alias: "plan-five", fable: "0.0", reset: "1793610000", week: "0.99" });
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: [lastHours, PLAN_THREE] })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose week is at 99% (allowed), resets 2026-11-02T09:00:00.000Z: hand the chair to plan-three before it walls",
    ]);
  });

  it("warns from the chair's paused plan, read outside the routed set, and still hands off to a routed plan", () => {
    const paused = ultra({ alias: "plan-two", fable: "0.0", reset: "1793790000", week: "0.96" });
    expect(chairBudgetLines({ chair: { plans: ["plan-two"] }, chairReading: paused, gauges: FLEET })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-two, whose week is at 96% (allowed), resets 2026-11-04T11:00:00.000Z: hand the chair to plan-three before it walls",
    ]);
  });

  it("draws a healthy paused chair plan as its own line, since the gauge table draws only routed plans", () => {
    const paused = ultra({ alias: "plan-two", fable: "0.25", reset: "1793790000", week: "0.40" });
    expect(chairReadingLine({ chairReading: paused })).toBe(
      "chair: plan-two is PAUSED for routing and read for the chair alone — week 40% (allowed), Fable week 25% (allowed), week resets 2026-11-04T11:00:00.000Z",
    );
  });

  it("warns that the chair's wall is UNKNOWN when its paused plan's probe failed, never staying silent", () => {
    const probe = chairProbeOf({
      account: POLICY,
      outcome: { alias: "plan-two", problem: "plan-two: the provider answered 500" },
    });
    expect(probe).toStrictEqual({
      chairUnread: { alias: "plan-two", problem: "plan-two: the provider answered 500" },
    });
    expect(chairBudgetLines({ chair: { plans: ["plan-two"] }, gauges: FLEET, ...probe })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-two, PAUSED for routing, whose reading failed (plan-two: the provider answered 500), so how near its wall it is is UNKNOWN: hand the chair to plan-three before it walls",
    ]);
  });

  it("warns that the chair's wall is UNKNOWN when its UNPAUSED plan's probe in the sweep failed", () => {
    // Counterexample: a swept plan whose probe failed drops out of `gauges`, so
    // without the sweep's failures the chair seated on it had no line at all.
    const sweptUnread = sweptUnreadOf({
      outcomes: [
        { alias: "plan-five", problem: "plan-five: the provider answered 500" },
        { alias: "plan-three", gauge: PLAN_THREE },
      ],
    });
    expect(sweptUnread).toStrictEqual([{ alias: "plan-five", problem: "plan-five: the provider answered 500" }]);
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: [PLAN_THREE], sweptUnread })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose reading failed (plan-five: the provider answered 500), so how near its wall it is is UNKNOWN: hand the chair to plan-three before it walls",
    ]);
  });

  it("carries a paused chair plan's reading when its probe succeeded", () => {
    const paused = ultra({ alias: "plan-two", fable: "0.25", reset: "1793790000", week: "0.40" });
    expect(chairProbeOf({ account: POLICY, outcome: { alias: "plan-two", gauge: paused } })).toStrictEqual({
      chairReading: paused,
    });
  });

  it("carries a paused chair plan's own usage limit into its reading, never the probe's", () => {
    const paused = ultra({ alias: "plan-two", fable: "0.25", reset: "1793790000", week: "0.40" });
    const probe = chairProbeOf({
      account: { ...POLICY, usageLimitPercent: 50 },
      outcome: { alias: "plan-two", gauge: paused },
    });
    expect(probe).toStrictEqual({ chairReading: { ...paused, usageLimitPercent: 50 } });
  });

  it("names a failed chair probe that gave no reason, rather than dropping it", () => {
    expect(chairProbeOf({ account: POLICY, outcome: { alias: "plan-two" } })).toStrictEqual({
      chairUnread: { alias: "plan-two", problem: "the probe returned neither a reading nor a reason" },
    });
  });

  it("stays quiet on an allowed week just under the un-lifted cap", () => {
    const under = ultra({ alias: "plan-five", fable: "0.0", reset: "1793790000", week: "0.94" });
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: [under, PLAN_THREE] })).toStrictEqual([]);
  });

  it("says the chair rides its plan to the wall when no other plan can take it", () => {
    expect(chairBudgetLines({ chair: { plans: ["plan-five"] }, gauges: [PLAN_FIVE] })).toStrictEqual([
      "CHAIR — the supervisor chair spends plan-five, whose Fable week is at 85% (allowed_warning), resets 2026-11-04T11:00:00.000Z: no other plan can take a Fable chair, so it rides this plan to the wall",
    ]);
  });
});
