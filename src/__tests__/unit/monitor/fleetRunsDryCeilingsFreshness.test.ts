/**
 * `assessFleetDry` judges a filed reading only inside its freshness bound, the boundary itself included: an older,
 * future-dated or undated reading is unmeasurable, never dry and never clear.
 */
import { describe, expect, it } from "vitest";

import { assessFleetDry, FLEET_DRY_MAX_AGE_MS } from "../../../monitor/fleetRunsDryCeilings.js";

import { dryReading, NOW, ROUTING_BARS, readingOf } from "./fleetRunsDryFixtures.js";

/** The same spent fleet, observed at `observedAtIso`. */
function observedAt({ observedAtIso }: { observedAtIso: string }): ReturnType<typeof dryReading> {
  return readingOf({ ceilings: dryReading().ceilings, observedAtIso });
}

const BOUNDS = {
  maxAgeMs: FLEET_DRY_MAX_AGE_MS,
  minDryHours: 4,
  nowIso: NOW,
  registered: [],
  routingBars: ROUTING_BARS,
} as const;

describe("assessFleetDry's freshness bound", () => {
  it("is two hours", () => {
    expect(FLEET_DRY_MAX_AGE_MS).toBe(7_200_000);
  });

  it("judges a reading exactly at the bound", () => {
    const reading = observedAt({ observedAtIso: "2026-11-05T08:00:00.000Z" });
    expect(assessFleetDry({ ...BOUNDS, reading }).kind).toBe("dry");
  });

  it("refuses a reading one millisecond past the bound", () => {
    const reading = observedAt({ observedAtIso: "2026-11-05T07:59:59.999Z" });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading is 121 minutes old, past the 120-minute bound",
    });
  });

  it("refuses a reading observed after the instant judged", () => {
    const reading = observedAt({ observedAtIso: "2026-11-05T10:00:00.001Z" });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: "the filed reading was observed at 2026-11-05T10:00:00.001Z, after the instant judged",
    });
  });

  it("refuses a reading whose observed instant does not parse", () => {
    const reading = observedAt({ observedAtIso: "yesterday" });
    expect(assessFleetDry({ ...BOUNDS, reading })).toEqual({
      kind: "unmeasurable",
      why: 'the filed reading\'s observedAtIso is not an instant: "yesterday"',
    });
  });

  it("refuses an observed instant that is a calendar impossibility, never rolling it forward", () => {
    const reading = observedAt({ observedAtIso: "2026-11-31T09:00:00.000Z" });
    expect(assessFleetDry({ ...BOUNDS, nowIso: "2026-12-01T09:00:00.000Z", reading })).toEqual({
      kind: "unmeasurable",
      why: 'the filed reading\'s observedAtIso is not an instant: "2026-11-31T09:00:00.000Z"',
    });
  });
});
