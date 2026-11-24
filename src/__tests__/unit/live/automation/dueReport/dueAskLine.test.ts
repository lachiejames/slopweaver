/**
 * One DUE-ASKS row as a line: its cost, its effect, how late it is, and what holds or blocks it. Pure: a composed
 * report's row in, its line out.
 */
import { describe, expect, it } from "vitest";

import { composeDueAskReport } from "../../../../../live/automation/dueReport.js";
import { dueAskLine, dueAskLines } from "../../../../../live/automation/dueReportLines.js";
import { claim, NOW_ISO, row, verdict } from "./harness.js";

describe("dueAskLine", () => {
  it("says what running it costs, what it does to the world, and how late it is", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ effect: "write", kind: "alert-summary", recipeId: "knock-alerts" })],
      nowIso: "2026-09-08T12:20:00.000Z",
      rejected: [],
      verdicts: [verdict({ recipeId: "knock-alerts" })],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toBe(
      "DUE knock-alerts · alert-summary · run here, in this process · effect write · comfortable 20.0m late · covers slot 2026-09-08T12:00:00.000Z",
    );
  });

  it("names the holder and the expiry on a claimed row rather than going quiet", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: { "atlas-freshness": claim() },
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toContain("CLAIMED by supervisor-tick until 2026-09-08T13:00:00.000Z");
  });

  it("marks a kind this build cannot run so the supervisor neither runs nor holds a slot for it", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ kind: "registered-but-unrunnable", recipeId: "sdlc-metrics" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ recipeId: "sdlc-metrics" })],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toContain("NO EXECUTOR in this build");
  });

  it("keeps UNOWNED beside `!!` on a held row this build cannot run", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ kind: "registered-but-unrunnable", recipeId: "sdlc-metrics" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ due: false, offReason: "held", recipeId: "sdlc-metrics" })],
    });
    const line = dueAskLine({ row: report.rows[0]! });
    expect(line.startsWith("!! UNOWNED sdlc-metrics · ")).toBe(true);
    expect(line).toContain("NO EXECUTOR in this build");
  });

  it("prints a firing handed to its successor as DEFERRED naming that slot, never as current, and not actionable", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ recipeId: "sdlc-metrics" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict({ deferredSlotIso: "2026-09-08T11:00:00.000Z", due: false, recipeId: "sdlc-metrics", slotIso: null }),
      ],
    });
    expect(report.rows[0]!.actionable).toBe(false);
    expect(dueAskLine({ row: report.rows[0]! })).toBe(
      "-- sdlc-metrics · verb-run · run here, in this process · effect read · DEFERRED · slot " +
        "2026-09-08T11:00:00.000Z handed to its successor · next in 55.0m",
    );
  });

  it("carries the handed-on slot on its row only when there is one, so an ordinary row's --json is unchanged", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ recipeId: "sdlc-metrics" }), row({ recipeId: "knock-alerts" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict({ deferredSlotIso: "2026-09-08T11:00:00.000Z", due: false, recipeId: "sdlc-metrics", slotIso: null }),
        verdict({ recipeId: "knock-alerts" }),
      ],
    });
    expect(report.rows.map((entry) => [entry.recipeId, Object.keys(entry).includes("deferredSlotIso")])).toEqual([
      ["knock-alerts", false],
      ["sdlc-metrics", true],
    ]);
  });

  it("never counts a kind this build cannot run as actionable, though it still prints", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ kind: "registered-but-unrunnable", recipeId: "sdlc-metrics" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ recipeId: "sdlc-metrics" })],
    });
    expect(report.rows[0]!.due).toBe(true);
    expect(report.rows[0]!.actionable).toBe(false);
    expect(dueAskLines({ report })[1]).toBe("0 actionable · 0 want a session · 0 claimed · 1 row(s) read");
  });

  it("makes nothing actionable when the claims file could not be read, while still printing every row", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      claimsReadable: false,
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows.length).toBe(1);
    expect(report.rows[0]!.due).toBe(true);
    expect(report.rows[0]!.actionable).toBe(false);
  });

  it("never calls an unschedulable row actionable, because `automation claim` would refuse it", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ cadence: "every so often" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict()],
    });
    expect(report.rows[0]!.tolerance.band).toBe("unschedulable");
    expect(report.rows[0]!.actionable).toBe(false);
    expect(dueAskLine({ row: report.rows[0]! })).toContain("cadence UNREADABLE");
  });

  it("counts the missed firings on an overdue row", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row()],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [verdict({ firingsSinceWatermark: 4 })],
    });
    expect(dueAskLine({ row: report.rows[0]! })).toContain(
      "covers slot 2026-09-08T12:00:00.000Z · 3 firing(s) missed, onMissed backfill",
    );
  });

  it("names the slot a per-slot backfill takes and how many stay owed after it", () => {
    const report = composeDueAskReport({
      tickResyncIds: [],
      claims: {},
      definitions: [row({ kind: "metrics-push", recipeId: "sdlc-metrics" })],
      nowIso: NOW_ISO,
      rejected: [],
      verdicts: [
        verdict({
          firingsSinceWatermark: 3,
          recipeId: "sdlc-metrics",
          slotIso: "2026-09-08T10:00:00.000Z",
          slotsOwedAfterThis: 2,
        }),
      ],
    });
    expect(report.rows[0]!.slotsOwedAfterThis).toBe(2);
    expect(dueAskLine({ row: report.rows[0]! })).toContain(
      "backfills slot 2026-09-08T10:00:00.000Z · 2 more slot(s) owed",
    );
  });
});
