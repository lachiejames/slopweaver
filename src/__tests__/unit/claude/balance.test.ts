import { describe, expect, it } from "vitest";

import {
  fleetSpread as fleetSpreadAt,
  planLeans,
  renderBalanceLines as renderBalanceLinesAt,
} from "../../../claude/balance.js";
import type { ClaudeAccountGauge, ClaudeWindowReading } from "../../../claude/contracts.js";
import { THRESHOLDS } from "./defaultThresholds.js";

const BALANCED_SPREAD = THRESHOLDS.balancedSpread;
const DRIFTING_SPREAD = THRESHOLDS.driftingSpread;

/** `fleetSpread` at the default thresholds. */
function fleetSpread(
  options: Omit<Parameters<typeof fleetSpreadAt>[0], "thresholds">,
): ReturnType<typeof fleetSpreadAt> {
  return fleetSpreadAt({ ...options, thresholds: THRESHOLDS });
}

/** `renderBalanceLines` at the default thresholds. */
function renderBalanceLines(
  options: Omit<Parameters<typeof renderBalanceLinesAt>[0], "thresholds">,
): ReturnType<typeof renderBalanceLinesAt> {
  return renderBalanceLinesAt({ ...options, thresholds: THRESHOLDS });
}

const OBSERVED = "2026-09-09T04:39:10.066Z";

/**
 * One window at a utilization, `allowed` unless the caller says otherwise.
 *
 * @param utilization the fraction spent
 * @param resetAtIso when it resets
 * @returns the reading
 */
const window = ({
  resetAtIso = "2026-09-13T03:00:00.000Z",
  utilization,
}: {
  resetAtIso?: string;
  utilization: number;
}): ClaudeWindowReading => ({ resetAtIso, status: "allowed", utilization });

/**
 * One plan's gauge, with a Fable reading unless the caller omits it.
 *
 * @param alias the plan's label
 * @param week the plan-wide seven-day utilization
 * @param fable the Fable seven-day utilization, omitted for a gauge taken with a non-Fable model
 * @returns the gauge
 */
const gauge = ({ alias, fable, week }: { alias: string; fable?: number; week: number }): ClaudeAccountGauge => ({
  alias,
  fiveHour: window({ utilization: 0.1 }),
  observedAtIso: OBSERVED,
  sevenDay: window({ utilization: week }),
  ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
});

describe("fleetSpread", () => {
  it("measures the gap between the least- and most-spent plan and names both ends", () => {
    const spread = fleetSpread({
      gauges: [
        gauge({ alias: "plan-one", fable: 0.12, week: 0.09 }),
        gauge({ alias: "plan-two", fable: 0.5, week: 0.4 }),
        gauge({ alias: "plan-three", fable: 0.3, week: 0.25 }),
      ],
      window: "seven_day",
    });

    expect(spread.counted).toBe(3);
    expect(spread.lowest!.alias).toBe("plan-one");
    expect(spread.lowest!.utilization).toBe(0.09);
    expect(spread.highest!.alias).toBe("plan-two");
    expect(spread.highest!.utilization).toBe(0.4);
    expect(spread.spread).toBeCloseTo(0.31, 10);
    expect(spread.verdict).toBe("out-of-band");
    expect(spread.window).toBe("seven_day");
  });

  it("grades a gap at exactly the balanced threshold as balanced", () => {
    const spread = fleetSpread({
      gauges: [gauge({ alias: "a", week: 0.2 }), gauge({ alias: "b", week: 0.2 + BALANCED_SPREAD })],
      window: "seven_day",
    });

    expect(spread.spread).toBeCloseTo(BALANCED_SPREAD, 10);
    expect(spread.verdict).toBe("balanced");
  });

  it("grades a gap between the two thresholds as drifting", () => {
    const spread = fleetSpread({
      gauges: [gauge({ alias: "a", week: 0.2 }), gauge({ alias: "b", week: 0.2 + DRIFTING_SPREAD })],
      window: "seven_day",
    });

    expect(spread.spread).toBeCloseTo(DRIFTING_SPREAD, 10);
    expect(spread.verdict).toBe("drifting");
  });

  it("reports ONE readable plan as unmeasurable, never as balanced — the install's real state, measured", () => {
    const spread = fleetSpread({
      gauges: [gauge({ alias: "plan-one", fable: 0.12, week: 0.09 })],
      window: "seven_day",
    });

    expect(spread.counted).toBe(1);
    expect(spread.verdict).toBe("unmeasurable");
    expect(spread.spread).toBeUndefined();
    expect(spread.lowest!.alias).toBe("plan-one");
  });

  it("reports no readable plan as unmeasurable with no ends at all", () => {
    const spread = fleetSpread({ gauges: [], window: "seven_day" });

    expect(spread.counted).toBe(0);
    expect(spread.verdict).toBe("unmeasurable");
    expect(spread.lowest).toBeUndefined();
    expect(spread.highest).toBeUndefined();
  });

  it("counts only the plans that carried the Fable window, so an unread Fable reading is not a zero", () => {
    const spread = fleetSpread({
      gauges: [
        gauge({ alias: "with-fable", fable: 0.8, week: 0.3 }),
        gauge({ alias: "no-fable", week: 0.3 }),
        gauge({ alias: "also-fable", fable: 0.2, week: 0.3 }),
      ],
      window: "seven_day_fable",
    });

    expect(spread.counted).toBe(2);
    expect(spread.lowest!.alias).toBe("also-fable");
    expect(spread.highest!.alias).toBe("with-fable");
    expect(spread.spread).toBeCloseTo(0.6, 10);
  });
});

describe("fleetSpread — the install's own bands", () => {
  it("grades the same 10-point gap as drifting once the balanced band is tightened to 5 points", () => {
    const gauges = [gauge({ alias: "a", week: 0.2 }), gauge({ alias: "b", week: 0.3 })];

    expect(fleetSpread({ gauges, window: "seven_day" }).verdict).toBe("balanced");
    expect(
      fleetSpreadAt({
        gauges,
        thresholds: { ...THRESHOLDS, balancedSpread: 0.05 },
        window: "seven_day",
      }).verdict,
    ).toBe("drifting");
  });

  it("grades a 20-point gap as drifting once the drifting band is widened to 25 points", () => {
    const gauges = [gauge({ alias: "a", week: 0.2 }), gauge({ alias: "b", week: 0.4 })];

    expect(fleetSpread({ gauges, window: "seven_day" }).verdict).toBe("out-of-band");
    expect(
      fleetSpreadAt({
        gauges,
        thresholds: { ...THRESHOLDS, driftingSpread: 0.25 },
        window: "seven_day",
      }).verdict,
    ).toBe("drifting");
  });
});

describe("planLeans", () => {
  it("reports a negative gap when the Fable week is behind the plan-wide week", () => {
    const leans = planLeans({ gauges: [gauge({ alias: "plan-one", fable: 0.2, week: 0.7 })] });

    expect(leans).toHaveLength(1);
    expect(leans[0]!.alias).toBe("plan-one");
    expect(leans[0]!.week).toBe(0.7);
    expect(leans[0]!.fable).toBe(0.2);
    expect(leans[0]!.gap).toBeCloseTo(-0.5, 10);
  });

  it("reports a positive gap when the plan-wide week is behind the Fable week", () => {
    const leans = planLeans({ gauges: [gauge({ alias: "plan-two", fable: 1, week: 0.67 })] });

    expect(leans[0]!.gap).toBeCloseTo(0.33, 10);
  });

  it("carries no gap at all when the gauge held no Fable reading", () => {
    const leans = planLeans({ gauges: [gauge({ alias: "plan-three", week: 0.4 })] });

    expect(leans[0]!.week).toBe(0.4);
    expect(leans[0]!.fable).toBeUndefined();
    expect(leans[0]!.gap).toBeUndefined();
  });

  it("preserves configured order so a reader can match it to the gauge table", () => {
    const leans = planLeans({
      gauges: [gauge({ alias: "c", week: 0.9 }), gauge({ alias: "a", week: 0.1 }), gauge({ alias: "b", week: 0.5 })],
    });

    expect(leans.map((lean) => lean.alias)).toEqual(["c", "a", "b"]);
  });
});

describe("renderBalanceLines", () => {
  it("says UNMEASURABLE rather than balanced when one plan of several is readable", () => {
    const lines = renderBalanceLines({
      configured: 3,
      gauges: [gauge({ alias: "plan-one", fable: 0.12, week: 0.09 })],
      nextAllModels: "plan-one",
      nextFable: "plan-one",
    });

    expect(lines[0]).toBe("balance");
    expect(lines[1]).toBe(
      "all-models week: spread UNMEASURABLE — only one plan carried it, so this is not a balanced fleet, it is an unread one",
    );
    expect(lines[2]).toBe(
      "fable week: spread UNMEASURABLE — only one plan carried it, so this is not a balanced fleet, it is an unread one",
    );
  });

  it("says NOT APPLICABLE, never unread, when the one readable plan is the whole fleet", () => {
    const lines = renderBalanceLines({
      configured: 1,
      gauges: [gauge({ alias: "plan-one", fable: 0.12, week: 0.09 })],
      nextAllModels: "plan-one",
      nextFable: "plan-one",
    });

    expect(lines.slice(1, 3)).toStrictEqual([
      "all-models week: spread NOT APPLICABLE — one configured plan has no cross-plan spread",
      "fable week: spread NOT APPLICABLE — one configured plan has no cross-plan spread",
    ]);
  });

  it("still says UNMEASURABLE on a one-plan fleet whose only plan did not read", () => {
    const lines = renderBalanceLines({ configured: 1, gauges: [] });

    expect(lines[1]).toBe(
      "all-models week: spread UNMEASURABLE — no plan carried it, so this is not a balanced fleet, it is an unread one",
    );
  });

  it("names both ends and the verdict when the spread is measurable", () => {
    const lines = renderBalanceLines({
      configured: 2,
      gauges: [
        gauge({ alias: "plan-one", fable: 0.12, week: 0.09 }),
        gauge({ alias: "plan-two", fable: 0.9, week: 0.7 }),
      ],
      nextAllModels: "plan-one",
      nextFable: "plan-one",
    });

    expect(lines[1]).toBe(
      "all-models week: spread 61% across 2 plans — plan-one 9% lowest, plan-two 70% highest — OUT-OF-BAND",
    );
  });

  it("renders a plan's lean with its direction, and the stranding direction reads as fable behind", () => {
    const lines = renderBalanceLines({
      configured: 1,
      gauges: [gauge({ alias: "plan-one", fable: 0.2, week: 0.7 })],
      nextAllModels: "plan-one",
      nextFable: "plan-one",
    });

    expect(lines).toContain("  plan-one: week 70%, fable 20% — 50% fable behind the week");
  });

  it("renders an unread Fable window as unread rather than as zero", () => {
    const lines = renderBalanceLines({ configured: 1, gauges: [gauge({ alias: "plan-one", week: 0.4 })] });

    expect(lines).toContain("  plan-one: week 40%, fable unread");
  });

  it("says no plan can take a spawn when the router returned none", () => {
    const lines = renderBalanceLines({ configured: 1, gauges: [gauge({ alias: "plan-one", fable: 1, week: 1 })] });

    expect(lines).toContain("next all-models spawn -> no plan can take one");
    expect(lines).toContain("next fable spawn      -> no plan can take one");
  });

  it("names the chair successor's route and the plans a seated chair stays on beside it", () => {
    const lines = renderBalanceLines({
      chairLevelWith: ["plan-one"],
      configured: 2,
      gauges: [
        gauge({ alias: "plan-one", fable: 0.36, week: 0.88 }),
        gauge({ alias: "plan-two", fable: 0.19, week: 0.22 }),
      ],
      nextChair: "plan-two",
      nextFable: "plan-one",
    });

    expect(lines.at(-1)).toBe("next chair successor  -> plan-two (level with plan-one, a chair seated there stays)");
  });

  it("names the chair successor's route alone when no plan is level with it", () => {
    const lines = renderBalanceLines({
      chairLevelWith: [],
      configured: 1,
      gauges: [gauge({ alias: "plan-one", fable: 0.12, week: 0.09 })],
      nextChair: "plan-one",
    });

    expect(lines.at(-1)).toBe("next chair successor  -> plan-one");
  });

  it("is deterministic: the same readings render byte-identical lines", () => {
    const gauges = [
      gauge({ alias: "plan-one", fable: 0.12, week: 0.09 }),
      gauge({ alias: "plan-two", fable: 0.5, week: 0.4 }),
    ];
    const first = renderBalanceLines({ configured: 2, gauges, nextAllModels: "plan-one", nextFable: "plan-one" });
    const second = renderBalanceLines({ configured: 2, gauges, nextAllModels: "plan-one", nextFable: "plan-one" });

    expect(first.join("\n")).toBe(second.join("\n"));
  });

  it("renders no organisation, no email and no store path", () => {
    const rendered = renderBalanceLines({
      configured: 2,
      gauges: [
        gauge({ alias: "plan-one", fable: 0.12, week: 0.09 }),
        gauge({ alias: "plan-two", fable: 0.5, week: 0.4 }),
      ],
      nextAllModels: "plan-one",
      nextFable: "plan-one",
    }).join("\n");

    expect(rendered).not.toContain("@");
    expect(rendered).not.toContain("/Users/");
    expect(rendered).not.toContain("-4");
  });
});
