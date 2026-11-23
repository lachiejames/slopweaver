import { describe, expect, it } from "vitest";

import type { ClaudePlanGauge, ClaudeWindowStatus } from "../../../claude/contracts.js";
import { classifyLimitRecord } from "../../../claude/transcriptSignal.js";
import { type PlanAllowance, type UsageLimitPercent, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { triggerDecision } from "./defaultThresholds.js";

/** One plan's paired gauge; defaults are a healthy weekly-window plan with no usage limit set. */
function gauge({
  alias,
  allowance = WEEKLY_WINDOW,
  fiveHour = 0.1,
  fiveHourStatus = "allowed",
  sevenDay = 0.1,
  sevenDayStatus = "allowed",
  usageLimitPercent = 100,
}: {
  alias: string;
  allowance?: PlanAllowance;
  fiveHour?: number;
  fiveHourStatus?: ClaudeWindowStatus;
  sevenDay?: number;
  sevenDayStatus?: ClaudeWindowStatus;
  usageLimitPercent?: UsageLimitPercent;
}): ClaudePlanGauge {
  return {
    alias,
    allowance,
    fiveHour: { resetAtIso: "2026-09-05T00:00:00.000Z", status: fiveHourStatus, utilization: fiveHour },
    observedAtIso: "2026-09-04T12:00:00.000Z",
    sevenDay: { resetAtIso: "2026-09-11T00:00:00.000Z", status: sevenDayStatus, utilization: sevenDay },
    usageLimitPercent,
  };
}

const FLEET = [gauge({ alias: "plan-one" }), gauge({ alias: "plan-two" })];

describe("triggerDecision — the reactive half", () => {
  it("rotates when a session-limit refusal lands", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: FLEET,
      seat: "worker",
      signal: { claim: "five_hour", kind: "plan-limit", reason: "session limit refused" },
    });
    expect(out.act).toBe("rotate");
    expect(out.why).toBe("five_hour refused worker");
  });

  it("ROTATES for the supervisor chair on a Fable-class wall — the whole point of tonight", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: FLEET,
      seat: "supervisor-chair",
      signal: { claim: "seven_day_opus", kind: "plan-limit", reason: "model wall" },
    });
    expect(out.act).toBe("rotate");
  });

  it("changes model rather than plan for a WORKER on the same wall", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: FLEET,
      seat: "worker",
      signal: { claim: "seven_day_opus", kind: "plan-limit", reason: "model wall" },
    });
    expect(out.act).toBe("downgrade-model");
  });

  it("holds on a 529, which outnumbered real weekly limits four to one on this machine", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: FLEET,
      seat: "worker",
      signal: { kind: "ignored", reason: "apiErrorStatus 529 is not a plan limit" },
    });
    expect(out.act).toBe("hold");
    expect(out.why).toContain("529");
  });

  it("holds on a spend limit, which is a different budget entirely", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: FLEET,
      seat: "worker",
      signal: { kind: "ignored", reason: "individual spend limit — a different budget" },
    });
    expect(out.act).toBe("hold");
  });

  it("still rotates off a monthly-spend plan at its usage limit when the same tick carries an ignored line", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-two" })],
      seat: "worker",
      signal: { kind: "ignored", reason: "apiErrorStatus 529 is not a plan limit" },
      spends: [
        { alias: "plan-one", verdict: { kind: "usage-limit", reason: "50.00 USD of 100.00 USD, at its limit" } },
      ],
    });
    expect([out.act, out.why]).toEqual([
      "rotate",
      "monthly spend usage-limit (50.00 USD of 100.00 USD, at its limit) moved the fleet before a wall",
    ]);
  });

  it("rotates off a monthly-spend plan at its usage limit when a worker meets a model wall on it", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-two" })],
      seat: "worker",
      signal: { claim: "seven_day_opus", kind: "plan-limit", reason: "model wall" },
      spends: [
        { alias: "plan-one", verdict: { kind: "usage-limit", reason: "50.00 USD of 100.00 USD, at its limit" } },
      ],
    });
    expect(out).toMatchObject({ act: "rotate", decision: { kind: "rotate", to: "plan-two" } });
  });

  it("holds a weekly plan on an ignored line as it always has, its threshold left to the next tick", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHour: 0.96 }), gauge({ alias: "plan-two" })],
      seat: "worker",
      signal: { kind: "ignored", reason: "apiErrorStatus 529 is not a plan limit" },
    });
    expect(out).toEqual({ act: "hold", why: "not a plan limit: apiErrorStatus 529 is not a plan limit" });
  });
});

describe("triggerDecision — the proactive half", () => {
  it("rotates at the threshold, BEFORE a wall, with no signal at all", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHour: 0.96 }), gauge({ alias: "plan-two" })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out.why).toContain("before a wall");
  });

  it("rotates on allowed_warning, the provider's own approaching-limit signal", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHourStatus: "allowed_warning" }), gauge({ alias: "plan-two" })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
  });

  it("holds while the active plan has headroom, so the fleet is not churned", () => {
    const out = triggerDecision({ active: "plan-one", gauges: FLEET, seat: "worker" });
    expect(out.act).toBe("hold");
    expect(out.why).toBe("the active plan has plan-wide headroom");
  });

  it("respects the reserved plan when it rotates", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHour: 0.95 }), gauge({ alias: "browser" }), gauge({ alias: "plan-two" })],
      reserved: "browser",
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out).toMatchObject({ decision: { to: "plan-two" } });
  });

  it("reports every plan exhausted rather than rotating nowhere", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", fiveHour: 0.99 }), gauge({ alias: "plan-two", fiveHour: 0.99 })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out).toMatchObject({ decision: { kind: "all-exhausted" } });
  });

  it("rotates off a plan at the usage limit set on it, and names the limit", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", sevenDay: 0.3, usageLimitPercent: 30 }), gauge({ alias: "plan-two" })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out.why).toBe("seven_day usage limit of 30% reached the rotation threshold before a wall");
    expect(out).toMatchObject({ decision: { kind: "rotate", to: "plan-two" } });
  });

  it("holds a plan under its usage limit, and never trips the limit from the five-hour window", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [
        gauge({ alias: "plan-one", fiveHour: 0.3, sevenDay: 0.29, usageLimitPercent: 30 }),
        gauge({ alias: "plan-two" }),
      ],
      seat: "worker",
    });
    expect(out.act).toBe("hold");
  });

  it("still rotates off a REJECTED week at the bar on a legacy 100% row, as it did before the limit existed", () => {
    // Reading the week through the routing exclusion classified it as
    // provider-refused and HELD on a fully spent plan.
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", sevenDay: 1, sevenDayStatus: "rejected" }), gauge({ alias: "plan-two" })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out.why).toBe("seven_day reached the rotation threshold before a wall");
    expect(out).toMatchObject({ decision: { kind: "rotate", to: "plan-two" } });
  });

  it("rotates off a monthly-spend plan's gauge, should one reach the window gate, since its spend is its measure", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-one", allowance: { kind: "monthly-spend" } }), gauge({ alias: "plan-two" })],
      seat: "worker",
    });
    expect(out.act).toBe("rotate");
    expect(out.why).toBe(
      "a monthly-spend plan's windows (its spend is its measure) reached the rotation threshold before a wall",
    );
  });
});

describe("triggerDecision — an active monthly-spend plan, judged on its spend", () => {
  const OPEN = {
    currency: "USD",
    headroomMinor: 6000,
    kind: "open",
    reason: "$40 of $100",
    usedFraction: 0.4,
  } as const;

  it("rotates before a wall once its spend reaches the usage limit, naming the verdict", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-two" })],
      seat: "worker",
      spends: [{ alias: "plan-one", verdict: { kind: "usage-limit", reason: "$50 of $100, at its usage limit" } }],
    });
    expect([out.act, out.why]).toStrictEqual([
      "rotate",
      "monthly spend usage-limit ($50 of $100, at its usage limit) moved the fleet before a wall",
    ]);
    expect(out).toMatchObject({ decision: { kind: "rotate", to: "plan-two" } });
  });

  it("rotates to an eligible weekly plan while its spend is still open, since monthly is the fallback lane", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-two" })],
      seat: "worker",
      spends: [{ alias: "plan-one", verdict: OPEN }],
    });
    expect([out.act, out.why]).toStrictEqual([
      "rotate",
      "plan-two is preferred over monthly spend, which is the fallback lane",
    ]);
  });

  it("holds while its spend is open and no weekly plan is eligible, saying what it has spent", () => {
    const out = triggerDecision({
      active: "plan-one",
      gauges: [gauge({ alias: "plan-two", sevenDay: 1, sevenDayStatus: "rejected" })],
      seat: "worker",
      spends: [{ alias: "plan-one", verdict: OPEN }],
    });
    expect(out).toStrictEqual({ act: "hold", why: "the active plan is under its monthly usage limit: $40 of $100" });
  });
});

/**
 * The seam that unit tests could not see. Every case above builds its signal by hand; these build it the way
 * the real code does, from a transcript record, because the chair rule was UNREACHABLE for its first hour:
 * the classifier swallowed a model wall as "ignored" and dropped the claim, so the trigger held and the
 * chair would have sat on a spent Fable budget.
 */
describe("classifier to trigger, end to end", () => {
  const modelWall = {
    apiErrorStatus: 429,
    isApiErrorMessage: true,
    message: { content: [{ text: "You've reached your Fable limit. Run /usage-credits to continue", type: "text" }] },
  };

  it("carries a model wall all the way to a ROTATION for the supervisor chair", () => {
    const signal = classifyLimitRecord({ record: modelWall });
    expect(signal.kind).toBe("plan-limit");
    const out = triggerDecision({ active: "plan-one", gauges: FLEET, seat: "supervisor-chair", signal });
    expect(out.act).toBe("rotate");
  });

  it("carries the same wall to a MODEL DOWNGRADE for a worker", () => {
    const signal = classifyLimitRecord({ record: modelWall });
    const out = triggerDecision({ active: "plan-one", gauges: FLEET, seat: "worker", signal });
    expect(out.act).toBe("downgrade-model");
  });

  it("names the Sonnet claim when Sonnet is what refused", () => {
    const signal = classifyLimitRecord({
      record: { ...modelWall, message: { content: [{ text: "You've reached your Sonnet limit.", type: "text" }] } },
    });
    expect(signal.claim).toBe("seven_day_sonnet");
  });

  it("still holds the fleet on a 529, through the same seam", () => {
    const signal = classifyLimitRecord({
      record: { apiErrorStatus: 529, isApiErrorMessage: true, message: { content: "API Error: 529 Overloaded" } },
    });
    const out = triggerDecision({ active: "plan-one", gauges: FLEET, seat: "supervisor-chair", signal });
    expect(out.act).toBe("hold");
  });

  it("still rotates the chair on a genuine session limit, through the same seam", () => {
    const signal = classifyLimitRecord({
      record: {
        apiErrorStatus: 429,
        isApiErrorMessage: true,
        message: { content: "You've hit your session limit · resets 4:50am" },
      },
    });
    const out = triggerDecision({ active: "plan-one", gauges: FLEET, seat: "supervisor-chair", signal });
    expect(out.act).toBe("rotate");
  });
});
