/**
 * What a watch tick hands the rotation trigger: the slot's own reading re-stamped onto the active plan carries THAT
 * plan's usage limit, and a held plan is out of the choice.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount, ClaudeAccountGauge } from "../../../claude/contracts.js";
import { EMPTY_ROTATION_STATE } from "../../../claude/rotationState.js";
import { decideTrigger, heldPlans } from "../../../claude/watchTickTrigger.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

const NOW = "2026-11-04T00:00:00.000Z";
const RESET = "2026-11-09T00:00:00.000Z";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-a", allowance: { kind: "weekly-window" }, storeDir: "/fixture/a", usageLimitPercent: 30 },
  { alias: "plan-b", allowance: { kind: "weekly-window" }, storeDir: "/fixture/b", usageLimitPercent: 100 },
];

/**
 * One reading at a weekly utilization.
 *
 * @param alias which plan the reading is filed under
 * @param week the seven-day utilization, 0..1
 * @returns the reading
 */
function gauge({ alias, week }: { alias: string; week: number }): ClaudeAccountGauge {
  return {
    alias,
    observedAtIso: NOW,
    sevenDay: { resetAtIso: RESET, status: "allowed", utilization: week },
    sevenDayFable: { resetAtIso: RESET, status: "allowed", utilization: 0.1 },
  };
}

describe("decideTrigger", () => {
  it("judges the slot's reading against the active plan's own usage limit and rotates off it", () => {
    const outcome = decideTrigger({
      accounts: ACCOUNTS,
      active: "plan-a",
      activeFrom: "identified",
      activeSlotGauge: gauge({ alias: "active-slot", week: 0.4 }),
      gauges: [gauge({ alias: "plan-b", week: 0.1 })],
      held: [],
      seat: "worker",
      spends: [],
      thresholds: THRESHOLDS,
    });
    expect([outcome.act, outcome.why]).toStrictEqual([
      "rotate",
      "seven_day usage limit of 30% reached the rotation threshold before a wall",
    ]);
  });

  it("rotates off a plan at 80% only once the install's route bar is lowered under it", () => {
    const input = {
      accounts: ACCOUNTS,
      active: "plan-b",
      activeFrom: "identified",
      activeSlotGauge: gauge({ alias: "active-slot", week: 0.8 }),
      gauges: [gauge({ alias: "plan-a", week: 0.1 })],
      held: [],
      seat: "worker",
      spends: [],
    } as const;
    expect(decideTrigger({ ...input, thresholds: THRESHOLDS }).act).toBe("hold");
    expect(decideTrigger({ ...input, thresholds: { ...THRESHOLDS, routeAt: 0.7 } }).act).toBe("rotate");
  });

  it("holds when the active plan's only reading is held out, since its budget is unread", () => {
    const outcome = decideTrigger({
      accounts: ACCOUNTS,
      active: "plan-a",
      activeFrom: "identified",
      activeSlotGauge: gauge({ alias: "active-slot", week: 0.4 }),
      gauges: [],
      held: ["plan-a"],
      seat: "worker",
      spends: [],
      thresholds: THRESHOLDS,
    });
    expect(outcome).toStrictEqual({
      act: "hold",
      why: "no reading for the active plan, so its remaining budget is unknown",
    });
  });

  it("keeps a held active monthly-spend plan's closed verdict, and rotates off it rather than holding", () => {
    const outcome = decideTrigger({
      accounts: ACCOUNTS,
      active: "plan-m",
      activeFrom: "deduced",
      gauges: [gauge({ alias: "plan-b", week: 0.1 })],
      held: ["plan-m"],
      seat: "worker",
      spends: [{ alias: "plan-m", verdict: { kind: "usage-limit", reason: "at its limit" } }],
      thresholds: THRESHOLDS,
    });
    expect(outcome).toMatchObject({ act: "rotate", decision: { kind: "rotate", to: "plan-b" } });
  });

  it("never rotates onto a held monthly-spend plan, however open its verdict", () => {
    const open = { currency: "USD", headroomMinor: 6000, kind: "open", reason: "open", usedFraction: 0.4 } as const;
    const outcome = decideTrigger({
      accounts: ACCOUNTS,
      active: "plan-m",
      activeFrom: "deduced",
      gauges: [],
      held: ["plan-n"],
      seat: "worker",
      spends: [
        { alias: "plan-m", verdict: { kind: "usage-limit", reason: "at its limit" } },
        { alias: "plan-n", verdict: open },
      ],
      thresholds: THRESHOLDS,
    });
    expect(outcome).toMatchObject({ act: "rotate", decision: { kind: "all-exhausted" } });
  });
});

describe("heldPlans", () => {
  it("names a plan under an unexpired hold and not one whose hold has passed", () => {
    const state = {
      ...EMPTY_ROTATION_STATE,
      unavailable: [
        { alias: "plan-a", reason: "seven_day refused", untilIso: RESET },
        { alias: "plan-b", reason: "seven_day refused", untilIso: "2026-11-01T00:00:00.000Z" },
      ],
    };
    expect(heldPlans({ aliases: ["plan-a", "plan-b"], nowIso: NOW, state })).toStrictEqual(["plan-a"]);
  });
});
