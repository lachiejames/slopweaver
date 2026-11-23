/**
 * Why a broken automation is broken and who fixes it, read straight off the record it was told from.
 */
import { describe, expect, it } from "vitest";

import { fixStageAccount, stoppedAccount, unheldAccount } from "../../../automations/brokenWhy.js";
import type { FiringView } from "../../../automations/card.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";

const SINCE = "2026-10-05T05:41:27.877Z";

const waitingFiring = ({ detail }: { detail: string | null }): FiringView => ({
  attempt: 1,
  detail,
  exitCode: null,
  outcome: "deferred",
  reason: detail,
  runStartedAtIso: null,
  settledAtIso: "2026-10-05T05:00:02.000Z",
  slotIso: "2026-10-05T05:00:00.000Z",
  startedAtIso: "2026-10-05T05:00:01.000Z",
});

const base: Parameters<typeof unheldAccount>[0] = {
  firings: [],
  health: "failed",
  resync: undefined,
  silent: undefined,
  slotVerdict: null,
};

describe("fixStageAccount", () => {
  it("carries the hold's own instant, and says a filed fix with an unread row without a status", () => {
    expect([
      fixStageAccount({ sinceIso: SINCE, stage: { kind: "queued" } }),
      fixStageAccount({ sinceIso: SINCE, stage: { kind: "filed", status: null } }),
      fixStageAccount({ sinceIso: SINCE, stage: { kind: "landed" } }),
    ]).toEqual([
      { by: "fleet", sinceIso: SINCE, words: "The fix is the fleet's. It is on the board, not picked up yet." },
      { by: "fleet", sinceIso: SINCE, words: "The fix is the fleet's, filed as its own piece of work." },
      { by: "fleet", sinceIso: SINCE, words: "The fix has landed; the scheduler runs it again on its own." },
    ]);
  });
});

describe("stoppedAccount", () => {
  /** A stopped row of this reason, carrying the supervisor's reading when given. */
  const silentOf = ({
    reason,
    supervisorStop,
  }: {
    reason: SilentRow["reason"];
    supervisorStop?: SilentRow["supervisorStop"];
  }): SilentRow => ({
    cadence: "0 */4 * * *",
    currentSlotHold: null,
    detail: "the record",
    lastRunAtIso: "2026-10-07T13:52:23.126Z",
    missedSlots: 1,
    reason,
    recipeId: "r",
    supervisorStop,
  });

  it("says each reason a row stopped in words free of slots, cadences, exit codes and instants", () => {
    const silents = [
      undefined,
      silentOf({ reason: "UNSCHEDULABLE" }),
      silentOf({ reason: "NEVER RUN" }),
      silentOf({ reason: "DEFERRED" }),
      silentOf({ reason: "FAILING" }),
      silentOf({ reason: "MISSED" }),
      silentOf({ reason: "MISSED", supervisorStop: { kind: "held", reason: "cpu hold", recordedIso: SINCE } }),
      silentOf({ reason: "MISSED", supervisorStop: { firstSeenDueIso: SINCE, kind: "passed-over", passes: 1 } }),
      silentOf({ reason: "MISSED", supervisorStop: { kind: "no-due-reading" } }),
      silentOf({ reason: "MISSED", supervisorStop: { kind: "unreadable" } }),
    ];

    expect(silents.map((silent) => stoppedAccount({ silent }).why)).toEqual([
      "It has stopped running on its schedule.",
      "Its schedule cannot be read, so it will never run on its own.",
      "It has never run.",
      "It is waiting for something it needs before it can run, and has not run since.",
      "Its last run failed, and it has not run on its schedule since.",
      "It missed its scheduled time, and nothing on record says why.",
      "The supervisor is holding it back, and said why: “cpu hold”",
      "It is due, but the supervisor has seen it waiting 1 time without running it or saying why.",
      "It missed its scheduled time, and no supervisor check has looked at it since.",
      "It missed its scheduled time, and the supervisor's record could not be read to say why.",
    ]);
  });

  it("says a supervisor hold on a never-run, failing or deferred row, and an unschedulable row's schedule still", () => {
    const stop = { kind: "held", reason: "a held word", recordedIso: SINCE } as const;
    const reasons = ["NEVER RUN", "FAILING", "DEFERRED", "UNSCHEDULABLE"] as const;

    expect(reasons.map((reason) => stoppedAccount({ silent: silentOf({ reason, supervisorStop: stop }) }).why)).toEqual(
      [
        "The supervisor is holding it back, and said why: “a held word”",
        "The supervisor is holding it back, and said why: “a held word”",
        "The supervisor is holding it back, and said why: “a held word”",
        "Its schedule cannot be read, so it will never run on its own.",
      ],
    );
  });

  it("dates a supervisor hold's fix by when the supervisor recorded it", () => {
    const held = stoppedAccount({
      silent: silentOf({ reason: "MISSED", supervisorStop: { kind: "held", reason: "x", recordedIso: SINCE } }),
    });

    expect(held.fix).toStrictEqual({
      by: "fleet",
      sinceIso: SINCE,
      words: "It runs when the supervisor lifts its hold.",
    });
  });
});

describe("unheldAccount", () => {
  it("says what a waiting row waits on when its newest firing names it, and nothing extra when it does not", () => {
    const named = unheldAccount({
      ...base,
      firings: [waitingFiring({ detail: "the corpus lock" })],
      health: "waiting",
    });
    const unnamed = unheldAccount({ ...base, firings: [waitingFiring({ detail: null })], health: "waiting" });

    expect([named.why, unnamed.why, named.fix]).toEqual([
      "It is waiting on something else first: the corpus lock.",
      "It is waiting on something else first.",
      { by: "fleet", sinceIso: null, words: "Nobody needs to act; waiting spends none of its retries." },
    ]);
  });

  it("reads a retry verdict the same as a cooling one: the scheduler tries again on its own", () => {
    const secondAttempt = unheldAccount({
      ...base,
      slotVerdict: { attempt: 2, kind: "retry", previousDetail: "exit 1" },
    });

    expect([secondAttempt.why, secondAttempt.fix.words]).toEqual([
      "The run for its latest scheduled time failed.",
      "Nobody needs to act yet; the scheduler retries it on its own.",
    ]);
  });

  it("says a dead latest firing stopped partway, never that it failed", () => {
    const dead: FiringView = {
      ...waitingFiring({ detail: "attempt 1 was abandoned" }),
      outcome: "dead",
      reason: "HOLDER_GONE",
    };
    const account = unheldAccount({ ...base, firings: [dead] });

    expect([account.why, account.fix.words]).toEqual([
      "The run for its latest scheduled time stopped partway and never finished.",
      "Nobody has been named to act; the scheduler decides whether it is safe to try it again.",
    ]);
  });
});
