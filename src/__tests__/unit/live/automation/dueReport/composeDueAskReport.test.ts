/**
 * Composing and ordering the DUE-ASKS report's rows: which are actionable, which are claimed, and the order a tick
 * reads them in. Pure: rows, verdicts, claims and a clock in; the composed report out.
 */
import { describe, expect, it } from "vitest";

import { composeDueAskReport, type DueAskRow, orderDueAskRows } from "../../../../../live/automation/dueReport.js";
import { claim, NOW_ISO, row, verdict } from "./harness.js";

describe("composeDueAskReport", () => {
  it("marks a due, unclaimed row actionable", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.actionable).toBe(true);
    expect(report.rows[0]!.shape).toBe("run-here");
    expect(report.rows[0]!.effect).toBe("read");
  });

  it("leaves a CLAIMED due row un-actionable while still reporting it as due", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: { "atlas-freshness": claim() },
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.due).toBe(true);
    expect(report.rows[0]!.actionable).toBe(false);
    expect(report.rows[0]!.claim?.claimedBy).toBe("supervisor-tick");
  });

  it("frees the row again once the claim expires at its next firing", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: { "atlas-freshness": claim() },
      definitions: [row()],
      nowIso: "2026-09-08T13:30:00.000Z",
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.actionable).toBe(true);
    expect(report.rows[0]!.claim).toBe(undefined);
  });

  it("carries a row whose verdict is missing nowhere rather than inventing one", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row(), row({ recipeId: "unjudged" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows.length).toBe(1);
    expect(report.rows[0]!.recipeId).toBe("atlas-freshness");
  });

  it("keeps the rejected files the store could not parse", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [],
      nowIso: NOW_ISO,
      rejected: ["broken.json · REJECTED · unknown kind"],
      verdicts: [],
    });
    expect(report.rejected).toEqual(["broken.json · REJECTED · unknown kind"]);
  });
});

describe("orderDueAskRows", () => {
  it("puts actionable rows first, then the most overdue, then by id", () => {
    const base = composeDueAskReport({
      tickResyncIds: [],
      claims: { held: claim() },
      definitions: [
        row({ recipeId: "held" }),
        row({ cadence: "0 * * * *", recipeId: "b-comfortable" }),
        row({ cadence: "0 * * * *", recipeId: "a-overdue" }),
      ],
      nowIso: "2026-09-08T12:10:00.000Z",
      rejected: [],
      verdicts: [
        verdict({ recipeId: "held" }),
        verdict({ recipeId: "b-comfortable" }),
        verdict({ firingsSinceWatermark: 4, recipeId: "a-overdue" }),
      ],
    });
    expect(base.rows.map((entry) => entry.recipeId)).toEqual(["a-overdue", "b-comfortable", "held"]);
  });

  it("breaks a tie on recipeId so two ticks never report the same rows in a different order", () => {
    const rows: readonly DueAskRow[] = [
      {
        actionable: true,
        cadence: "*/5 * * * *",
        claim: undefined,
        due: true,
        effect: "read",
        firingsSinceWatermark: 1,
        kind: "verb-run",
        lastRunAtIso: null,
        onMissed: "skip",
        recipeId: "zebra",
        shape: "run-here",
        slotIso: "2026-09-08T12:00:00.000Z",
        slotsOwedAfterThis: 0,
        tolerance: { band: "urgent", lateByMs: 1000, nextFiringInMs: 500 },
      },
      {
        actionable: true,
        cadence: "*/5 * * * *",
        claim: undefined,
        due: true,
        effect: "read",
        firingsSinceWatermark: 1,
        kind: "verb-run",
        lastRunAtIso: null,
        onMissed: "skip",
        recipeId: "alpha",
        shape: "run-here",
        slotIso: "2026-09-08T12:00:00.000Z",
        slotsOwedAfterThis: 0,
        tolerance: { band: "urgent", lateByMs: 1000, nextFiringInMs: 500 },
      },
    ];
    expect(orderDueAskRows({ rows }).map((entry) => entry.recipeId)).toEqual(["alpha", "zebra"]);
  });
});
