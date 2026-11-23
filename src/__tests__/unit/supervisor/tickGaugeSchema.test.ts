/**
 * The tick row's gauge slice: it carries each window's own reset and the gauge's PLAN lines, still reads a row
 * journalled before either existed, and refuses a key nobody declared.
 */
import { describe, expect, it } from "vitest";

import { gaugeFactsSchema } from "../../../supervisor/tickGaugeSchema.js";

/** One plan row journalled before each window carried its own reset. */
const LEGACY_PLAN = { fablePct: 52, plan: "plan-two", resetsIso: "2026-09-17T19:00:00.000Z", weekPct: 100 };

describe("gaugeFactsSchema", () => {
  it("reads a row whose plans carry every window's own reset and whose gauge carried PLAN lines", () => {
    const facts = {
      nextAllModels: "plan-three",
      nextFable: null,
      planLines: ["PLAN plan-two: UNREAD — the provider answered 500"],
      plans: [
        {
          ...LEGACY_PLAN,
          fableResetsIso: "2026-09-18T01:00:00.000Z",
          fiveHourPct: 13,
          fiveHourResetsIso: "2026-09-12T23:00:00.000Z",
        },
      ],
      reactNowLines: [],
    };

    expect(gaugeFactsSchema.parse(facts)).toStrictEqual(facts);
  });

  it("still reads a row journalled before the resets and PLAN lines existed", () => {
    const legacy = {
      nextAllModels: null,
      nextFable: "plan-two",
      plans: [LEGACY_PLAN],
      reactNowLines: ["REACT NOW: x"],
    };

    expect(gaugeFactsSchema.parse(legacy)).toStrictEqual(legacy);
  });

  it("refuses a reset that is not an instant, an empty PLAN line and an undeclared key", () => {
    const issues = (over: Record<string, unknown>) =>
      gaugeFactsSchema
        .safeParse({ nextAllModels: null, nextFable: null, plans: [], reactNowLines: [], ...over })
        .error!.issues.map((issue) => `${issue.code} at ${issue.path.join(".")}`);

    expect(issues({ plans: [{ ...LEGACY_PLAN, fableResetsIso: "Monday" }] })).toStrictEqual([
      "invalid_format at plans.0.fableResetsIso",
    ]);
    expect(issues({ planLines: [""] })).toStrictEqual(["too_small at planLines.0"]);
    expect(issues({ budgets: 3 })).toStrictEqual(["unrecognized_keys at "]);
  });
});
