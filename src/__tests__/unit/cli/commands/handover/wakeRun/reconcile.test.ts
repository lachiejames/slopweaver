/**
 * `handover wake`'s reconcile of parks whose pull request ENDED (a live board held 66 due parks, every
 * one merged or closed, none settling): a landed row is finished past the lesson question and closed so it derives
 * `done`, every other class keeps its old path and is reported by name, and `--settle-only` reseats nothing.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { WAKE_FINISH_ASKS, wakeFinishEnv } from "../../../../../../cli/commands/handover/wakeFinish.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { derivedRowState } from "../../../../../../handover/derivedRowState.js";
import { readRunJournal } from "../../../../../../handover/runStore.js";
import { scanBoard } from "../../../../../../handover/store.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { fixtureDirs, removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

/** The kinds of every line a row's journal now carries, in order. */
function journalKinds({ runsDir, slug }: { runsDir: string; slug: string }): readonly string[] {
  return unwrap(readRunJournal({ runsDir, slug })).events.map((event) => event.kind);
}

describe("handover wake's reconcile of a park whose pull request ended", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    ({ home, runsDir } = mintWakeHome());
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("finishes a landed row past the lesson question and closes it, so it derives done", async () => {
    parkedRow({ slug: "alpha", wake: { kind: "checks", number: 11, repo: "acme/widgets" } });
    const recorded = record();
    const deps = fakes({
      checks: { 11: { prState: "MERGED" } },
      finishes: { alpha: 0 },
      heads: { 11: "alpha" },
      recorded,
    });

    const { code, report } = await wakeJson({ deps, recorded });

    const row = report.rows[0]!;
    expect([code, recorded.finished, recorded.finishLessons, recorded.headReads, recorded.spawned]).toEqual([
      EXIT_OK,
      ["alpha"],
      ["alpha true"],
      ["acme/widgets#11"],
      [],
    ]);
    expect([row.action, row.closeOutcome, row.reconciliation]).toEqual([
      "finished",
      "closed",
      { headRefName: "alpha", kind: "landed" },
    ]);
    expect(journalKinds({ runsDir, slug: "alpha" }).slice(-2)).toEqual(["finished", "closed"]);
    const doc = unwrap(scanBoard({ handoverDir: stateHomePaths({ home }).handovers })).docs.find(
      (candidate) => candidate.slug === "alpha",
    )!;
    const events = unwrap(readRunJournal({ runsDir, slug: "alpha" })).events;
    expect([derivedRowState({ doc, events }).status, derivedRowState({ doc, events }).statusSummary]).toEqual([
      "done",
      "acme/widgets#11 (alpha) merged at merge-11; settled by handover wake's reconcile",
    ]);
    expect(report.reconciliation).toEqual({
      closedUnmerged: 0,
      hidingStep: 0,
      landedUnsettled: 0,
      settled: 1,
      unknown: 0,
    });
  });

  it("writes nothing on a dry run, and says it would close the row", async () => {
    parkedRow({ slug: "alpha", wake: { kind: "checks", number: 11, repo: "acme/widgets" } });
    const recorded = record();
    const deps = fakes({
      checks: { 11: { prState: "MERGED" } },
      finishes: { alpha: 0 },
      heads: { 11: "alpha" },
      recorded,
    });

    const { report } = await wakeJson({ deps, extra: ["--dry-run"], recorded });

    expect([report.rows[0]!.action, report.rows[0]!.closeOutcome, report.reconciliation.settled]).toEqual([
      "would-finish",
      "would-close",
      1,
    ]);
    expect(journalKinds({ runsDir, slug: "alpha" })).toEqual(["started", "launched", "parked"]);
  });

  it("asks finish with no break-glass for a park that asked a question, and reports the step it hides", async () => {
    parkedRow({
      question: "start the next slice from main?",
      slug: "beta",
      wake: { kind: "checks", number: 12, repo: "acme/widgets" },
    });
    const recorded = record();
    const deps = fakes({ checks: { 12: { prState: "MERGED" } }, heads: { 12: "beta" }, recorded });

    const { report } = await wakeJson({ deps, extra: ["--settle-only"], recorded });

    const row = report.rows[0]!;
    expect([recorded.finishLessons, recorded.spawned, row.action, row.closeOutcome]).toEqual([
      ["beta false"],
      [],
      "none",
      undefined,
    ]);
    expect(row.reconciliation).toEqual({
      cause: "question",
      detail: 'the park asked "start the next slice from main?"',
      kind: "hiding-step",
    });
    expect(stillParked({ slug: "beta" })).toBe(true);
  });

  it("reports a merge of somebody else's branch as hiding the run's own next step", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "wake-reconcile-wt-"));
    fixtureDirs.push(worktree);
    parkedRow({ slug: "gamma", wake: { kind: "checks", number: 13, repo: "acme/widgets" }, worktree });
    const recorded = record();
    const deps = fakes({
      branches: { [worktree]: "gamma" },
      checks: { 13: { prState: "MERGED" } },
      heads: { 13: "stack-parent" },
      recorded,
    });

    const { report } = await wakeJson({ deps, extra: ["--settle-only"], recorded });

    expect([recorded.finishLessons, report.rows[0]!.reconciliation?.kind]).toEqual([["gamma false"], "hiding-step"]);
    expect(report.reconciliation.hidingStep).toBe(1);
  });

  it("turns a landed row whose finish still refuses into a hidden step naming the refusal", async () => {
    parkedRow({ slug: "delta", wake: { kind: "checks", number: 14, repo: "acme/widgets" } });
    const recorded = record();
    const deps = fakes({ checks: { 14: { prState: "MERGED" } }, heads: { 14: "delta" }, recorded });

    const { code, report } = await wakeJson({ deps, extra: ["--settle-only"], recorded });

    const landing = report.rows[0]!.reconciliation!;
    expect([code, recorded.finished, recorded.finishLessons]).toEqual([EXIT_EXPECTED_EMPTY, ["delta"], ["delta true"]]);
    expect(landing).toMatchObject({ cause: "finish-refusal", kind: "hiding-step" });
    expect(JSON.stringify(landing)).toContain("but handover finish ended exit 1 (it printed nothing on stderr)");
    expect(journalKinds({ runsDir, slug: "delta" })).toEqual(["started", "launched", "parked"]);
  });

  it("reconciles a closed park on --settle-only, reseating nothing", async () => {
    parkedRow({ slug: "epsilon", wake: { kind: "checks", number: 15, repo: "acme/widgets" } });
    const recorded = record();
    const deps = fakes({ checks: { 15: { prState: "CLOSED" } }, heads: { 15: "epsilon" }, recorded });

    const { report } = await wakeJson({ deps, extra: ["--settle-only"], recorded });

    expect([recorded.finished, recorded.spawned, report.rows[0]!.action, report.rows[0]!.reconciliation]).toEqual([
      [],
      [],
      "none",
      { headRefName: "epsilon", kind: "closed-unmerged" },
    ]);
    expect([report.maxSpawns, report.reconciliation.closedUnmerged, stillParked({ slug: "epsilon" })]).toEqual([
      0,
      1,
      true,
    ]);
  });

  it("keeps the old path for a park whose head did not read", async () => {
    parkedRow({ slug: "zeta", wake: { kind: "checks", number: 16, repo: "acme/widgets" } });
    const recorded = record();
    const deps = fakes({ checks: { 16: { prState: "MERGED" } }, recorded });

    const { report } = await wakeJson({ deps, recorded });

    expect([recorded.finishLessons, recorded.spawned, report.rows[0]!.reconciliation]).toEqual([
      ["zeta false"],
      ["zeta"],
      { kind: "unknown", reason: "the pull request's head did not read: no head in the table" },
    ]);
  });

  it("lifts the ask cap on --settle-only, so every landed row settles in one run", async () => {
    const slugs = Array.from({ length: WAKE_FINISH_ASKS + 1 }, (_, index) => `l${String(index)}`);
    const checks: Record<number, { prState: "MERGED" }> = {};
    const heads: Record<number, string> = {};
    const finishes: Record<string, number> = {};
    slugs.forEach((slug, index) => {
      parkedRow({ slug, wake: { kind: "checks", number: index + 1, repo: "acme/widgets" } });
      checks[index + 1] = { prState: "MERGED" };
      heads[index + 1] = slug;
      finishes[slug] = 0;
    });
    const recorded = record();

    const { code, report } = await wakeJson({
      deps: fakes({ checks, finishes, heads, recorded }),
      extra: ["--settle-only"],
      recorded,
    });

    expect([code, recorded.finished.length, recorded.spawned, report.reconciliation.settled]).toEqual([
      EXIT_OK,
      WAKE_FINISH_ASKS + 1,
      [],
      WAKE_FINISH_ASKS + 1,
    ]);
  });

  it("refuses --settle-only beside --retry", async () => {
    const recorded = record();

    const code = await runHandoverWake({
      deps: fakes({ recorded }),
      rest: ["--settle-only", "--retry", "n-1"],
    });

    expect([code, recorded.diagnostics[0]]).toEqual([
      EXIT_USAGE,
      "handover wake: --settle-only reseats nothing, so it cannot retry a deferred reseat",
    ]);
  });
});

describe("wakeFinishEnv", () => {
  const env = { PATH: "/bin", SLOPWEAVER_ALLOW_NO_LESSONS: "1", SLOPWEAVER_ALLOW_RERUN: "1" };

  it("strips every override variable from a finish the reconcile did not class landed", () => {
    expect(wakeFinishEnv({ allowNoLessons: false, env })).toEqual({ PATH: "/bin" });
  });

  it("carries the lessons break-glass alone for a landed row", () => {
    expect(wakeFinishEnv({ allowNoLessons: true, env: { PATH: "/bin", SLOPWEAVER_ALLOW_RERUN: "1" } })).toEqual({
      PATH: "/bin",
      SLOPWEAVER_ALLOW_NO_LESSONS: "1",
    });
  });
});
