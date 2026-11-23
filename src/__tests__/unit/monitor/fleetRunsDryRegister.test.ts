/**
 * `assessFleetDry` against the plan register as it stands: a register that moved past the reading in a way that
 * could open a route — a plan added, a usage limit raised, a monthly plan moved onto a weekly window — is
 * unmeasurable, as is a ceiling whose id and kind disagree on its provider or that repeats a window; a register that
 * only removed capacity
 * leaves the fleet dry.
 */
import { describe, expect, it } from "vitest";

import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";
import { neverRouted, registerDrift } from "../../../monitor/fleetRunsDryRegister.js";

import {
  cappedCodex,
  DRY_REGISTER,
  dryReading,
  MONTHLY_CODEX,
  NOW,
  OPEN_MACHINE,
  ROUTING_BARS,
  readingOf,
  registered,
  SIX_HOURS,
  spentClaude,
} from "./fleetRunsDryFixtures.js";

const BOUNDS = { maxAgeMs: 2 * 3_600_000, minDryHours: 4, nowIso: NOW, routingBars: ROUTING_BARS } as const;

describe("assessFleetDry against the plan register", () => {
  it("fires when the register names exactly the plans the reading measured", () => {
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading(), registered: DRY_REGISTER }).kind).toBe("dry");
  });

  it("is unmeasurable when the register names a plan the reading never measured", () => {
    const plans = [...DRY_REGISTER, registered({ alias: "plan-three", provider: "claude" })];
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading(), registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the plan register names claude:plan-three, which the filed reading never measured",
    });
  });

  it("is unmeasurable when the register raised a usage limit past the one the reading measured", () => {
    const plans = [
      registered({ alias: "plan-one", provider: "claude" }),
      registered({ alias: "plan-two", provider: "claude" }),
      registered({ alias: "codex-one", provider: "codex", usageLimitPercent: 60 }),
    ];
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading(), registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the plan register raised codex:codex-one's usage limit to 60% since the filed reading measured 30%",
    });
  });

  it("still fires when the register only lowered a usage limit", () => {
    const plans = [
      registered({ alias: "plan-one", provider: "claude" }),
      registered({ alias: "plan-two", provider: "claude" }),
      registered({ alias: "codex-one", provider: "codex", usageLimitPercent: 20 }),
    ];
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading(), registered: plans }).kind).toBe("dry");
  });

  it("still fires when the register dropped a plan the reading measured spent", () => {
    const plans = DRY_REGISTER.filter((plan) => plan.alias !== "plan-two");
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading(), registered: plans }).kind).toBe("dry");
  });

  it("is unmeasurable when a plan read as monthly spend is now registered on a weekly window", () => {
    const reading = readingOf({
      ceilings: [OPEN_MACHINE, spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS }), MONTHLY_CODEX],
    });
    const plans = [
      registered({ alias: "plan-one", provider: "claude" }),
      registered({ alias: "monthly", provider: "codex" }),
    ];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the plan register now measures codex:monthly on a weekly window, which the filed reading read as monthly spend",
    });
  });

  it("is unmeasurable when a ceiling's id names one provider and its kind another", () => {
    const impostor = { ...spentClaude({ alias: "work", resetAtIso: SIX_HOURS }), id: "codex:work" };
    const reading = readingOf({ ceilings: [OPEN_MACHINE, impostor] });
    const plans = [registered({ alias: "work", provider: "codex" })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's ceiling codex:work is a claude plan, so its id names no plan it measured",
    });
  });

  it("is unmeasurable when a ceiling carries one window name twice", () => {
    const twice = {
      ...spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS }),
      windows: [
        { available: 60, resetAtIso: SIX_HOURS, used: 30, window: "seven-day" },
        { available: 30, resetAtIso: SIX_HOURS, used: 30, window: "seven-day" },
      ],
    };
    const reading = readingOf({ ceilings: [OPEN_MACHINE, twice] });
    const plans = [registered({ alias: "plan-one", provider: "claude", usageLimitPercent: 60 })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's ceiling claude:plan-one carries its seven-day window twice, so it measures nothing",
    });
  });

  it("is unmeasurable when the machine ceiling carries another id", () => {
    const misnamed = { ...OPEN_MACHINE, id: "not-machine" };
    const reading = readingOf({ ceilings: [misnamed, spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS })] });
    const plans = [registered({ alias: "plan-one", provider: "claude" })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's ceiling not-machine is the machine under another id, so it measures no machine",
    });
  });

  it("is unmeasurable when two ceilings carry one id", () => {
    const stale = {
      ...spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS }),
      windows: [{ available: 30, resetAtIso: SIX_HOURS, used: 30, window: "seven-day" }],
    };
    const ceilings = [OPEN_MACHINE, stale, spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS })];
    const plans = [registered({ alias: "plan-one", provider: "claude" })];
    expect(assessFleetDry({ ...BOUNDS, reading: readingOf({ ceilings }), registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading carries the ceiling claude:plan-one twice, so it measures nothing",
    });
  });

  it("is unmeasurable when a measured plan carries no window its usage limit lowers", () => {
    const fiveHourOnly = {
      ...spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS }),
      windows: [{ available: 100, resetAtIso: SIX_HOURS, used: 100, window: "five-hour" }],
    };
    const reading = readingOf({ ceilings: [OPEN_MACHINE, fiveHourOnly] });
    const plans = [registered({ alias: "plan-one", provider: "claude" })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's ceiling claude:plan-one carries no seven-day window, so the usage limit it was read under is not measured",
    });
  });

  it("is unmeasurable when a Claude plan read spent on its week is now registered on monthly spend", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS })] });
    const plans = [registered({ alias: "plan-one", allowance: "monthly-spend", provider: "claude" })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans })).toEqual({
      kind: "unmeasurable",
      why: "the plan register measures claude:plan-one in monthly spend, which a router takes on a fresh spend reading no window here proves spent",
    });
  });

  it("still fires when a Codex plan read spent on its week is now registered on monthly spend, which nothing routes", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, cappedCodex({ alias: "codex-one", resetAtIso: SIX_HOURS })] });
    const plans = [registered({ alias: "codex-one", allowance: "monthly-spend", provider: "codex" })];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans }).kind).toBe("dry");
  });

  it("still fires beside a monthly-spend plan the register still measures in spend", () => {
    const reading = readingOf({
      ceilings: [OPEN_MACHINE, spentClaude({ alias: "plan-one", resetAtIso: SIX_HOURS }), MONTHLY_CODEX],
    });
    const plans = [
      registered({ alias: "plan-one", provider: "claude" }),
      registered({ alias: "monthly", allowance: "monthly-spend", provider: "codex" }),
    ];
    expect(assessFleetDry({ ...BOUNDS, reading, registered: plans }).kind).toBe("dry");
  });
});

describe("registerDrift", () => {
  it("names nothing when the register is exactly what the reading measured", () => {
    expect(registerDrift({ ceilings: dryReading().ceilings, plans: DRY_REGISTER })).toBe(undefined);
  });

  it("names the first plan the reading never measured", () => {
    const plans = [registered({ alias: "plan-three", provider: "claude" }), ...DRY_REGISTER];
    expect(registerDrift({ ceilings: dryReading().ceilings, plans })).toBe(
      "the plan register names claude:plan-three, which the filed reading never measured",
    );
  });
});

describe("neverRouted", () => {
  it("passes over a Codex monthly-spend plan", () => {
    expect(neverRouted({ ceiling: MONTHLY_CODEX })).toBe(true);
  });

  it("never passes over a Claude ceiling carrying the Codex monthly-spend reason", () => {
    expect(neverRouted({ ceiling: { ...MONTHLY_CODEX, id: "claude:monthly", kind: "claude" } })).toBe(false);
  });

  it("never passes over a Codex plan at its usage limit", () => {
    expect(neverRouted({ ceiling: cappedCodex({ alias: "codex-one", resetAtIso: SIX_HOURS }) })).toBe(false);
  });
});
