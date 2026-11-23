/**
 * {@link codexHeadroom} and {@link codexBudgetAlert} — what a tick says about Codex's budget when there is
 * exactly one account to say it about.
 */
import { describe, expect, it } from "vitest";
import { parseGaugeLine } from "../../../codex/gauge.js";
import { codexBudgetAlert, codexHeadroom } from "../../../codex/gaugeAlert.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import {
  REAL_CREDITS_DEPLETED_LINE,
  REAL_FIVE_HOUR_PRIMARY_LINE,
  REAL_HEALTHY_NO_CREDITS_LINE,
  REAL_HEALTHY_WEEKLY_LINE,
  REAL_USAGE_LIMIT_REACHED_LINE,
  REAL_WEEKLY_EXHAUSTED_LINE,
} from "../../codexRolloutLines.js";

const THRESHOLDS = DEFAULT_THRESHOLDS.codex;

describe("codexHeadroom", () => {
  it("reads an absent gauge as spendable — no evidence is not a refusal here", () => {
    expect(codexHeadroom({ gauge: undefined })).toEqual({
      binding: undefined,
      blockedBy: undefined,
      spendable: true,
    });
  });

  it("reads the real healthy 18% weekly line as spendable, binding on its one window", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE }) });

    expect(headroom.spendable).toBe(true);
    expect(headroom.binding?.usedPercent).toBe(18);
  });

  it("blocks on a reached type even though that event reports credits available", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE }) });

    expect(headroom.spendable).toBe(false);
    expect(headroom.blockedBy).toBe("Codex reported workspace_member_usage_limit_reached at 2026-09-11T07:31:24.319Z");
  });

  it("blocks on a 100% weekly window and names its reset", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE }) });

    expect(headroom.spendable).toBe(false);
    expect(headroom.blockedBy).toBe("the week window is at 100%, resets 2026-07-25T16:58:16.000Z");
  });

  it("binds on the TIGHTEST window, not on whichever slot came first", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_FIVE_HOUR_PRIMARY_LINE }) });

    expect(headroom.binding?.label).toBe("weekly");
    expect(headroom.binding?.usedPercent).toBe(13);
  });
});

describe("codexBudgetAlert", () => {
  it("says why there is no reading rather than printing a zero budget", () => {
    expect(codexBudgetAlert({ gauge: undefined, thresholds: THRESHOLDS })).toEqual({
      fold: "codex budget: no rate-limit reading — Codex writes one only when a turn runs, so nothing has run recently",
      reactNow: [],
    });
  });

  it("folds the real healthy line, naming the five-hour window as unread rather than as 0%", () => {
    expect(
      codexBudgetAlert({ gauge: parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE }), thresholds: THRESHOLDS }),
    ).toEqual({
      fold: "codex budget: 18% week, read 2026-09-13T05:51:14.803Z",
      reactNow: [],
    });
  });

  it("raises no react-now line at 18%, well under the 75% rung", () => {
    expect(
      codexBudgetAlert({ gauge: parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE }), thresholds: THRESHOLDS }).reactNow,
    ).toEqual([]);
  });

  it("raises a react-now line at 18% once the register's alert bar is 10, and not at 19", () => {
    const gauge = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE });
    const resetAtIso = gauge!.windows[0]!.resetAtIso;

    expect(codexBudgetAlert({ gauge, thresholds: { alertAtPercent: 10, pauseAtPercent: 99 } }).reactNow).toEqual([
      `REACT NOW — Codex week at 18%, resets ${resetAtIso}: ` +
        "it stops every Codex pass on THAT destination — `slopweaver codex route` names where else one can go",
    ]);
    expect(codexBudgetAlert({ gauge, thresholds: { alertAtPercent: 19, pauseAtPercent: 99 } }).reactNow).toEqual([]);
  });

  it("raises a react-now line for a reached type, naming Codex's own wording", () => {
    expect(
      codexBudgetAlert({ gauge: parseGaugeLine({ line: REAL_USAGE_LIMIT_REACHED_LINE }), thresholds: THRESHOLDS })
        .reactNow,
    ).toEqual([
      "REACT NOW — Codex reported workspace_member_usage_limit_reached at 2026-09-11T07:31:24.319Z: " +
        "it stops every Codex pass on THAT destination — `slopweaver codex route` names where else one can go",
    ]);
  });

  it("raises a react-now line for a 100% window and names its reset", () => {
    expect(
      codexBudgetAlert({ gauge: parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE }), thresholds: THRESHOLDS })
        .reactNow,
    ).toEqual([
      "REACT NOW — Codex week at 100%, resets 2026-07-25T16:58:16.000Z: " +
        "it stops every Codex pass on THAT destination — `slopweaver codex route` names where else one can go",
    ]);
  });
});

describe("headroom reads the credit BALANCE, never the has_credits flag", () => {
  // A Codex review found the flag fixed in `quotaLog.evidenceFromGauge` and still standing here, so `codex
  // gauge` and `codex route` reported a real healthy reading as unspendable while the exhaustion reader
  // called the same line healthy. One rule, both places.
  it("calls a real healthy line with has_credits: false SPENDABLE", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_HEALTHY_NO_CREDITS_LINE }) });

    expect(headroom.spendable).toBe(true);
    expect(headroom.blockedBy).toBeUndefined();
  });

  it("still blocks on the real credits-depleted line, off its reached type", () => {
    const headroom = codexHeadroom({ gauge: parseGaugeLine({ line: REAL_CREDITS_DEPLETED_LINE }) });

    expect(headroom.spendable).toBe(false);
  });
});
