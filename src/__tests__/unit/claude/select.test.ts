import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowReading, ClaudeWindowStatus } from "../../../claude/contracts.js";
import { type PlanAllowance, type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { selectClaudeAccount, spendCapFor, spendCapForSample, THRESHOLDS } from "./defaultThresholds.js";

const ROTATE_AT_UTILIZATION = THRESHOLDS.routeAt;
const SPEND_OUT_AT_UTILIZATION = THRESHOLDS.spendOutAt;

/** Build one gauge. Defaults are a healthy plan, so each test states only what it is actually testing. */
function gauge({
  alias,
  allowance = WEEKLY_WINDOW,
  fiveHourStatus = "allowed",
  fiveHourUtilization = 0.1,
  sevenDayReset = "2026-09-10T00:00:00.000Z",
  sevenDayStatus = "allowed",
  sevenDayUtilization = 0.1,
  usageLimitPercent = 100,
}: {
  alias: string;
  allowance?: PlanAllowance;
  fiveHourStatus?: ClaudeWindowStatus;
  fiveHourUtilization?: number;
  sevenDayReset?: string;
  sevenDayStatus?: ClaudeWindowStatus;
  sevenDayUtilization?: number;
  usageLimitPercent?: UsageLimitPercent;
}): ClaudePlanGauge {
  return {
    alias,
    allowance,
    fiveHour: {
      resetAtIso: "2026-09-04T00:00:00.000Z",
      status: fiveHourStatus,
      utilization: fiveHourUtilization,
    },
    observedAtIso: "2026-09-03T15:39:00.000Z",
    sevenDay: { resetAtIso: sevenDayReset, status: sevenDayStatus, utilization: sevenDayUtilization },
    usageLimitPercent,
  };
}

describe("selectClaudeAccount", () => {
  it("stays on the active plan while it still has headroom", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one" }), gauge({ alias: "plan-two" })],
    });
    expect(decision.kind).toBe("stay");
  });

  it("rotates away from a plan whose five-hour window was refused", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHourStatus: "rejected" }), gauge({ alias: "plan-two" })],
    });
    expect(decision.kind).toBe("rotate");
    expect(decision).toStrictEqual({
      excluded: [
        {
          alias: "plan-one",
          eligibleAtIso: "2026-09-04T00:00:00.000Z",
          kind: "provider-refused",
          reason: "five_hour refused",
        },
      ],
      from: "plan-one",
      kind: "rotate",
      to: "plan-two",
    });
  });

  it("rotates at the threshold rather than waiting for a refusal", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHourUtilization: ROTATE_AT_UTILIZATION }), gauge({ alias: "plan-two" })],
    });
    expect(decision.kind).toBe("rotate");
  });

  it("leaves a plan just under the threshold alone", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [
        gauge({ alias: "plan-one", fiveHourUtilization: ROTATE_AT_UTILIZATION - 0.01 }),
        gauge({ alias: "plan-two" }),
      ],
    });
    expect(decision.kind).toBe("stay");
  });

  it("prefers the plan whose weekly window resets soonest, not the one with most headroom", () => {
    const decision = selectClaudeAccount({
      active: "spent",
      gauges: [
        gauge({ alias: "spent", fiveHourStatus: "rejected" }),
        gauge({ alias: "fresh-week", sevenDayReset: "2026-09-10T00:00:00.000Z", sevenDayUtilization: 0.02 }),
        gauge({ alias: "ending-week", sevenDayReset: "2026-09-05T00:00:00.000Z", sevenDayUtilization: 0.6 }),
      ],
    });
    expect(decision.kind).toBe("rotate");
    expect(decision).toMatchObject({ to: "ending-week" });
  });

  it("breaks a weekly-reset tie on the lowest five-hour utilization", () => {
    const decision = selectClaudeAccount({
      active: "spent",
      gauges: [
        gauge({ alias: "spent", sevenDayStatus: "rejected" }),
        gauge({ alias: "busier", fiveHourUtilization: 0.5 }),
        gauge({ alias: "quieter", fiveHourUtilization: 0.05 }),
      ],
    });
    expect(decision).toMatchObject({ to: "quieter" });
  });

  it("falls back to configured order when every key ties", () => {
    const decision = selectClaudeAccount({
      active: "spent",
      gauges: [
        gauge({ alias: "spent", sevenDayStatus: "rejected" }),
        gauge({ alias: "first" }),
        gauge({ alias: "second" }),
      ],
    });
    expect(decision).toMatchObject({ to: "first" });
  });

  it("scales to a fourth plan with no change to the caller", () => {
    const decision = selectClaudeAccount({
      active: "one",
      gauges: [
        gauge({ alias: "one", fiveHourStatus: "rejected" }),
        gauge({ alias: "two", fiveHourStatus: "rejected" }),
        gauge({ alias: "three", fiveHourStatus: "rejected" }),
        gauge({ alias: "four", sevenDayReset: "2026-09-06T00:00:00.000Z" }),
      ],
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "four" });
  });

  it("reports every plan exhausted with the earliest reset across all of them", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [
        gauge({ alias: "plan-one", fiveHourStatus: "rejected", sevenDayReset: "2026-09-09T00:00:00.000Z" }),
        gauge({ alias: "plan-two", sevenDayStatus: "rejected", sevenDayReset: "2026-09-08T00:00:00.000Z" }),
      ],
    });
    expect(decision.kind).toBe("all-exhausted");
    expect(decision).toMatchObject({ earliestResetIso: "2026-09-04T00:00:00.000Z" });
  });

  it("names why each plan was excluded, with the percentage it stopped at", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [
        gauge({ alias: "plan-one", sevenDayUtilization: 0.96 }),
        gauge({ alias: "plan-two", fiveHourUtilization: 0.97 }),
      ],
    });
    expect(decision.kind).toBe("all-exhausted");
    expect(decision).toMatchObject({
      excluded: [
        { alias: "plan-one", reason: "seven_day at 96%" },
        { alias: "plan-two", reason: "five_hour at 97%" },
      ],
    });
  });

  it("selects a plan with no active account set", () => {
    const decision = selectClaudeAccount({ gauges: [gauge({ alias: "only" })] });
    expect(decision).toStrictEqual({ excluded: [], kind: "rotate", to: "only" });
  });

  it("omits the reset entirely for an empty gauge list rather than inventing an empty one", () => {
    const decision = selectClaudeAccount({ gauges: [] });
    expect(decision).toStrictEqual({ excluded: [], kind: "all-exhausted" });
  });
});

describe("the reserved plan — the browser's pinned account", () => {
  it("drains every other plan before touching the reserved one", () => {
    const decision = selectClaudeAccount({
      active: "spent",
      gauges: [
        gauge({ alias: "spent", fiveHourStatus: "rejected" }),
        gauge({ alias: "browser" }),
        gauge({ alias: "worker" }),
      ],
      reserved: "browser",
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "worker" });
  });

  it("falls back to the reserved plan rather than stalling when nothing else is left", () => {
    const decision = selectClaudeAccount({
      active: "worker",
      gauges: [gauge({ alias: "worker", fiveHourStatus: "rejected" }), gauge({ alias: "browser" })],
      reserved: "browser",
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "browser" });
  });

  it("leaves the reserved plan as soon as another becomes eligible again", () => {
    const decision = selectClaudeAccount({
      active: "browser",
      gauges: [gauge({ alias: "browser" }), gauge({ alias: "worker" })],
      reserved: "browser",
    });
    expect(decision).toMatchObject({ kind: "rotate", from: "browser", to: "worker" });
  });

  it("stays on the reserved plan when it is genuinely the only one left", () => {
    const decision = selectClaudeAccount({
      active: "browser",
      gauges: [gauge({ alias: "browser" }), gauge({ alias: "worker", sevenDayStatus: "rejected" })],
      reserved: "browser",
    });
    expect(decision).toMatchObject({ kind: "stay", on: "browser" });
  });

  it("still reports every plan exhausted when even the reserved one is spent", () => {
    const decision = selectClaudeAccount({
      active: "worker",
      gauges: [
        gauge({ alias: "worker", fiveHourStatus: "rejected" }),
        gauge({ alias: "browser", sevenDayStatus: "rejected" }),
      ],
      reserved: "browser",
    });
    expect(decision.kind).toBe("all-exhausted");
  });

  it("behaves exactly as before when no plan is reserved", () => {
    const gauges = [
      gauge({ alias: "spent", fiveHourStatus: "rejected" }),
      gauge({ alias: "a" }),
      gauge({ alias: "b" }),
    ];
    expect(selectClaudeAccount({ active: "spent", gauges })).toStrictEqual(
      selectClaudeAccount({ active: "spent", gauges, reserved: "nobody" }),
    );
  });
});

/**
 * The pinned account is also the reserved one, so workers drain the others first and the owner's pages keep
 * the budget they depend on. An owner ruling, after the owner's publishing seat moved into the rotation
 * pool and would otherwise have been spent by ordinary work.
 */
describe("the pinned account is reserved from worker selection", () => {
  it("drains the unpinned plans before touching the publishing seat", () => {
    const decision = selectClaudeAccount({
      active: "spent",
      gauges: [
        gauge({ alias: "spent", fiveHourStatus: "rejected" }),
        gauge({ alias: "publishing" }),
        gauge({ alias: "worker-plan" }),
      ],
      reserved: "publishing",
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "worker-plan" });
  });

  it("still falls back to it rather than stalling the fleet", () => {
    const decision = selectClaudeAccount({
      active: "worker-plan",
      gauges: [gauge({ alias: "worker-plan", sevenDayStatus: "rejected" }), gauge({ alias: "publishing" })],
      reserved: "publishing",
    });
    expect(decision).toMatchObject({ kind: "rotate", to: "publishing" });
  });

  it("leaves the publishing seat as soon as another plan is eligible again", () => {
    const decision = selectClaudeAccount({
      active: "publishing",
      gauges: [gauge({ alias: "publishing" }), gauge({ alias: "worker-plan" })],
      reserved: "publishing",
    });
    expect(decision).toMatchObject({ kind: "rotate", from: "publishing", to: "worker-plan" });
  });
});

describe("spendCapFor — spend a plan out in its last five hours", () => {
  const OBSERVED = "2026-09-17T14:00:00.000Z";

  /** One window at a stated utilization, resetting at a stated instant. */
  const resettingAt = ({ reset, utilization }: { reset: string; utilization: number }): ClaudeWindowReading => ({
    resetAtIso: reset,
    status: "allowed",
    utilization,
  });

  it("lifts a weekly window to 100% with four hours fifty-nine minutes left", () => {
    const window = resettingAt({ reset: "2026-09-17T18:59:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: OBSERVED, window })).toBe(SPEND_OUT_AT_UTILIZATION);
  });

  it("lifts at exactly five hours — the boundary is inclusive", () => {
    const window = resettingAt({ reset: "2026-09-17T19:00:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: OBSERVED, window })).toBe(SPEND_OUT_AT_UTILIZATION);
  });

  it("holds the 95% cap with five hours one minute left", () => {
    const window = resettingAt({ reset: "2026-09-17T19:01:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: OBSERVED, window })).toBe(ROTATE_AT_UTILIZATION);
  });

  it("never lifts the five-hour window, whose reset replenishes rather than strands it", () => {
    const window = resettingAt({ reset: "2026-09-17T14:10:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "five_hour", observedAtIso: OBSERVED, window })).toBe(ROTATE_AT_UTILIZATION);
  });

  it("lifts the FABLE week on its OWN reset, since it strands its own points", () => {
    const window = resettingAt({ reset: "2026-09-17T14:30:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day_fable", observedAtIso: OBSERVED, window })).toBe(SPEND_OUT_AT_UTILIZATION);
  });

  it("holds the 95% cap on a gauge observed AFTER its own reset — that reading is stale, not spendable", () => {
    const window = resettingAt({ reset: "2026-09-17T12:00:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: OBSERVED, window })).toBe(ROTATE_AT_UTILIZATION);
  });

  it("holds the 95% cap when the window's reset is unparseable", () => {
    const window = resettingAt({ reset: "not-a-date", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: OBSERVED, window })).toBe(ROTATE_AT_UTILIZATION);
  });

  it("holds the 95% cap when the gauge's own timestamp is unparseable", () => {
    const window = resettingAt({ reset: "2026-09-17T15:00:00.000Z", utilization: 0.97 });
    expect(spendCapFor({ claim: "seven_day", observedAtIso: "not-a-date", window })).toBe(ROTATE_AT_UTILIZATION);
  });
});

describe("spendCapForSample — the same policy for a journal sample that carries only an instant and a reset", () => {
  const OBSERVED = "2026-09-17T14:00:00.000Z";

  it("never lifts the five-hour window", () => {
    expect(
      spendCapForSample({ claim: "five_hour", observedAtIso: OBSERVED, resetAtIso: "2026-09-17T15:00:00.000Z" }),
    ).toBe(0.95);
  });

  it("holds the 95% cap on a weekly window six hours before its reset", () => {
    expect(
      spendCapForSample({ claim: "seven_day", observedAtIso: OBSERVED, resetAtIso: "2026-09-17T20:00:00.000Z" }),
    ).toBe(0.95);
  });

  it("lifts a weekly window to 100% four hours before its reset", () => {
    expect(
      spendCapForSample({ claim: "seven_day", observedAtIso: OBSERVED, resetAtIso: "2026-09-17T18:00:00.000Z" }),
    ).toBe(1);
  });

  it("holds the 95% cap on a sample observed after its own reset", () => {
    expect(
      spendCapForSample({ claim: "seven_day", observedAtIso: OBSERVED, resetAtIso: "2026-09-17T13:00:00.000Z" }),
    ).toBe(0.95);
  });
});

describe("selectClaudeAccount spends a plan out near its weekly reset", () => {
  const OBSERVED = "2026-09-17T14:00:00.000Z";
  const FIVE_HOUR_RESET = "2026-09-17T15:00:00.000Z";

  /** One plan whose week sits at a stated utilization and resets at a stated instant. */
  const spendOut = ({ alias, reset, week }: { alias: string; reset: string; week: number }): ClaudePlanGauge => ({
    alias,
    allowance: WEEKLY_WINDOW,
    fiveHour: { resetAtIso: FIVE_HOUR_RESET, status: "allowed", utilization: 0.1 },
    observedAtIso: OBSERVED,
    sevenDay: { resetAtIso: reset, status: "allowed", utilization: week },
    usageLimitPercent: 100,
  });

  it("keeps a plan at 97% eligible inside the five-hour window", () => {
    const decision = selectClaudeAccount({
      active: "plan-one",
      gauges: [spendOut({ alias: "plan-one", reset: "2026-09-17T16:00:00.000Z", week: 0.97 })],
    });
    expect(decision).toStrictEqual({
      kind: "stay",
      on: "plan-one",
      reason: "the active plan still has plan-wide headroom",
    });
  });

  it("still refuses that plan at 100%, because the cap is compared with >=", () => {
    const decision = selectClaudeAccount({
      gauges: [spendOut({ alias: "plan-one", reset: "2026-09-17T16:00:00.000Z", week: 1 })],
    });
    expect(decision).toStrictEqual({
      earliestResetIso: FIVE_HOUR_RESET,
      excluded: [
        {
          alias: "plan-one",
          eligibleAtIso: "2026-09-17T16:00:00.000Z",
          kind: "routing-bar",
          reason: "seven_day at 100%",
        },
      ],
      kind: "all-exhausted",
    });
  });

  it("refuses the same 97% plan when its reset is still a day away", () => {
    const decision = selectClaudeAccount({
      gauges: [spendOut({ alias: "plan-one", reset: "2026-09-18T14:00:00.000Z", week: 0.97 })],
    });
    expect(decision).toStrictEqual({
      earliestResetIso: FIVE_HOUR_RESET,
      excluded: [
        {
          alias: "plan-one",
          eligibleAtIso: "2026-09-18T14:00:00.000Z",
          kind: "routing-bar",
          reason: "seven_day at 97%",
        },
      ],
      kind: "all-exhausted",
    });
  });
});
