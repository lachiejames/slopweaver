/**
 * The ceilings reading for a Claude monthly-spend plan — judged on its spend verdict, never a window: open is headroom
 * of the share the owner permits, its limit is at-usage-limit, and with no fresh reading it is no claim at all, which
 * admission passes over rather than reading as capacity.
 */
import { describe, expect, it } from "vitest";

import { admissionOf } from "../../../capacity/admission.js";
import { buildCeilingsReading, type ClaudePlanInput } from "../../../capacity/ceilings.js";
import { claude, machine, NOW, plans } from "./ceilingsFixtures.js";

/** A monthly-spend plan's ceiling input under one verdict. */
function monthly({ verdict }: { verdict: Extract<ClaudePlanInput, { kind: "spend" }>["verdict"] }): ClaudePlanInput {
  return { account: "CACHED six@example.test", alias: "plan-six", kind: "spend", verdict };
}

const OPEN = { currency: "USD", headroomMinor: 6000, kind: "open", reason: "$40 of $100", usedFraction: 0.4 } as const;

/** A weekly plan spent to its wall, so the monthly lane is the only route left. */
const SPENT = { ...claude({ alias: "plan-one", fiveHour: 1, sevenDay: 1 }) };

describe("buildCeilingsReading, a Claude monthly-spend plan", () => {
  it("measures an open plan by the share of its permitted spend left, and routes to it once no weekly plan can", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({ claude: [SPENT, monthly({ verdict: OPEN })] }),
    });

    expect(reading.ceilings[2]).toStrictEqual({
      account: "CACHED six@example.test",
      freeResets: null,
      headroom: 0.6,
      id: "claude:plan-six",
      kind: "claude",
      reason: null,
      status: "open",
      windows: [{ available: 100, resetAtIso: null, used: 40, window: "monthly-spend" }],
    });
    expect(reading.routes.map((route) => route.planCeilingId)).toStrictEqual(["claude:plan-six"]);
  });

  it("grades one at its usage limit as at its usage limit, measured at zero", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [monthly({ verdict: { kind: "usage-limit", reason: "$50 of $100, at its usage limit" } })],
      }),
    });

    expect(reading.ceilings[1]).toMatchObject({
      headroom: 0,
      reason: "monthly spend: $50 of $100, at its usage limit",
      status: "at-usage-limit",
      windows: [],
    });
  });

  it("reads one with no fresh reading as no claim, and admission passes it over rather than calling it capacity", () => {
    const reading = buildCeilingsReading({
      machine: machine(),
      observedAtIso: NOW,
      plans: plans({
        claude: [SPENT, monthly({ verdict: { kind: "not-measured", reason: "no spend reading recorded" } })],
      }),
    });

    expect(reading.ceilings[2]).toMatchObject({
      headroom: null,
      reason: "monthly spend: no spend reading recorded",
      status: "unreadable",
    });
    expect(admissionOf({ reading })).toStrictEqual({ binding: "claude:plan-one", kind: "capped" });
  });
});
