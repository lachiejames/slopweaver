/**
 * The pure half of `handover wake`'s reconcile report: how reconciled rows are counted, phrased and summed up, and
 * how a landed row whose finish refused is re-classed as hiding a step.
 */
import { describe, expect, it } from "vitest";

import {
  afterFinish,
  reconciliationCounts,
  reconciliationPhrase,
  reconciliationSummary,
} from "../../../../../cli/commands/handover/wakeReconcile.js";
import type { WakeRowReport } from "../../../../../cli/commands/handover/wakeRows.js";
import type { ParkedLanding } from "../../../../../handover/parkedLanding.js";

/** One reported row, reconciled as `landing` and closed as `closeOutcome` when either is given. */
function row({
  closeOutcome,
  landing,
  slug,
}: {
  closeOutcome?: WakeRowReport["closeOutcome"];
  landing?: ParkedLanding;
  slug: string;
}): WakeRowReport {
  return {
    action: "none",
    detail: "",
    judgement: { kind: "not-judged", reason: "fixture" },
    slug,
    wake: { kind: "checks", number: 1, repo: "acme/widgets" },
    ...(landing === undefined ? {} : { reconciliation: landing }),
    ...(closeOutcome === undefined ? {} : { closeOutcome }),
  };
}

const ROWS: readonly WakeRowReport[] = [
  row({ closeOutcome: "closed", landing: { headRefName: "a", kind: "landed" }, slug: "a" }),
  row({ closeOutcome: "would-close", landing: { headRefName: "b", kind: "landed" }, slug: "b" }),
  row({ closeOutcome: "close-failed", landing: { headRefName: "c", kind: "landed" }, slug: "c" }),
  row({ landing: { cause: "question", detail: "asked", kind: "hiding-step" }, slug: "d" }),
  row({ landing: { headRefName: "e", kind: "closed-unmerged" }, slug: "e" }),
  row({ landing: { kind: "unknown", reason: "no head" }, slug: "f" }),
  row({ slug: "g" }),
];

describe("reconciliationCounts", () => {
  it("counts a closed or would-close row as settled and any other landed row as landed but unsettled", () => {
    expect(reconciliationCounts({ rows: ROWS })).toEqual({
      closedUnmerged: 1,
      hidingStep: 1,
      landedUnsettled: 1,
      settled: 2,
      unknown: 1,
    });
  });

  it("counts nothing over rows no reconcile touched", () => {
    expect(reconciliationCounts({ rows: [row({ slug: "g" })] })).toEqual({
      closedUnmerged: 0,
      hidingStep: 0,
      landedUnsettled: 0,
      settled: 0,
      unknown: 0,
    });
  });
});

describe("reconciliationSummary", () => {
  it("sums the counts in one line, marked as the run's own mode", () => {
    expect(
      reconciliationSummary({ counts: reconciliationCounts({ rows: ROWS }), mode: " (dry run)", rows: ROWS }),
    ).toBe(
      "reconcile (dry run): 2 landed and settled, 1 landed but not settled, 1 hiding a step, 1 closed unmerged, 1 unknown",
    );
  });

  it("prints no line when no row's pull request ended", () => {
    const rows = [row({ slug: "g" })];
    expect(reconciliationSummary({ counts: reconciliationCounts({ rows }), mode: "", rows })).toBe(undefined);
  });
});

describe("reconciliationPhrase", () => {
  it("names each class, and the cause and detail of a hidden step", () => {
    expect(ROWS.slice(0, 6).map((entry) => reconciliationPhrase({ landing: entry.reconciliation! }))).toEqual([
      "landed (a)",
      "landed (b)",
      "landed (c)",
      "HIDING A STEP — question: asked",
      "CLOSED UNMERGED (e) — the work is still owed; its reseat decides it",
      "unknown — no head",
    ]);
  });
});

describe("afterFinish", () => {
  const landed: ParkedLanding = { headRefName: "a", kind: "landed" };

  it("turns a landed row whose finish refused into a hidden step naming why", () => {
    expect(afterFinish({ finishWhy: "a probe is PARTIAL", landing: landed })).toEqual({
      cause: "finish-refusal",
      detail: "a probe is PARTIAL",
      kind: "hiding-step",
    });
  });

  it("leaves a landed row whose finish closed it, and every other class, unchanged", () => {
    const closed: ParkedLanding = { headRefName: "e", kind: "closed-unmerged" };
    expect([
      afterFinish({ finishWhy: undefined, landing: landed }),
      afterFinish({ finishWhy: "refused", landing: closed }),
    ]).toEqual([landed, closed]);
  });
});
