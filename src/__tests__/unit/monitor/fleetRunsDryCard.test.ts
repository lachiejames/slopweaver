/**
 * `fleetRunsDryReading` turns a dry interval into ONE card naming both providers, its decision whole, and passes a
 * clear or unmeasurable assessment through untouched.
 */
import { describe, expect, it } from "vitest";

import { fleetRunsDryReading } from "../../../monitor/fleetRunsDry.js";
import { assessFleetDry } from "../../../monitor/fleetRunsDryCeilings.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { FiringReading, MonitorSubject } from "../../../monitor/types.js";

import { dryReading, NOW, ROUTING_BARS } from "./fleetRunsDryFixtures.js";

const READING = dryReading();
const DRY = assessFleetDry({
  maxAgeMs: 7_200_000,
  minDryHours: 4,
  nowIso: NOW,
  reading: READING,
  registered: [],
  routingBars: ROUTING_BARS,
});

/** The one subject the dry fixture fires on. */
function firedSubject(): MonitorSubject {
  const reading = fleetRunsDryReading({ assessment: DRY, reading: READING }) as FiringReading;
  expect(reading.state).toBe("firing");
  expect(reading.subjects).toHaveLength(1);
  return reading.subjects[0]!;
}

describe("fleetRunsDryReading", () => {
  it("fires one subject naming the interval, keyed by its reset hour and spent set", () => {
    const subject = firedSubject();
    expect(subject.id).toBe("every routable Claude and Codex plan until 2026-11-05T16:00Z");
    expect(subject.label).toBe("at least 6h with no measured route, the first reset 2026-11-05T16:00Z");
    expect(subject.key).toMatch(/^until-2026-11-05t16-r[0-9a-f]{16}$/);
  });

  it("asks the owner to hold or shed, the problem naming the duration and the first reset", () => {
    const decision = firedSubject().decision!;
    expect(decision.problem).toBe(
      "No measured provider route can start a seat for at least 6h; the first exhausted window resets at 2026-11-05T16:00Z.",
    );
    expect(decision.stakes.risk).toBe(
      "Every provider-backed seat waits at least 6h, longer if a plan is also refused for another reason.",
    );
    expect(decision.options.map((option) => option.option)).toEqual([
      "Hold until the reset",
      "Shed the least urgent seats until the reset",
    ]);
    expect(decision.stakes.blastRadius).toBe(
      "Every Claude and Codex seat until at least 2026-11-05T16:00Z: 3 plans measured spent.",
    );
  });

  it("draws the registry's card copy for both providers", () => {
    const definition = monitorDefinition({ monitorId: "fleet-runs-dry" });
    const subject = firedSubject();
    expect(definition.what({ subject })).toBe(
      "Decide whether to hold or shed seats — no routable Claude or Codex plan has capacity until a reset",
    );
    expect(definition.unblocks({ subject })).toBe(
      "every provider-backed seat: at least 6h with no measured route, the first reset 2026-11-05T16:00Z",
    );
  });

  it("passes a clear assessment through as clear", () => {
    expect(fleetRunsDryReading({ assessment: { kind: "clear", why: "a route" }, reading: READING })).toEqual({
      monitorId: "fleet-runs-dry",
      state: "clear",
    });
  });

  it("passes an unmeasurable assessment through with its reason", () => {
    expect(fleetRunsDryReading({ assessment: { kind: "unmeasurable", why: "stale" }, reading: READING })).toEqual({
      because: "stale",
      monitorId: "fleet-runs-dry",
      state: "unmeasurable",
    });
  });
});
