/**
 * The chair's own warning on a plan with an owner-set usage limit: it fires `routeAt` of the way to a binding weekly
 * limit and names that limit, the five-hour window keeps the un-lifted bar, and a paused chair plan is judged by its
 * OWN account's limit, an absent policy decoded as the register decodes it. The unlimited cases sit in
 * `ultraShape.test.ts`, unchanged.
 */
import { describe, expect, it } from "vitest";

import { chairBudgetLines, chairProbeOf } from "../../../claude/chairBudgetAlert.js";
import type { ClaudeAccountGauge, ClaudePlanGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;
const OBSERVED = "2026-11-02T05:40:00.000Z";
const RESET = "2026-11-06T19:00:00.000Z";
/** Under five hours after {@link OBSERVED}, where routing lifts an unlimited week to the wall. */
const NEAR_RESET = "2026-11-02T09:00:00.000Z";

const window = ({
  resetAtIso = RESET,
  status = "allowed",
  utilization,
}: {
  resetAtIso?: string;
  status?: ClaudeWindowReading["status"];
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status, utilization });

/** A reading as the probe returns it, before any usage policy is paired on. */
const reading = ({
  alias,
  fable = 0.1,
  fiveHour,
  reset = RESET,
  status = "allowed",
  week,
}: {
  alias: string;
  fable?: number;
  fiveHour?: number;
  reset?: string;
  status?: ClaudeWindowReading["status"];
  week: number;
}): ClaudeAccountGauge => ({
  alias,
  ...(fiveHour === undefined ? {} : { fiveHour: window({ utilization: fiveHour }) }),
  observedAtIso: OBSERVED,
  sevenDay: window({ resetAtIso: reset, status, utilization: week }),
  sevenDayFable: window({ utilization: fable }),
});

const limited = ({
  limit = 50,
  ...rest
}: Parameters<typeof reading>[0] & { limit?: UsageLimitPercent }): ClaudePlanGauge => ({
  ...reading(rest),
  allowance: WEEKLY_WINDOW,
  usageLimitPercent: limit,
});

/** A roomy, unlimited plan the chair can be handed to. */
const ROOMY = limited({ alias: "plan-c", fable: 0.02, limit: 100, week: 0.04 });

/** The chair lines for a chair seated on `plan-a`, at the default thresholds. */
const linesFor = ({ gauge }: { gauge: ClaudePlanGauge }): readonly string[] =>
  chairBudgetLines({ chair: { plans: ["plan-a"] }, gauges: [gauge, ROOMY], thresholds: THRESHOLDS });

const HAND_OFF = "hand the chair to plan-c before it walls";

describe("the chair's warning on a 50%-limited plan", () => {
  it("stays quiet a hair under 47.5% and warns at 47.5%, naming the limit it is nearing", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", week: 0.4749 }) })).toStrictEqual([]);
    expect(linesFor({ gauge: limited({ alias: "plan-a", week: 0.475 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 48% (allowed), nearing your 50% usage limit, resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("says AT the limit once the week has reached it", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", week: 0.5 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 50% (allowed), at your 50% usage limit, resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("rebases the Fable week the same way", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", fable: 0.4749, week: 0.2 }) })).toStrictEqual([]);
    expect(linesFor({ gauge: limited({ alias: "plan-a", fable: 0.475, week: 0.2 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose Fable week is at 48% (allowed), nearing your 50% usage limit, resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("keeps the five-hour window on the un-lifted routing bar, with no limit named", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", fiveHour: 0.6, week: 0.1 }) })).toStrictEqual([]);
    expect(linesFor({ gauge: limited({ alias: "plan-a", fiveHour: 0.95, week: 0.1 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose 5h is at 95% (allowed), resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("still warns at 47.5% inside the week's last five hours, where a usage limit never lifts", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", reset: NEAR_RESET, week: 0.475 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 48% (allowed), nearing your 50% usage limit, resets ${NEAR_RESET}: ${HAND_OFF}`,
    ]);
  });

  it("warns on the provider's own warning below the point, without claiming the owner's limit", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", status: "allowed_warning", week: 0.3 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 30% (allowed_warning), resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("keeps a monthly-spend plan's week on the un-lifted 95% bar, its limit being a share of the month", () => {
    const monthly = ({ week }: { week: number }): ClaudePlanGauge => ({
      ...limited({ alias: "plan-a", week }),
      allowance: { kind: "monthly-spend" },
    });
    expect(linesFor({ gauge: monthly({ week: 0.9499 }) })).toStrictEqual([]);
    expect(linesFor({ gauge: monthly({ week: 0.95 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 95% (allowed), resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("calls a provider refusal CAPPED, never the owner's limit", () => {
    expect(linesFor({ gauge: limited({ alias: "plan-a", status: "rejected", week: 0.6 }) })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is CAPPED, resets ${RESET}: ${HAND_OFF}`,
    ]);
  });
});

describe("a paused chair plan judged by its own account's usage limit", () => {
  it("pairs the probe's reading with the paused account's exact allowance and 50% limit", () => {
    const probed = reading({ alias: "plan-a", week: 0.475 });
    const probe = chairProbeOf({
      account: { allowance: WEEKLY_WINDOW, usageLimitPercent: 50 },
      outcome: { alias: "plan-a", gauge: probed },
    });
    expect(probe).toStrictEqual({ chairReading: { ...probed, allowance: WEEKLY_WINDOW, usageLimitPercent: 50 } });
    expect(
      chairBudgetLines({ chair: { plans: ["plan-a"] }, gauges: [ROOMY], thresholds: THRESHOLDS, ...probe }),
    ).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 48% (allowed), nearing your 50% usage limit, resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("reads a paused account naming no policy as the register does, a weekly window at 100%, warning at 95% as on main", () => {
    const quiet = reading({ alias: "plan-a", week: 0.9499 });
    const warned = reading({ alias: "plan-a", week: 0.95 });
    const quietProbe = chairProbeOf({ account: {}, outcome: { alias: "plan-a", gauge: quiet } });
    const warnedProbe = chairProbeOf({ account: {}, outcome: { alias: "plan-a", gauge: warned } });
    expect(warnedProbe).toStrictEqual({
      chairReading: { ...warned, allowance: WEEKLY_WINDOW, usageLimitPercent: 100 },
    });
    const chair = { plans: ["plan-a"] };
    expect(chairBudgetLines({ chair, gauges: [ROOMY], thresholds: THRESHOLDS, ...quietProbe })).toStrictEqual([]);
    expect(chairBudgetLines({ chair, gauges: [ROOMY], thresholds: THRESHOLDS, ...warnedProbe })).toStrictEqual([
      `CHAIR — the supervisor chair spends plan-a, whose week is at 95% (allowed), resets ${RESET}: ${HAND_OFF}`,
    ]);
  });

  it("decodes a missing allowance as a weekly window, so a 50% limit set alone still binds the week", () => {
    const probed = reading({ alias: "plan-a", week: 0.1 });
    const probe = chairProbeOf({ account: { usageLimitPercent: 50 }, outcome: { alias: "plan-a", gauge: probed } });
    expect(probe).toStrictEqual({ chairReading: { ...probed, allowance: WEEKLY_WINDOW, usageLimitPercent: 50 } });
  });
});
