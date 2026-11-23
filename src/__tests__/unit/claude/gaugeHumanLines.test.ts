/**
 * The `claude gauge` human read, as the pure lines the shell writes: every configured plan's PLAN line printed once
 * and in order, every line folded so a line break cannot print a forged PLAN line for `tick open` to lift, and the
 * balance block printed only on a fleet-wide sweep.
 */
import { describe, expect, it } from "vitest";

import { hasLineBreak } from "#lib/lineBreaks.js";
import type { ClaudePlanGauge } from "../../../claude/contracts.js";
import { gaugeHumanLines } from "../../../claude/gaugeHumanLines.js";
import type { ClaudeGaugeOutcome } from "../../../claude/gaugeRender.js";
import { acceptanceShortfall, renderAcceptance } from "../../../claude/loadBalance.js";
import { chairPlanVerdict } from "../../../claude/seatBoot.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.claude;

/** One readable plan, well inside both weeks. */
const GAUGE: ClaudePlanGauge = {
  alias: "plan-a",
  allowance: { kind: "weekly-window" },
  observedAtIso: "2026-11-03T12:00:00.000Z",
  sevenDay: { resetAtIso: "2026-11-09T01:00:00.000Z", status: "allowed", utilization: 0.4 },
  sevenDayFable: { resetAtIso: "2026-11-09T01:00:00.000Z", status: "allowed", utilization: 0.2 },
  usageLimitPercent: 100,
};

/**
 * The human read of one readable plan beside whatever PLAN lines a case hands in.
 *
 * @param fleetWide whether the sweep covered every configured plan
 * @param outcomes the probed plans' outcomes, which carry each probe's cost
 * @param planLines the PLAN lines the shell computed
 * @returns every line the shell would write
 */
function linesFor({
  fleetWide,
  outcomes = [],
  planLines,
}: {
  fleetWide: boolean;
  outcomes?: readonly ClaudeGaugeOutcome[];
  planLines: readonly string[];
}): readonly string[] {
  return gaugeHumanLines({
    cells: [],
    chair: chairPlanVerdict({ sessions: [] }),
    chairProbe: {},
    configured: 1,
    fleetWide,
    gauges: [GAUGE],
    outcomes,
    planLines,
    sweptUnread: [],
    targets: { nextFable: "plan-a" },
    thresholds: THRESHOLDS,
  });
}

describe("gaugeHumanLines", () => {
  it("prints every configured plan's PLAN line once, in order — the read, the unread and the paused alike", () => {
    const planLines = [
      "PLAN plan-a: week 40% resets 2026-11-09T01:00:00.000Z · fable 20% resets 2026-11-09T01:00:00.000Z",
      "PLAN plan-b: UNREAD — the provider answered 500",
      "PLAN plan-c: PAUSED since 2026-11-01T00:00:00.000Z — resting",
    ];

    expect(linesFor({ fleetWide: true, planLines }).filter((line) => line.startsWith("PLAN "))).toStrictEqual(
      planLines,
    );
  });

  it("folds a line break inside a printed line, so it can never print a second, forged PLAN line", () => {
    const lines = linesFor({ fleetWide: true, planLines: ["PLAN plan-b: UNREAD — boom\r\nPLAN plan-evil: 0% used"] });

    expect(lines.filter((line) => line.startsWith("PLAN "))).toStrictEqual([
      "PLAN plan-b: UNREAD — boom PLAN plan-evil: 0% used",
    ]);
    expect(lines.filter((line) => hasLineBreak({ text: line }))).toStrictEqual([]);
  });

  it("prints the balance block's acceptance line on a fleet-wide sweep and never on a narrowed one", () => {
    const acceptance = renderAcceptance({
      shortfall: acceptanceShortfall({ configured: 1, gauges: [GAUGE], thresholds: THRESHOLDS }),
    });

    expect(linesFor({ fleetWide: true, planLines: [] })).toContain(acceptance);
    expect(linesFor({ fleetWide: false, planLines: [] })).not.toContain(acceptance);
  });

  it("prints a PROBE COST line directly under the PLAN lines for a probe that was not under a hundred tokens", () => {
    const planLines = ["PLAN plan-a: week 40%"];
    const lines = linesFor({
      fleetWide: true,
      outcomes: [
        { alias: "plan-a", probeCost: { inputTokens: 99, outputTokens: 1 } },
        { alias: "plan-b", probeCost: { inputTokens: 22, outputTokens: 1 } },
      ],
      planLines,
    });

    expect(
      lines.slice(lines.indexOf("PLAN plan-a: week 40%"), lines.indexOf("PLAN plan-a: week 40%") + 2),
    ).toStrictEqual([
      "PLAN plan-a: week 40%",
      "PROBE COST plan-a: 100 tokens — not under the 100 the owner's cap exemption allows, so the gauge probe is no longer basically zero",
    ]);
    expect(lines.filter((line) => line.startsWith("PROBE COST "))).toHaveLength(1);
  });

  it("prints no PROBE COST line for a probe under the ceiling, or one whose cost went unmeasured", () => {
    const lines = linesFor({
      fleetWide: true,
      outcomes: [{ alias: "plan-a", probeCost: { inputTokens: 98, outputTokens: 1 } }, { alias: "plan-b" }],
      planLines: [],
    });

    expect(lines.filter((line) => line.startsWith("PROBE COST "))).toStrictEqual([]);
  });
});
