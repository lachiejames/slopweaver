/**
 * {@link planUsageLines} — what `plans usage` prints without `--json` for every window, usage and sign-in kind, so no
 * number is printed without its source and instant and no missing one is printed as a number.
 */
import { describe, expect, it } from "vitest";

import { planUsageLines } from "../../../../../cli/commands/plans/usageLines.js";
import type { PlanUsageRow } from "../../../../../plans/planUsageTypes.js";

const NOW = "2026-11-06T12:00:00.000Z";
const SEEN = "2026-11-06T10:00:00.000Z";

const ROW: PlanUsageRow = {
  alias: "plan-one",
  allowance: "weekly-window",
  email: null,
  modelHost: "claude",
  signIn: { kind: "needs-sign-in", observedAtIso: SEEN, reason: "nothing signed in", source: "claude-gauge-probe" },
  usage: {
    kind: "weekly",
    windows: [
      {
        kind: "stale",
        label: "week",
        observedAtIso: SEEN,
        reason: "old",
        resetAtIso: null,
        source: "claude-gauge-snapshot",
        usedPercent: 29,
      },
      {
        kind: "unavailable",
        label: "fable-week",
        observedAtIso: null,
        reason: "bad json",
        source: "claude-gauge-snapshot",
      },
    ],
  },
  usageLimitPercent: 100,
};

/** The one plan line a report of `row` prints. */
function lineOf({ row }: { row: PlanUsageRow }): string {
  return planUsageLines({ report: { observedAtIso: NOW, rows: [row] } })[1]!;
}

describe("planUsageLines", () => {
  it("prints a stale number as STALE with its unrecorded reset, an unreadable window as UNAVAILABLE, and a sign-in need", () => {
    expect(lineOf({ row: ROW })).toBe(
      "plan-one     Claude · address uncached · week 29% STALE (reset unrecorded; gauge 2026-11-06T10:00:00.000Z) · " +
        "Fable week UNAVAILABLE (bad json) · NEEDS SIGN-IN: nothing signed in",
    );
  });

  it("prints a window with no reading by its reason, never as a number", () => {
    const row: PlanUsageRow = {
      ...ROW,
      signIn: { kind: "unknown", observedAtIso: null, reason: "no probe", source: "claude-gauge-probe" },
      usage: {
        kind: "weekly",
        windows: [
          {
            kind: "no-reading",
            label: "week",
            observedAtIso: null,
            reason: "none yet",
            source: "claude-gauge-snapshot",
          },
        ],
      },
    };

    expect(lineOf({ row })).toBe(
      "plan-one     Claude · address uncached · week no reading (none yet) · sign-in unknown: no probe",
    );
  });

  it("prints a paused row and a monthly-spend row by their reason, with no weekly number", () => {
    const paused = lineOf({ row: { ...ROW, usage: { kind: "paused", reason: "lapsed", sinceIso: SEEN } } });
    const monthly = lineOf({ row: { ...ROW, usage: { kind: "not-measured", reason: "monthly spend" } } });

    expect(paused).toContain(`· paused since ${SEEN}: lapsed ·`);
    expect(monthly).toContain("· NOT MEASURED: monthly spend ·");
  });

  it("says nothing is registered for an empty report", () => {
    expect(planUsageLines({ report: { observedAtIso: NOW, rows: [] } })).toEqual([
      "plans usage: no destination is registered",
    ]);
  });
});
