/**
 * The plain sentence a broken automation leads with: only ever the one the visible session recorded for the exact
 * firing that finished last, never derived from the record's own text. A sibling of `./brokenAccount.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { brokenAccountOf } from "../../../automations/brokenAccount.js";
import type { FiringView } from "../../../automations/card.js";
import { endedSyncsOf, plainlyOf, syncEndMs } from "../../../automations/plainly.js";
import { CORPUS_PURPOSES } from "../../../automations/purpose.js";
import type { RecipeDefinitionRun } from "../../../live/automation/definitionRunStore.js";
import type { SyncRunView } from "../../../syncRun/fold.js";

const firing = (over: Partial<FiringView>): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-10-04T21:24:39.552Z",
  slotIso: "2026-10-04T21:00:00.000Z",
  startedAtIso: "2026-10-04T21:00:01.000Z",
  ...over,
});

const syncRun = (over: Partial<SyncRunView>): SyncRunView => ({
  committedWritten: 0,
  containers: [],
  elapsedMs: 600_000,
  errors: [],
  finishedAtIso: "2026-10-05T05:51:00.000Z",
  gaps: 0,
  lastActivityIso: "2026-10-05T05:51:00.000Z",
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
  source: "linear",
  stalled: false,
  startedAtIso: "2026-10-05T05:41:00.000Z",
  state: "finished",
  warnings: 0,
  why: "finished",
  window: null,
  writtenRate: null,
  ...over,
});

const base: Parameters<typeof brokenAccountOf>[0] = {
  explanations: new Map(),
  firings: [],
  historyGaps: [],
  health: "failed",
  hold: null,
  purpose: CORPUS_PURPOSES.linear,
  recipeId: "error-tracking-batch-acme-admin",
  resync: undefined,
  run: undefined,
  silent: undefined,
  slotVerdict: null,
  syncRuns: [],
};

describe("plainly's end-of-run order", () => {
  it("ends a sync run at its finish, else its last row, else never, and an unparseable one at NaN", () => {
    expect([
      syncEndMs({ run: syncRun({}) }),
      syncEndMs({ run: syncRun({ finishedAtIso: null, lastActivityIso: "2026-10-05T05:45:00.000Z" }) }),
      syncEndMs({ run: syncRun({ finishedAtIso: null, lastActivityIso: null }) }),
      syncEndMs({ run: syncRun({ finishedAtIso: "torn" }) }),
    ]).toEqual([Date.parse("2026-10-05T05:51:00.000Z"), Date.parse("2026-10-05T05:45:00.000Z"), -Infinity, Number.NaN]);
  });

  it("lists ended sync runs by when they ENDED, last first, and leaves a running one out", () => {
    const longEarly = syncRun({ finishedAtIso: "2026-10-05T06:30:00.000Z", runId: "long" });
    const shortLate = syncRun({ finishedAtIso: "2026-10-05T06:00:00.000Z", runId: "short" });
    const running = syncRun({ finishedAtIso: null, runId: "running", state: "running" });

    expect(endedSyncsOf({ syncRuns: [shortLate, running, longEarly] }).map((run) => run.runId)).toEqual([
      "long",
      "short",
    ]);
  });

  it("names the explained failure that finished last, and nothing once a sync ended after it", () => {
    const failed = firing({ exitCode: 1, outcome: "failed", settledAtIso: "2026-10-05T05:41:27.858Z" });
    const explanations = new Map([[`${failed.slotIso}#1`, "The sign-in expired, so reconnecting it fixes it."]]);
    const args = { explanations, firings: [failed], run: undefined, syncRuns: [] };

    expect([
      plainlyOf(args),
      plainlyOf({ ...args, syncRuns: [syncRun({ finishedAtIso: "2026-10-05T05:50:00.000Z" })] }),
    ]).toEqual(["The sign-in expired, so reconnecting it fixes it.", null]);
  });

  it("names no sentence while a sync that ended unfinished may have died after the failure", () => {
    const failed = firing({ exitCode: 1, outcome: "failed", settledAtIso: "2026-10-05T09:05:00.000Z" });
    const explanations = new Map([[`${failed.slotIso}#1`, "The sign-in expired, so reconnecting it fixes it."]]);
    // Its last row at 09:01, before the failure settled; its process died at some unknown time after that row.
    const unfinished = syncRun({
      finishedAtIso: null,
      lastActivityIso: "2026-10-05T09:01:00.000Z",
      runId: "dead",
      startedAtIso: "2026-10-05T09:00:00.000Z",
      state: "ended-unfinished",
    });
    // A later run of the same source took the refresh slot before the failure settled, so the dead one was gone by then.
    const nextBefore = syncRun({
      finishedAtIso: "2026-10-05T09:04:00.000Z",
      lastActivityIso: "2026-10-05T09:04:00.000Z",
      runId: "next",
      startedAtIso: "2026-10-05T09:03:00.000Z",
    });
    const said = ({ syncRuns }: { syncRuns: readonly SyncRunView[] }): string | null =>
      plainlyOf({ explanations, firings: [failed], run: undefined, syncRuns });

    expect([said({ syncRuns: [unfinished] }), said({ syncRuns: [unfinished, nextBefore] })]).toEqual([
      null,
      "The sign-in expired, so reconnecting it fixes it.",
    ]);
  });
});

describe("brokenAccountOf plainly", () => {
  it("leads with what went wrong in plain words only as the session explained that exact firing, never off a code", () => {
    const failed = firing({
      attempt: 2,
      detail: "exit 1: linear read: HTTP 401 Unauthorized",
      exitCode: 1,
      outcome: "failed",
      reason: "linear read: HTTP 401 Unauthorized",
      settledAtIso: "2026-10-05T05:41:27.858Z",
      slotIso: "2026-10-05T05:00:00.000Z",
    });
    const explained = new Map([["2026-10-05T05:00:00.000Z#2", "The sign-in expired, so reconnecting it fixes it."]]);
    const otherAttempt = new Map([["2026-10-05T05:00:00.000Z#1", "That was the first try."]]);

    const whole = { ...base, explanations: explained, firings: [failed, firing({})] };

    expect([
      brokenAccountOf({ ...whole, historyGaps: [null, null, null] })!.plainly,
      brokenAccountOf({ ...base, explanations: otherAttempt, firings: [failed, firing({})] })!.plainly,
      brokenAccountOf({ ...base, firings: [failed, firing({})] })!.why,
      brokenAccountOf({ ...whole, historyGaps: ["1 slot ledger file(s) did not decode", null, null] })!.plainly,
      brokenAccountOf({ ...whole, historyGaps: [null, "the sync runs did not read", null] })!.plainly,
      brokenAccountOf({ ...whole, historyGaps: [null, null, "the run stamps file did not read"] })!.plainly,
      brokenAccountOf({ ...whole, syncRuns: [syncRun({ finishedAtIso: "2026-10-05T05:30:00.000Z" })] })!.plainly,
      brokenAccountOf({
        ...whole,
        syncRuns: [syncRun({ finishedAtIso: "2026-10-05T05:30:00.000Z", malformedLines: 1 })],
      })!.plainly,
      brokenAccountOf({
        ...whole,
        syncRuns: [syncRun({ finishedAtIso: null, startedAtIso: null, state: "unreadable" })],
      })!.plainly,
      brokenAccountOf({
        ...whole,
        syncRuns: [syncRun({ finishedAtIso: "2026-10-05T05:30:00.000Z", ledgerFailures: 1 })],
      })!.plainly,
    ]).toEqual([
      "The sign-in expired, so reconnecting it fixes it.",
      null,
      "The run for its latest scheduled time failed.",
      null,
      null,
      null,
      "The sign-in expired, so reconnecting it fixes it.",
      null,
      null,
      null,
    ]);
  });

  it("folds an explained firing's WHOLE record beneath the sentence, a failed one and a dead one alike", () => {
    const failed = firing({
      detail: "exit 1: linear read: HTTP 401 Unauthorized\n  at readIssues (linear.ts:40)",
      exitCode: 1,
      outcome: "failed",
      reason: "linear read: HTTP 401 Unauthorized",
      settledAtIso: "2026-10-05T05:41:27.858Z",
      slotIso: "2026-10-05T05:00:00.000Z",
    });
    const dead = firing({
      detail: "lease expired: the seated session closed\n  pid 4242",
      exitCode: null,
      outcome: "dead",
      reason: "lease expired: the seated session closed",
      settledAtIso: "2026-10-05T05:41:27.858Z",
      slotIso: "2026-10-05T05:00:00.000Z",
    });
    const explanations = new Map([["2026-10-05T05:00:00.000Z#1", "The sign-in expired, so reconnecting it fixes it."]]);

    expect([
      brokenAccountOf({ ...base, explanations, firings: [failed] })!.detail,
      brokenAccountOf({ ...base, explanations, firings: [dead] })!.detail,
      brokenAccountOf({ ...base, firings: [failed] })!.detail,
      brokenAccountOf({ ...base, firings: [dead] })!.detail,
    ]).toEqual([
      "exit 1: linear read: HTTP 401 Unauthorized\n  at readIssues (linear.ts:40)",
      "lease expired: the seated session closed\n  pid 4242",
      "linear read: HTTP 401 Unauthorized",
      null,
    ]);
  });

  it("names no sentence for a dead firing anything else ended after it started, since it died at an unknown instant", () => {
    const dead = firing({
      outcome: "dead",
      settledAtIso: "2026-10-05T07:00:00.000Z",
      slotIso: "2026-10-05T05:00:00.000Z",
      startedAtIso: "2026-10-05T05:00:01.000Z",
    });
    // A success that settled after the dead firing began, yet before the lease that retired it ran out.
    const workedSince = firing({ settledAtIso: "2026-10-05T06:00:00.000Z", slotIso: "2026-10-05T06:00:00.000Z" });
    const workedBefore = firing({ settledAtIso: "2026-10-05T04:00:00.000Z", slotIso: "2026-10-05T04:00:00.000Z" });
    const explanations = new Map([["2026-10-05T05:00:00.000Z#1", "The sign-in expired, so reconnecting it fixes it."]]);
    const said = ({ firings, run }: { firings: readonly FiringView[]; run?: RecipeDefinitionRun }): string | null =>
      plainlyOf({ explanations, firings, run, syncRuns: [] });
    // The stamp a dead-letter retirement writes at the death's own settle (`slotDeadLetter.ts`), and one a run wrote
    // after the dead firing began, before its retirement.
    const ownStamp = { exitCode: 1, lastRunAtIso: dead.settledAtIso!, watermarkIso: dead.slotIso };
    const laterStamp = { exitCode: 0, lastRunAtIso: "2026-10-05T06:30:00.000Z", watermarkIso: dead.slotIso };

    expect([
      said({ firings: [workedSince, dead] }),
      said({ firings: [workedBefore, dead] }),
      said({ firings: [workedBefore, dead], run: ownStamp }),
      said({ firings: [workedBefore, dead], run: laterStamp }),
    ]).toEqual([
      null,
      "The sign-in expired, so reconnecting it fixes it.",
      "The sign-in expired, so reconnecting it fixes it.",
      null,
    ]);
  });

  it("says no cause when the run that finished last worked, or its record names none, rather than guessing", () => {
    const failedEarlier = firing({
      detail: "exit 1: HTTP 401",
      exitCode: 1,
      outcome: "failed",
      reason: "HTTP 401",
      settledAtIso: "2026-10-04T20:00:00.000Z",
      slotIso: "2026-10-04T20:00:00.000Z",
    });
    const unexplained = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1",
      settledAtIso: "2026-10-05T05:41:27.858Z",
      slotIso: "2026-10-05T05:00:00.000Z",
    });

    expect([
      brokenAccountOf({ ...base, firings: [firing({}), failedEarlier] })!.plainly,
      brokenAccountOf({ ...base, firings: [unexplained] })!.plainly,
    ]).toEqual([null, null]);
  });

  it("never lets an older firing's explanation speak for a later run it is not about", () => {
    const older = firing({
      detail: "exit 1: HTTP 401",
      exitCode: 1,
      outcome: "failed",
      reason: "HTTP 401",
      settledAtIso: "2026-10-10T09:00:00.000Z",
      slotIso: "2026-10-10T09:00:00.000Z",
    });
    const explained = new Map([["2026-10-10T09:00:00.000Z#1", "The sign-in expired, so reconnecting it fixes it."]]);
    const laterSync = syncRun({
      errors: ["exit 1: refresh: no token"],
      finishedAtIso: "2026-10-10T11:00:00.000Z",
      startedAtIso: "2026-10-10T10:30:00.000Z",
      state: "failed",
    });
    const stopped = { ...base, explanations: explained, firings: [older], health: "stopped" as const };

    expect([
      brokenAccountOf({
        ...stopped,
        run: { exitCode: 0, lastRunAtIso: "2026-10-10T10:00:00.000Z", watermarkIso: "2026-10-10T08:00:00.000Z" },
      })!.plainly,
      brokenAccountOf({
        ...stopped,
        run: { exitCode: 1, lastRunAtIso: "2026-10-10T09:00:00.000Z", watermarkIso: "2026-10-10T09:00:00.000Z" },
      })!.plainly,
      brokenAccountOf({ ...stopped, syncRuns: [laterSync] })!.plainly,
      brokenAccountOf({ ...stopped, syncRuns: [syncRun({ finishedAtIso: older.settledAtIso! })] })!.plainly,
    ]).toEqual([null, "The sign-in expired, so reconnecting it fixes it.", null, null]);
  });

  it("names no sentence when another run may have ended last: a same-millisecond settle, or an instant that won't parse", () => {
    const settledAtIso = "2026-11-04T12:00:00.000Z";
    const a = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "x",
      settledAtIso,
      slotIso: "2026-11-04T10:00:00.000Z",
    });
    const b = firing({
      attempt: 2,
      exitCode: 1,
      outcome: "failed",
      reason: "y",
      settledAtIso,
      slotIso: "2026-11-04T09:00:00.000Z",
    });
    const explained = new Map([
      ["2026-11-04T10:00:00.000Z#1", "A's sentence."],
      ["2026-11-04T09:00:00.000Z#2", "B's sentence."],
    ]);
    const lone = { ...base, explanations: explained, health: "failed" as const };

    const bOtherSpelling = { ...b, settledAtIso: "2026-11-04T13:00:00.000+01:00" };
    const bUnparsed = { ...b, outcome: "succeeded" as const, settledAtIso: "not an instant" };

    expect([
      brokenAccountOf({ ...lone, firings: [a, b] })!.plainly,
      brokenAccountOf({ ...lone, firings: [a, bOtherSpelling] })!.plainly,
      brokenAccountOf({ ...lone, firings: [a, bUnparsed] })!.plainly,
      brokenAccountOf({ ...lone, firings: [a], syncRuns: [syncRun({ finishedAtIso: "torn" })] })!.plainly,
      brokenAccountOf({ ...lone, firings: [a] })!.plainly,
    ]).toEqual([null, null, null, null, "A's sentence."]);
  });

  it("names no sentence when a success stamped the run in the failure's own millisecond with no readable row", () => {
    const settledAtIso = "2026-11-04T12:00:00.000Z";
    const failed = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "x",
      settledAtIso,
      slotIso: "2026-11-04T10:00:00.000Z",
    });
    const stopped = {
      ...base,
      explanations: new Map([["2026-11-04T10:00:00.000Z#1", "The token expired."]]),
      firings: [failed],
      health: "stopped" as const,
    };

    const slot = failed.slotIso;
    expect([
      brokenAccountOf({ ...stopped, run: { exitCode: 0, lastRunAtIso: settledAtIso, watermarkIso: slot } })!.plainly,
      brokenAccountOf({ ...stopped, run: { exitCode: 1, lastRunAtIso: settledAtIso, watermarkIso: slot } })!.plainly,
    ]).toEqual([null, "The token expired."]);
  });

  it("names no sentence when a same-instant failure of another slot stamped the run but never reached the ledger", () => {
    const settledAtIso = "2026-11-04T12:00:00.000Z";
    const a = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "x",
      settledAtIso,
      slotIso: "2026-11-04T10:00:00.000Z",
    });
    const stopped = {
      ...base,
      explanations: new Map([["2026-11-04T10:00:00.000Z#1", "A failed. Fix A."]]),
      firings: [a],
      health: "stopped" as const,
    };

    expect([
      brokenAccountOf({
        ...stopped,
        run: { exitCode: 1, lastRunAtIso: settledAtIso, watermarkIso: "2026-11-04T11:00:00.000Z" },
      })!.plainly,
      brokenAccountOf({ ...stopped, run: { exitCode: 1, lastRunAtIso: settledAtIso, watermarkIso: a.slotIso } })!
        .plainly,
    ]).toEqual([null, "A failed. Fix A."]);
  });

  it("names no sentence when an older firing is still open and the stamp's held-back watermark hides its slot", () => {
    const settledAtIso = "2026-11-04T12:00:00.000Z";
    const a = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "x",
      settledAtIso,
      slotIso: "2026-11-04T10:00:00.000Z",
    });
    const b = firing({ outcome: "open", settledAtIso: null, slotIso: "2026-11-04T09:00:00.000Z" });
    const stopped = {
      ...base,
      explanations: new Map([["2026-11-04T10:00:00.000Z#1", "A failed. Fix A."]]),
      health: "stopped" as const,
      run: { exitCode: 1, lastRunAtIso: settledAtIso, watermarkIso: a.slotIso },
    };

    expect([
      brokenAccountOf({ ...stopped, firings: [a, b] })!.plainly,
      brokenAccountOf({ ...stopped, firings: [a] })!.plainly,
    ]).toEqual([null, "A failed. Fix A."]);
  });
});
