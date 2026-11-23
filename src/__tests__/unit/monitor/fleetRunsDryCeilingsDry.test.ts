/**
 * `assessFleetDry` fires when every routable Claude and Codex plan is measured spent: the interval ends at the
 * EARLIEST plan's return, and a plan with two spent windows returns only once the later has reset. A capture whose
 * routes or selection its own ceilings cannot reproduce contradicts itself, and never fires.
 */
import { describe, expect, it } from "vitest";

import { rejudgedReading } from "../../../capacity/admission.js";
import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";

import {
  cappedCodex,
  dryReading,
  MONTHLY_CODEX,
  NOW,
  OPEN_MACHINE,
  ROUTING_BARS,
  readingOf,
  SIX_HOURS,
  spentClaude,
  TWENTY_HOURS,
} from "./fleetRunsDryFixtures.js";

const BOUNDS = {
  maxAgeMs: 2 * 3_600_000,
  minDryHours: 4,
  nowIso: NOW,
  registered: [],
  routingBars: ROUTING_BARS,
} as const;

/** A route through a spent plan claiming the machine's headroom, which that plan's own zero headroom contradicts. */
const CLAIMED_ROUTE = {
  driver: "claude",
  headroom: 0.5,
  limitingCeilingId: "machine",
  planCeilingId: "claude:plan-one",
} as const;

describe("assessFleetDry on a spent fleet", () => {
  it("is dry until the first plan's reset, naming every spent plan and both providers", () => {
    expect(assessFleetDry({ ...BOUNDS, reading: dryReading() })).toEqual({
      interval: {
        exhaustedCeilingIds: ["claude:plan-one", "claude:plan-two", "codex:codex-one"],
        fromIso: NOW,
        providers: ["claude", "codex"],
        relievedByCeilingId: "claude:plan-two",
        routingBars: ROUTING_BARS,
        untilIso: SIX_HOURS,
      },
      kind: "dry",
    });
  });

  it("passes a monthly-spend plan over rather than reading it unmeasured", () => {
    const reading = readingOf({ ceilings: [...dryReading().ceilings, MONTHLY_CODEX] });
    const assessed = assessFleetDry({ ...BOUNDS, reading });
    expect(assessed.kind).toBe("dry");
  });

  it("returns a plan with a spent five-hour window inside a spent week only at the week's reset", () => {
    const both = spentClaude({ alias: "plan-one", resetAtIso: TWENTY_HOURS });
    const fiveHourSpent = {
      ...both,
      windows: [{ available: 100, resetAtIso: SIX_HOURS, used: 100, window: "five-hour" }, both.windows[1]!],
    };
    const reading = readingOf({ ceilings: [OPEN_MACHINE, fiveHourSpent] });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      interval: {
        exhaustedCeilingIds: ["claude:plan-one"],
        fromIso: NOW,
        providers: ["claude"],
        relievedByCeilingId: "claude:plan-one",
        routingBars: ROUTING_BARS,
        untilIso: TWENTY_HOURS,
      },
      kind: "dry",
    });
  });

  it("names Codex alone when Codex is the only provider configured", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, cappedCodex({ alias: "codex-one", resetAtIso: SIX_HOURS })] });
    const assessed = assessFleetDry({ ...BOUNDS, reading });
    expect(assessed).toEqual({
      interval: {
        exhaustedCeilingIds: ["codex:codex-one"],
        fromIso: NOW,
        providers: ["codex"],
        relievedByCeilingId: "codex:codex-one",
        routingBars: ROUTING_BARS,
        untilIso: SIX_HOURS,
      },
      kind: "dry",
    });
  });

  it("never fires on a spent fleet whose capture selected a route its own ceilings do not reproduce", () => {
    const selectedRoute = {
      driver: "claude",
      headroom: 0.5,
      limitingCeilingId: "machine",
      planCeilingId: "claude:plan-one",
    } as const;
    expect(assessFleetDry({ ...BOUNDS, reading: { ...dryReading(), selectedRoute } })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading selected a route through claude:plan-one that its own ceilings do not reproduce",
    });
  });

  it("never fires on a spent fleet whose captured route claims headroom its own ceilings do not reproduce", () => {
    const reading = { ...dryReading(), routes: [CLAIMED_ROUTE] };
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's route through claude:plan-one claims 0.5 headroom, which its own ceilings do not reproduce",
    });
  });

  it("never fires on a spent fleet whose captured route drives a plan of the other provider", () => {
    const route = { ...CLAIMED_ROUTE, driver: "codex", headroom: 0, limitingCeilingId: "claude:plan-one" } as const;
    expect(assessFleetDry({ ...BOUNDS, reading: { ...dryReading(), routes: [route] } })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading's codex route names claude:plan-one, which is no codex plan it carries",
    });
  });

  it("still fires when the captured route agrees with the ceilings it came with", () => {
    const agreed = rejudgedReading({ reading: { ...dryReading(), routes: [CLAIMED_ROUTE] } }).routes;
    expect(agreed.map((route) => route.planCeilingId)).toEqual(["claude:plan-one"]);
    expect(assessFleetDry({ ...BOUNDS, reading: { ...dryReading(), routes: agreed } }).kind).toBe("dry");
  });

  it("still fires on a usage-limited week under a whole-100 bar, since nothing rounds onto a limit below 100", () => {
    const reading = readingOf({ ceilings: [OPEN_MACHINE, cappedCodex({ alias: "codex-one", resetAtIso: SIX_HOURS })] });
    const bars = { ...ROUTING_BARS, codex: 100 };
    expect(assessFleetDry({ ...BOUNDS, reading, routingBars: bars }).kind).toBe("dry");
  });
});
