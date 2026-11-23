import { describe, expect, it } from "vitest";

import { claudeCardAlertPoint, claudeChairAlertPoint } from "../../../claude/budgetAlertPoint.js";
import type { ClaudeWindowReading } from "../../../claude/contracts.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;
const OBSERVED = "2026-09-07T18:45:00.000Z";
/** Days after {@link OBSERVED}: no spend-out lift. */
const FAR_RESET = "2026-09-13T22:00:00.000Z";
/** Two and a quarter hours after {@link OBSERVED}: inside the last five hours, where routing lifts to the wall. */
const NEAR_RESET = "2026-09-07T21:00:00.000Z";

const reading = ({ resetAtIso = FAR_RESET }: { resetAtIso?: string } = {}): ClaudeWindowReading => ({
  resetAtIso,
  status: "allowed",
  utilization: 0.1,
});

describe("claudeCardAlertPoint", () => {
  it("sits alertAt of the way to a binding weekly limit: 37.5% on a 50% plan", () => {
    expect(
      claudeCardAlertPoint({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        thresholds: THRESHOLDS,
        usageLimitPercent: 50,
        window: reading(),
      }),
    ).toStrictEqual({ source: "usage-limit", utilization: 0.375 });
  });

  it("rebases the Fable week the same way", () => {
    expect(
      claudeCardAlertPoint({
        claim: "seven_day_fable",
        observedAtIso: OBSERVED,
        thresholds: THRESHOLDS,
        usageLimitPercent: 50,
        window: reading(),
      }),
    ).toStrictEqual({ source: "usage-limit", utilization: 0.375 });
  });

  it("leaves the five-hour window on the absolute bar, since the limit is a share of the week", () => {
    expect(
      claudeCardAlertPoint({
        claim: "five_hour",
        observedAtIso: OBSERVED,
        thresholds: THRESHOLDS,
        usageLimitPercent: 50,
        window: reading(),
      }),
    ).toStrictEqual({ source: "routing-bar", utilization: 0.75 });
  });

  it("keeps an unlimited week at the absolute bar, far from its reset and inside its last five hours alike", () => {
    const far = claudeCardAlertPoint({
      claim: "seven_day",
      observedAtIso: OBSERVED,
      thresholds: THRESHOLDS,
      usageLimitPercent: 100,
      window: reading(),
    });
    const near = claudeCardAlertPoint({
      claim: "seven_day",
      observedAtIso: OBSERVED,
      thresholds: THRESHOLDS,
      usageLimitPercent: 100,
      window: reading({ resetAtIso: NEAR_RESET }),
    });
    expect(far).toStrictEqual({ source: "routing-bar", utilization: 0.75 });
    expect(near).toStrictEqual({ source: "routing-bar", utilization: 0.75 });
  });

  it("moves with the install's alert bar: 0.6 of a 50% limit is 30%", () => {
    expect(
      claudeCardAlertPoint({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        thresholds: { ...THRESHOLDS, alertAt: 0.6 },
        usageLimitPercent: 50,
        window: reading(),
      }),
    ).toStrictEqual({ source: "usage-limit", utilization: 0.3 });
  });
});

describe("claudeChairAlertPoint", () => {
  it("sits routeAt of the way to a binding weekly limit: 47.5% on a 50% plan, inside the last five hours too", () => {
    const far = claudeChairAlertPoint({
      claim: "seven_day",
      observedAtIso: OBSERVED,
      thresholds: THRESHOLDS,
      usageLimitPercent: 50,
      window: reading(),
    });
    const near = claudeChairAlertPoint({
      claim: "seven_day",
      observedAtIso: OBSERVED,
      thresholds: THRESHOLDS,
      usageLimitPercent: 50,
      window: reading({ resetAtIso: NEAR_RESET }),
    });
    expect(far).toStrictEqual({ source: "usage-limit", utilization: 0.475 });
    expect(near).toStrictEqual({ source: "usage-limit", utilization: 0.475 });
  });

  it("keeps an unlimited week at the UN-lifted routing bar, even where routing spends it to the wall", () => {
    expect(
      claudeChairAlertPoint({
        claim: "seven_day",
        observedAtIso: OBSERVED,
        thresholds: THRESHOLDS,
        usageLimitPercent: 100,
        window: reading({ resetAtIso: NEAR_RESET }),
      }),
    ).toStrictEqual({ source: "routing-bar", utilization: 0.95 });
  });

  it("keeps the five-hour window at the routing bar on a limited plan", () => {
    expect(
      claudeChairAlertPoint({
        claim: "five_hour",
        observedAtIso: OBSERVED,
        thresholds: THRESHOLDS,
        usageLimitPercent: 50,
        window: reading(),
      }),
    ).toStrictEqual({ source: "routing-bar", utilization: 0.95 });
  });
});
