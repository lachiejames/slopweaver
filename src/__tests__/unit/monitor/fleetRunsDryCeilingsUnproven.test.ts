/**
 * `assessFleetDry` fires only when the absence of a route is measured capacity: a paused, unread or
 * non-capacity-refused plan, a plan with headroom no route took, or a fleet with no plan at all is unmeasurable.
 */
import { describe, expect, it } from "vitest";

import type { Ceiling } from "../../../capacity/ceilings.js";
import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";
import { CODEX_MONTHLY_SPEND_NOT_MEASURED, MONTHLY_SPEND_REASON_PREFIX } from "../../../plans/usageLimit.js";

import {
  dryReading,
  MONTHLY_CODEX,
  NOW,
  OPEN_MACHINE,
  ROUTING_BARS,
  readingOf,
  spentClaude,
} from "./fleetRunsDryFixtures.js";

const BOUNDS = {
  maxAgeMs: 2 * 3_600_000,
  minDryHours: 4,
  nowIso: NOW,
  registered: [],
  routingBars: ROUTING_BARS,
} as const;

/** The spent fleet with one more plan after it. */
function plus({ ceiling }: { ceiling: Ceiling }): ReturnType<typeof dryReading> {
  return readingOf({ ceilings: [...dryReading().ceilings, ceiling] });
}

const SPENT = spentClaude({ alias: "plan-three", resetAtIso: "2026-11-06T06:00:00.000Z" });

describe("assessFleetDry on a fleet it cannot prove spent", () => {
  it("is unmeasurable beside a paused plan", () => {
    const paused: Ceiling = { ...SPENT, reason: "paused: subscription lapsed", status: "paused", windows: [] };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: paused }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is paused, so its capacity is not measured: paused: subscription lapsed",
    });
  });

  it("is unmeasurable beside an unread plan", () => {
    const unread: Ceiling = { ...SPENT, headroom: null, reason: "probe timed out", status: "unreadable", windows: [] };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: unread }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is unreadable, so its capacity is not measured: probe timed out",
    });
  });

  it("is unmeasurable beside a plan refused for a reason no spent window shows", () => {
    const barred: Ceiling = {
      ...SPENT,
      reason: "within the spend-out span",
      windows: [{ available: 100, resetAtIso: "2026-11-06T06:00:00.000Z", used: 96, window: "seven-day" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: barred }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it: within the spend-out span",
    });
  });

  it("is unmeasurable beside a refused plan whose only spent window is the Fable week", () => {
    const fableOnly: Ceiling = {
      ...SPENT,
      reason: "within the spend-out span",
      windows: [
        { available: 100, resetAtIso: "2026-11-06T06:00:00.000Z", used: 96, window: "seven-day" },
        { available: 100, resetAtIso: "2026-11-05T16:00:00.000Z", used: 100, window: "fable-seven-day" },
      ],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: fableOnly }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it: within the spend-out span",
    });
  });

  it("is unmeasurable beside a refused plan whose only spent window is one it does not know", () => {
    const unknown: Ceiling = {
      ...SPENT,
      reason: null,
      windows: [{ available: 100, resetAtIso: "2026-11-05T16:00:00.000Z", used: 100, window: "seven_day_fable" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: unknown }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it",
    });
  });

  it("is unmeasurable beside a refused plan whose window allows nothing", () => {
    const empty: Ceiling = {
      ...SPENT,
      reason: null,
      windows: [{ available: 0, resetAtIso: "2026-11-06T06:00:00.000Z", used: 0, window: "seven-day" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: empty }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it",
    });
  });

  it("is unmeasurable beside a spent window whose reset is no calendar instant", () => {
    const impossible: Ceiling = {
      ...SPENT,
      reason: null,
      windows: [{ available: 100, resetAtIso: "2026-11-31T16:00:00.000Z", used: 100, window: "seven-day" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: impossible }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it",
    });
  });

  it("is unmeasurable beside a spent window whose reset has already passed", () => {
    const rolled: Ceiling = {
      ...SPENT,
      windows: [{ available: 100, resetAtIso: "2026-11-05T09:00:00.000Z", used: 100, window: "seven-day" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: rolled }) }).kind).toBe("unmeasurable");
  });

  it("is unmeasurable beside an open plan no route took", () => {
    const open: Ceiling = { ...SPENT, headroom: 0.4, reason: null, status: "open" };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: open }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is open to its router, so a seat could still start on it",
    });
  });

  it("is unmeasurable beside an open plan whose headroom rounded to zero", () => {
    // 99.9999% used rounds to 100.00 and zero headroom, while the router still admits the plan.
    const rounded: Ceiling = { ...SPENT, headroom: 0, reason: null, status: "open" };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: rounded }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is open to its router, so a seat could still start on it",
    });
  });

  it("is unmeasurable beside a refused plan still carrying headroom", () => {
    const refused: Ceiling = { ...SPENT, headroom: 0.4 };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: refused }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three still carries headroom that no route took",
    });
  });

  it("is unmeasurable on a week at its whole 100 under a week bar of 100, which a raw 99.995 rounds onto", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, SPENT] });
    const bars = { ...ROUTING_BARS, claudeWeek: 100 };
    expect(assessFleetDry({ ...BOUNDS, reading, routingBars: bars })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is refusing with no spent window resetting ahead, so no capacity measure explains it: seven-day at 100%",
    });
  });

  it("still proves a five-hour window at its whole 100 spent under a five-hour bar below 100", () => {
    const fiveHour: Ceiling = {
      ...SPENT,
      windows: [{ available: 100, resetAtIso: "2026-11-05T16:00:00.000Z", used: 100, window: "five-hour" }],
    };
    const reading = readingOf({ ceilings: [OPEN_MACHINE, fiveHour] });
    const bars = { ...ROUTING_BARS, claudeWeek: 100 };
    expect(assessFleetDry({ ...BOUNDS, reading, routingBars: bars }).kind).toBe("dry");
  });

  it("is unmeasurable beside a Claude monthly-spend plan with no fresh spend reading, which a router takes once read", () => {
    const unread: Ceiling = {
      ...SPENT,
      headroom: null,
      reason: `${MONTHLY_SPEND_REASON_PREFIX}no reading in the last hour`,
      status: "unreadable",
      windows: [],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: unread }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is unreadable, so its capacity is not measured: monthly spend: no reading in the last hour",
    });
  });

  it("is unmeasurable beside a Claude monthly-spend plan at its limit, whose spend window names no reset", () => {
    const atLimit: Ceiling = {
      ...SPENT,
      reason: "monthly spend at its usage limit",
      status: "at-usage-limit",
      windows: [{ available: 100, resetAtIso: null, used: 100, window: "monthly-spend" }],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: atLimit }) })).toEqual({
      kind: "unmeasurable",
      why: "claude:plan-three is at-usage-limit with no spent window resetting ahead, so no capacity measure explains it: monthly spend at its usage limit",
    });
  });

  it("never passes over a Claude plan carrying the Codex monthly-spend reason", () => {
    const impostor: Ceiling = { ...MONTHLY_CODEX, id: "claude:monthly", kind: "claude" };
    expect(assessFleetDry({ ...BOUNDS, reading: plus({ ceiling: impostor }) })).toEqual({
      kind: "unmeasurable",
      why: `claude:monthly is unreadable, so its capacity is not measured: ${CODEX_MONTHLY_SPEND_NOT_MEASURED}`,
    });
  });

  it("is unmeasurable when only a monthly-spend plan is configured", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, MONTHLY_CODEX] });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading carries no Claude or Codex plan a router could take",
    });
  });
});
