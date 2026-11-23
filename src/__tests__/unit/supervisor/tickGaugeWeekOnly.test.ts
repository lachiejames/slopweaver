/**
 * The tick's gauge facts carry the all-models week of a plan whose reading had no Fable week, so the chair's
 * cadence can still see it at the routing bar, and a tick
 * with every plan complete journals the shape it always did.
 */
import { describe, expect, it } from "vitest";

import { gaugeDocument } from "../../../claude/gaugeRender.js";
import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
import { gaugeObservation } from "../../../supervisor/tickGaugeDraft.js";
import { gaugeFactsSchema } from "../../../supervisor/tickGaugeSchema.js";
import type { GaugeFacts } from "../../../supervisor/tickGaugeTypes.js";
import type { SourceObservation } from "../../../supervisor/tickTypes.js";

const FRAME = { capturedIso: "2026-11-02T08:05:00.000Z", startedIso: "2026-11-02T08:00:00.000Z" };
const NOW = "2026-11-02T08:01:00.000Z";
const RESET = "2026-11-06T19:00:00.000Z";
const POLICY = { allowance: WEEKLY_WINDOW, usageLimitPercent: 100 } as const;

/** Map a two-plan gauge document whose second plan may lack its Fable week. */
function observe({
  secondFable,
  firstFable = true,
}: {
  secondFable: boolean;
  firstFable?: boolean;
}): SourceObservation<GaugeFacts> {
  const fable = secondFable
    ? { sevenDayFable: { resetAtIso: RESET, status: "allowed" as const, utilization: 0.4 } }
    : {};
  const firstFableWindow = firstFable
    ? { sevenDayFable: { resetAtIso: RESET, status: "allowed" as const, utilization: 0.1 } }
    : {};
  const document = gaugeDocument({
    ambient: { kind: "subscription", reason: "no Anthropic-issued credential is configured" },
    cells: [],
    chair: chairPlanVerdict({ sessions: [] }),
    fleetWide: true,
    nextAllModels: "plan-b",
    nowIso: NOW,
    outcomes: [
      {
        alias: "plan-a",
        gauge: {
          ...POLICY,
          alias: "plan-a",
          observedAtIso: NOW,
          sevenDay: { resetAtIso: RESET, status: "allowed", utilization: 0.2 },
          ...firstFableWindow,
        },
      },
      {
        alias: "plan-b",
        gauge: {
          ...POLICY,
          alias: "plan-b",
          observedAtIso: NOW,
          sevenDay: { resetAtIso: RESET, status: "allowed_warning", utilization: 0.96 },
          ...fable,
        },
      },
    ],
    paused: [],
    planLines: [],
    thresholds: DEFAULT_THRESHOLDS.claude,
  });
  const capture = { document: JSON.parse(JSON.stringify(document)) as unknown, path: "gauge.json" };
  return unwrap(gaugeObservation({ capture, frame: FRAME }));
}

/** An observation's facts, throwing when it has none. */
function factsOf({ observation }: { observation: SourceObservation<GaugeFacts> }): GaugeFacts {
  if (observation.status === "unavailable") {
    throw new Error(`expected facts, got unavailable: ${observation.diagnostic}`);
  }
  return observation.facts;
}

describe("gaugeObservation — a plan with no Fable week", () => {
  it("carries its all-models week in weekOnlyPlans, and the facts still parse under the journal's schema", () => {
    const facts = factsOf({ observation: observe({ secondFable: false }) });

    expect(facts.plans.map((row) => row.plan)).toStrictEqual(["plan-a"]);
    expect(facts.weekOnlyPlans).toStrictEqual([{ plan: "plan-b", usageLimitPercent: 100, weekPct: 96 }]);
    expect(gaugeFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("carries each plan's usage limit onto its row, so the cadence judges the chair at the bar routing refuses at", () => {
    const facts = factsOf({ observation: observe({ secondFable: true }) });

    expect(facts.plans.map((row) => [row.plan, row.usageLimitPercent])).toStrictEqual([
      ["plan-a", 100],
      ["plan-b", 100],
    ]);
    expect(gaugeFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("stays PARTIAL, not unavailable, when NO plan carried a Fable week, so the cadence still sees each week", () => {
    const observation = observe({ firstFable: false, secondFable: false });
    const facts = factsOf({ observation });

    expect(observation.status).toBe("partial");
    expect(facts.plans).toStrictEqual([]);
    expect(facts.weekOnlyPlans).toStrictEqual([
      { plan: "plan-a", usageLimitPercent: 100, weekPct: 20 },
      { plan: "plan-b", usageLimitPercent: 100, weekPct: 96 },
    ]);
    expect(gaugeFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("journals no weekOnlyPlans field when every plan has a complete row", () => {
    const facts = factsOf({ observation: observe({ secondFable: true }) });

    expect(facts.plans.map((row) => row.plan)).toStrictEqual(["plan-a", "plan-b"]);
    expect(Object.keys(facts)).not.toContain("weekOnlyPlans");
  });
});
