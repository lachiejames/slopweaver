/**
 * `assessFleetDry` is clear when the re-judged reading has a route above zero, or when the first plan comes back
 * inside the threshold — and dry at the threshold exactly.
 */
import { describe, expect, it } from "vitest";

import type { Ceiling, CeilingsReading } from "../../../capacity/ceilings.js";
import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";

import {
  dryReading,
  NOW,
  OPEN_MACHINE,
  ROUTING_BARS,
  readingOf,
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

/** One spent Claude plan whose week resets at `resetAtIso`, alone beside the machine. */
function resettingAt({ resetAtIso }: { resetAtIso: string }): CeilingsReading {
  return readingOf({ ceilings: [OPEN_MACHINE, spentClaude({ alias: "plan-one", resetAtIso })] });
}

describe("assessFleetDry on a fleet with a route, or a short interval", () => {
  it("is clear when a captured route re-judges above zero, whatever selectedRoute the capture says", () => {
    const open: Ceiling = {
      ...spentClaude({ alias: "plan-three", resetAtIso: TWENTY_HOURS }),
      headroom: 0.4,
      reason: null,
      status: "open",
    };
    const reading: CeilingsReading = {
      ...readingOf({ ceilings: [...dryReading().ceilings, open] }),
      routes: [
        { driver: "claude", headroom: 0, limitingCeilingId: "claude:plan-three", planCeilingId: "claude:plan-three" },
      ],
    };
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "clear",
      why: "a seat can start through claude:plan-three",
    });
  });

  it("is clear on a selected route even beside a paused plan, because a seat can start", () => {
    const open: Ceiling = {
      ...spentClaude({ alias: "plan-three", resetAtIso: TWENTY_HOURS }),
      headroom: 0.4,
      reason: null,
      status: "open",
    };
    const paused: Ceiling = {
      ...spentClaude({ alias: "plan-four", resetAtIso: TWENTY_HOURS }),
      reason: "paused: subscription lapsed",
      status: "paused",
      windows: [],
    };
    const reading: CeilingsReading = {
      ...readingOf({ ceilings: [OPEN_MACHINE, paused, open] }),
      routes: [
        { driver: "claude", headroom: 0.4, limitingCeilingId: "claude:plan-three", planCeilingId: "claude:plan-three" },
      ],
    };
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "clear",
      why: "a seat can start through claude:plan-three",
    });
  });

  it("is clear on a selected route even when another provider failed to read", () => {
    const open: Ceiling = {
      ...spentClaude({ alias: "plan-three", resetAtIso: TWENTY_HOURS }),
      headroom: 0.4,
      reason: null,
      status: "open",
    };
    const reading: CeilingsReading = {
      ...readingOf({ ceilings: [OPEN_MACHINE, open] }),
      problems: ["codex fleet: register unavailable"],
      routes: [
        { driver: "claude", headroom: 0.4, limitingCeilingId: "claude:plan-three", planCeilingId: "claude:plan-three" },
      ],
    };
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "clear",
      why: "a seat can start through claude:plan-three",
    });
  });

  it("is clear when the first plan resets inside the threshold", () => {
    const reading = resettingAt({ resetAtIso: "2026-11-05T13:59:59.999Z" });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "clear",
      why: "claude:plan-one resets at 2026-11-05T13:59:59.999Z, inside the 4-hour threshold",
    });
  });

  it("is dry when the first plan resets exactly at the threshold", () => {
    const reading = resettingAt({ resetAtIso: "2026-11-05T14:00:00.000Z" });
    expect(assessFleetDry({ ...BOUNDS, reading }).kind).toBe("dry");
  });
});
