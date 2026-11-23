/**
 * The ceilings reading under a NON-default Claude threshold set — the register's routing bar, not a constant,
 * decides whether a plan at a given week is open, so lowering it changes the verdict on the very same plan.
 */
import { describe, expect, it } from "vitest";

import { buildCeilingsReading } from "../../../capacity/ceilings.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { claude, machine, NOW, plans } from "./ceilingsFixtures.js";

/** The one plan every case reads: 90% of its week, so between a lowered bar and the default 95% one. */
const PLAN = claude({ alias: "plan-one", fiveHour: 0.1, sevenDay: 0.9 });

describe("buildCeilingsReading, register thresholds", () => {
  it("leaves a plan at 90% of its week open under the default 95% routing bar", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [PLAN], claudeThresholds: DEFAULT_THRESHOLDS.claude }),
    });

    expect(reading.ceilings.find((ceiling) => ceiling.id === "claude:plan-one")!.status).toBe("open");
  });

  it("refuses the same plan once the register lowers the routing bar to 80%", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [PLAN],
        claudeThresholds: { ...DEFAULT_THRESHOLDS.claude, routeAt: 0.8 },
      }),
    });

    const ceiling = reading.ceilings.find((entry) => entry.id === "claude:plan-one")!;
    expect([ceiling.status, ceiling.headroom]).toStrictEqual(["refusing", 0]);
  });
});
