/**
 * `handover wake`'s report, built from one row pass and printed as lines: the counts it takes off the rows, and the
 * row, reconcile and summary lines a chair reads.
 */
import { describe, expect, it } from "vitest";

import { printReport, wakeReport } from "../../../../../cli/commands/handover/wakeReport.js";
import type { WakeRowReport } from "../../../../../cli/commands/handover/wakeRows.js";

const WAKE = { kind: "checks", number: 7, repo: "acme/widgets" } as const;

const ROWS: readonly WakeRowReport[] = [
  {
    action: "finished",
    closeOutcome: "closed",
    detail: "finish closed it",
    judgement: {
      kind: "due",
      observed: { kind: "checks", number: 7, prState: "MERGED", repo: "acme/widgets" },
      reason: "merged",
    },
    reconciliation: { headRefName: "abc-1", kind: "landed" },
    slug: "abc-1",
    wake: WAKE,
  },
  {
    action: "none",
    detail: "still running",
    judgement: { kind: "not-due", reason: "checks running" },
    slug: "abc-2",
    wake: WAKE,
  },
];

const REPORT = wakeReport({
  dryRun: false,
  duplicateSlugs: [],
  now: new Date("2026-11-09T10:00:00.000Z"),
  pass: { attempted: 0, budget: { bootsInFlight: 0, budget: 0 }, cleared: 0, rows: ROWS },
  retry: undefined,
  settleOnly: true,
  unreadable: ["abc-3"],
});

describe("wakeReport", () => {
  it("counts the due, finished and reconciled rows off the pass", () => {
    expect([REPORT.due, REPORT.finished, REPORT.spawned, REPORT.reconciliation.settled, REPORT.observedAtIso]).toEqual([
      1,
      1,
      0,
      1,
      "2026-11-09T10:00:00.000Z",
    ]);
  });

  it("counts a suspended wake as suspended, never as cleared, finished or due-and-attempted", () => {
    const suspended = wakeReport({
      dryRun: false,
      duplicateSlugs: [],
      now: new Date("2026-11-09T10:00:00.000Z"),
      pass: {
        attempted: 0,
        budget: { bootsInFlight: 0, budget: 0 },
        cleared: 0,
        rows: [
          { ...ROWS[0]!, action: "wake-suspended", detail: "wake suspended until the owner's question is answered" },
        ],
      },
      retry: undefined,
      settleOnly: false,
      unreadable: [],
    });
    expect([suspended.suspended, suspended.cleared, suspended.finished]).toEqual([1, 0, 0]);
  });
});

describe("printReport", () => {
  it("prints each row, its reconcile, the summary and the reconcile sum, and names an unreadable row on stderr", () => {
    const out: string[] = [];
    const diagnostics: string[] = [];
    printReport({
      deps: { writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
      json: false,
      report: REPORT,
    });
    expect({ diagnostics, out }).toEqual({
      diagnostics: ["handover wake: abc-3 did not read, so any park on it is not judged"],
      out: [
        "  abc-1 — parked on CI for acme/widgets#7: due, finished (finish closed it)",
        "    reconcile: landed (abc-1)",
        "  abc-2 — parked on CI for acme/widgets#7: not-due, none (still running)",
        "handover wake --settle-only: 2 waking park(s), 1 due, 0 of 0 attempted, 0 reseated, 1 finished without a reseat, 0 cleared, 0 suspended on the owner's question",
        "reconcile: 1 landed and settled, 0 landed but not settled, 0 hiding a step, 0 closed unmerged, 0 unknown",
      ],
    });
  });
});
