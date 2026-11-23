/**
 * The plan-budget half of the chair cadence, called directly — pure. Each reason carries the bar the gauge it was
 * judged under held, so a case moving a bar sees that bar in the reason, never the default.
 */
import { describe, expect, it } from "vitest";

import { planReasons } from "../../../supervisor/chairCadenceBudget.js";

import { DEFAULT_CADENCE_THRESHOLDS, gauge } from "./chairCadenceFixture.js";

/** A read gauge, narrowed: the fixture always builds the read arm. */
function readGauge(options: Parameters<typeof gauge>[0]): Parameters<typeof planReasons>[0]["gauge"] {
  const built = gauge(options);
  if (built.kind !== "read") {
    throw new Error("the fixture built an unread gauge");
  }
  return built;
}

describe("planReasons", () => {
  it("flags both weeks at or past the alert bar when routing points elsewhere", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 80, 75],
        ["plan-two", 20, 70],
      ],
    });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: [],
      reasons: [
        { alias: "plan-one", kind: "plan-window-near", pct: 80, thresholdPercent: 75, window: "seven-day" },
        { alias: "plan-one", kind: "plan-window-near", pct: 75, thresholdPercent: 75, window: "seven-day Fable" },
      ],
    });
  });

  it("turns a near week into a note when the next Fable spawn routes to the same plan", () => {
    const read = readGauge({ nextChair: "plan-one", plans: [["plan-one", 80, 10]] });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: [
        "plan-one is at 80% of its seven-day week, but the chair's successor routes to plan-one too, so a successor " +
          "would land on the same plan — not a reason to hand off until routing moves off it",
      ],
      reasons: [],
    });
  });

  it("judges the drift against the register's band, carrying the band it used", () => {
    const plans = [
      ["plan-one", 40, 30],
      ["plan-two", 20, 20],
    ] as const;
    const narrow = readGauge({
      nextChair: "plan-two",
      plans,
      thresholds: { ...DEFAULT_CADENCE_THRESHOLDS, driftingSpreadPercent: 5 },
    });
    expect(planReasons({ alias: "plan-one", gauge: narrow }).reasons).toStrictEqual([
      {
        alias: "plan-one",
        fablePct: 30,
        kind: "plan-asymmetric",
        routeAlias: "plan-two",
        routeFablePct: 20,
        thresholdPoints: 5,
      },
    ]);
    expect(
      planReasons({ alias: "plan-one", gauge: readGauge({ nextChair: "plan-two", plans }) }).reasons,
    ).toStrictEqual([]);
  });

  it("keeps the chair when the route is a different plan already past the bar on the same week", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-three", 89, 65],
        ["plan-two", 82, 61],
      ],
    });
    expect(planReasons({ alias: "plan-three", gauge: read })).toStrictEqual({
      notes: [
        "plan-three is at 89% of its seven-day week, but the chair's successor routes to plan-two, itself at 82% of " +
          "its seven-day week, so a successor would be just as far past the bar — not a reason to hand off until a " +
          "plan under it is the route or plan-three reaches its spawn bar",
      ],
      reasons: [],
    });
  });

  it("still hands off toward a route under the alert bar on both weeks", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 87, 36],
        ["plan-two", 74, 74],
      ],
    });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: [],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 87, thresholdPercent: 75, window: "seven-day" }],
    });
  });

  it("keeps the chair when the route is past the bar on its OTHER week, naming that week", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 80, 10],
        ["plan-two", 20, 80],
      ],
    });
    expect(planReasons({ alias: "plan-one", gauge: read }).notes).toStrictEqual([
      "plan-one is at 80% of its seven-day week, but the chair's successor routes to plan-two, itself at 80% of its " +
        "seven-day Fable week, so a successor would be just as far past the bar — not a reason to hand off until a " +
        "plan under it is the route or plan-one reaches its spawn bar",
    ]);
  });

  it("hands off at the spawn bar even when the route is past the alert bar too", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 95, 36],
        ["plan-two", 82, 61],
      ],
    });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: [],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 95, thresholdPercent: 75, window: "seven-day" }],
    });
  });

  it("never lets a PARTIAL gauge's route keep the chair", () => {
    const read = readGauge({
      gap: "plan-four's probe failed",
      nextChair: "plan-two",
      plans: [
        ["plan-one", 87, 36],
        ["plan-two", 82, 61],
      ],
    });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: ["the drift band is UNMEASURED — a PARTIAL gauge cannot say which plan routing picks"],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 87, thresholdPercent: 75, window: "seven-day" }],
    });
  });

  it("never lets a route with no row keep the chair", () => {
    const read = readGauge({ nextChair: "plan-two", plans: [["plan-one", 87, 36]] });
    expect(planReasons({ alias: "plan-one", gauge: read })).toStrictEqual({
      notes: ["the routed plan plan-two's Fable week is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [{ alias: "plan-one", kind: "plan-window-near", pct: 87, thresholdPercent: 75, window: "seven-day" }],
    });
  });

  it("keeps the drift reason when the near reason is folded into a note", () => {
    const read = readGauge({
      nextChair: "plan-two",
      plans: [
        ["plan-one", 80, 94],
        ["plan-two", 76, 76],
      ],
    });
    const judged = planReasons({ alias: "plan-one", gauge: read });
    expect(judged.notes.length).toBe(2);
    expect(judged.reasons).toStrictEqual([
      {
        alias: "plan-one",
        fablePct: 94,
        kind: "plan-asymmetric",
        routeAlias: "plan-two",
        routeFablePct: 76,
        thresholdPoints: 15,
      },
    ]);
  });

  it("reads a plan with no row as UNMEASURED, handing off only toward a measured route", () => {
    const read = readGauge({ nextChair: "plan-two", plans: [["plan-two", 20, 20]] });
    expect(planReasons({ alias: "plan-five", gauge: read })).toStrictEqual({
      notes: ["plan-five's budget is UNMEASURED — it has no complete reading in this tick's gauge"],
      reasons: [{ alias: "plan-five", kind: "plan-unmeasured", routeAlias: "plan-two" }],
    });
  });
});
