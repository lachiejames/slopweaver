import { describe, expect, it } from "vitest";

import type { FiringView } from "../../../automations/card.js";
import { historyAnswersOf, runAnswersOf, syncRunsSaidOf } from "../../../automations/cardAnswers.js";
import type { SyncRunView } from "../../../syncRun/fold.js";

const firing = (over: Partial<FiringView>): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-10-03T00:20:00.000Z",
  slotIso: "2026-10-03T00:00:00.000Z",
  startedAtIso: "2026-10-03T00:00:00.000Z",
  ...over,
});

const syncRun = (over: Partial<SyncRunView>): SyncRunView => ({
  committedWritten: 0,
  containers: [],
  elapsedMs: 600_000,
  errors: [],
  finishedAtIso: "2026-10-03T00:10:00.000Z",
  gaps: 0,
  lastActivityIso: "2026-10-03T00:10:00.000Z",
  lastCommittedIso: null,
  ledgerFailures: 0,
  malformedLines: 0,
  newByKind: {},
  pid: null,
  progress: null,
  progressRate: null,
  quietContainers: [],
  quietForMs: null,
  reported: null,
  runId: "r",
  source: "slack",
  stalled: false,
  startedAtIso: "2026-10-03T00:00:00.000Z",
  state: "finished",
  warnings: 0,
  why: "finished",
  window: null,
  writtenRate: null,
  ...over,
});

describe("historyAnswersOf", () => {
  it("dates the last break and the last success by when each settled, never by slot", () => {
    // The newer slot settled first, so the older slot's failure is the last thing that happened.
    const newerSlot = firing({ settledAtIso: "2026-10-03T05:00:00.000Z", slotIso: "2026-10-03T04:00:00.000Z" });
    const olderSlot = firing({
      detail: "slack 429",
      outcome: "failed",
      settledAtIso: "2026-10-03T06:00:00.000Z",
      slotIso: "2026-10-03T02:00:00.000Z",
    });

    expect(historyAnswersOf({ firings: [newerSlot, olderSlot], run: undefined })).toStrictEqual({
      brokeAtIsos: ["2026-10-03T06:00:00.000Z"],
      lastBrokeIso: "2026-10-03T06:00:00.000Z",
      lastSucceededIso: "2026-10-03T05:00:00.000Z",
      newestFailure: { atIso: "2026-10-03T06:00:00.000Z", detail: "slack 429" },
    });
  });

  it("says nothing broke and nothing worked over a ledger with no finished firing", () => {
    const open = firing({ outcome: "open", settledAtIso: null });

    expect(historyAnswersOf({ firings: [open], run: undefined })).toStrictEqual({
      brokeAtIsos: [],
      lastBrokeIso: null,
      lastSucceededIso: null,
      newestFailure: null,
    });
  });
});

describe("runAnswersOf", () => {
  it("marks only the run under way, and never quotes a dead firing's bookkeeping as what it said", () => {
    const stranded = firing({ outcome: "open", settledAtIso: null, slotIso: "2026-10-03T00:00:00.000Z" });
    const died = firing({
      outcome: "dead",
      reason: "HOLDER_GONE: abandoned",
      settledAtIso: "2026-10-03T04:30:00.000Z",
      slotIso: "2026-10-03T04:00:00.000Z",
    });

    const answers = runAnswersOf({
      explanations: new Map(),
      firings: [died, stranded],
      historyComplete: true,
      nowIso: "2026-10-03T09:00:00.000Z",
      run: undefined,
      skipped: null,
      timing: "taken",
    });

    expect(answers.recentFirings.map((view) => [view.outcome, view.underWay, view.said, view.runMs])).toEqual([
      ["dead", false, null, null],
      ["open", false, null, null],
    ]);
  });

  it("says a failed firing's cause plainly only as its session explained it, never off a code in its record", () => {
    const explainedFailure = firing({
      detail: "exit 1: digest post failed",
      outcome: "failed",
      settledAtIso: "2026-10-03T06:10:00.000Z",
      slotIso: "2026-10-03T06:00:00.000Z",
    });
    const unexplainedCode = firing({
      attempt: 3,
      detail: "ATTEMPTS_EXHAUSTED: attempt 3 of 3 failed (connect ETIMEDOUT 10.0.0.1:443)",
      outcome: "dead",
      settledAtIso: "2026-10-03T05:10:00.000Z",
      slotIso: "2026-10-03T05:00:00.000Z",
    });
    const worked = firing({});

    const answers = runAnswersOf({
      explanations: new Map([
        ["2026-10-03T06:00:00.000Z#1", "The digest channel was archived, so repointing it fixes it."],
      ]),
      firings: [explainedFailure, unexplainedCode, worked],
      historyComplete: true,
      nowIso: "2026-10-03T09:00:00.000Z",
      run: undefined,
      skipped: null,
      timing: "taken",
    });

    expect(answers.recentFirings.map((view) => view.plainly)).toEqual([
      "The digest channel was archived, so repointing it fixes it.",
      null,
      null,
    ]);
  });
});

describe("syncRunsSaidOf", () => {
  it("says a sync run's first error without the runner's framing, a killed run's fate, and nothing for a clean one", () => {
    const runs = [
      syncRun({ errors: ["exit 1: slack 429 rate limited"], runId: "failed", state: "failed" }),
      syncRun({ finishedAtIso: null, runId: "killed", state: "ended-unfinished" }),
      syncRun({ runId: "clean" }),
    ];

    expect(syncRunsSaidOf({ syncRuns: runs }).map((view) => [view.runId, view.said])).toEqual([
      ["failed", "slack 429 rate limited"],
      ["killed", "It was stopped or crashed before it finished; the next refresh reads the same window again."],
      ["clean", null],
    ]);
  });
});
