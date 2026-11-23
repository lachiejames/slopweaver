/**
 * `assessFleetDry` reads a held or unread machine, or a provider-level read failure, as unmeasurable: neither is
 * provider capacity, so neither is a dry fleet.
 */
import { describe, expect, it } from "vitest";

import type { Ceiling } from "../../../capacity/ceilings.js";
import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";

import { dryReading, NOW, OPEN_MACHINE, ROUTING_BARS, readingOf } from "./fleetRunsDryFixtures.js";

const BOUNDS = {
  maxAgeMs: 2 * 3_600_000,
  minDryHours: 4,
  nowIso: NOW,
  registered: [],
  routingBars: ROUTING_BARS,
} as const;

/** The spent fleet with its machine replaced. */
function withMachine({ machine }: { machine: Ceiling }): ReturnType<typeof dryReading> {
  const [, ...plans] = dryReading().ceilings;
  return readingOf({ ceilings: [machine, ...plans] });
}

describe("assessFleetDry beside the machine and the provider reads", () => {
  it("is unmeasurable while the machine holds", () => {
    const machine: Ceiling = { ...OPEN_MACHINE, headroom: 0, reason: "hold on cpu", status: "held" };
    expect(assessFleetDry({ ...BOUNDS, reading: withMachine({ machine }) })).toEqual({
      kind: "unmeasurable",
      why: "the machine is held, so no provider's capacity is what stops a seat: hold on cpu",
    });
  });

  it("is unmeasurable while the machine's load is unread", () => {
    const machine: Ceiling = {
      ...OPEN_MACHINE,
      headroom: null,
      reason: "the 1-minute load could not be read",
      status: "unreadable",
      windows: [],
    };
    expect(assessFleetDry({ ...BOUNDS, reading: withMachine({ machine }) })).toEqual({
      kind: "unmeasurable",
      why: "the machine is unreadable, so no provider's capacity is what stops a seat: the 1-minute load could not be read",
    });
  });

  it("is unmeasurable when a provider's plans did not read", () => {
    const reading = { ...dryReading(), problems: ["codex fleet: the register could not be read"] };
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: "a provider's plans did not read: codex fleet: the register could not be read",
    });
  });
});
