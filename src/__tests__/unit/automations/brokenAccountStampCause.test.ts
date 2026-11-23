/**
 * The cause a dead firing's run stamp keeps (`failureCause`): folded beneath the answers once the ledger no longer
 * reads the run that wrote it, and never quoted as what that run SAID. A sibling of
 * `./brokenAccount.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { brokenAccountOf } from "../../../automations/brokenAccount.js";
import type { FiringView } from "../../../automations/card.js";
import { CORPUS_PURPOSES } from "../../../automations/purpose.js";

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

describe("brokenAccountOf — a dead run's stamp cause", () => {
  it("folds the cause a dead run's stamp kept once its ledger row is gone, never quoting it as the run's words", () => {
    const older = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: old service error",
      settledAtIso: "2026-10-10T09:00:00.000Z",
    });
    const cause =
      "ATTEMPTS_EXHAUSTED: recipe knock-alerts · ran · slack post --as bot · exit 1 · why: slack post: channel_not_found";

    const deadUnread = brokenAccountOf({
      ...base,
      firings: [older],
      health: "stopped",
      run: {
        exitCode: 1,
        failureCause: cause,
        lastRunAtIso: "2026-10-10T10:00:00.000Z",
        watermarkIso: "2026-10-10T08:00:00.000Z",
      },
    })!;
    const noCauseKept = brokenAccountOf({
      ...base,
      firings: [older],
      health: "stopped",
      run: { exitCode: 1, lastRunAtIso: "2026-10-10T10:00:00.000Z", watermarkIso: "2026-10-10T08:00:00.000Z" },
    })!;

    expect([deadUnread.said, deadUnread.detail]).toEqual([null, cause]);
    expect([noCauseKept.said, noCauseKept.detail]).toEqual([null, null]);
  });

  it("never folds a stamp cause while the ledger still reads the firing that wrote the stamp", () => {
    const dead = firing({
      detail: "attempt 3 of 3 failed (exit 1 · why: refresh: no token)",
      exitCode: null,
      outcome: "dead",
      reason: "ATTEMPTS_EXHAUSTED: attempt 3 of 3 failed",
      settledAtIso: "2026-10-10T10:00:00.000Z",
    });

    const account = brokenAccountOf({
      ...base,
      firings: [dead],
      health: "stuck",
      run: {
        exitCode: 1,
        failureCause: "ATTEMPTS_EXHAUSTED: attempt 3 of 3 failed",
        failureSlotIso: dead.slotIso,
        lastRunAtIso: "2026-10-10T10:00:00.000Z",
        watermarkIso: "2026-10-10T08:00:00.000Z",
      },
    })!;

    expect(account.detail).toBeNull();
  });

  it("still folds the cause when another slot's firing, of any ending, settled in the stamp's own millisecond", () => {
    const cause = "ATTEMPTS_EXHAUSTED: attempt 3 of 3 failed (exit 1 · why: refresh: no token)";
    const accountWith = (sameInstant: FiringView): ReturnType<typeof brokenAccountOf> =>
      brokenAccountOf({
        ...base,
        firings: [sameInstant],
        health: "stopped",
        run: {
          exitCode: 1,
          failureCause: cause,
          failureSlotIso: "2026-10-10T09:30:00.000Z",
          lastRunAtIso: "2026-10-10T10:00:00.000Z",
          watermarkIso: "2026-10-10T08:00:00.000Z",
        },
      });

    const worked = accountWith(firing({ settledAtIso: "2026-10-10T10:00:00.000Z" }))!;
    // Failed, at the same instant, whose own words even quote the cause: it did not write the dead stamp, so it never
    // speaks for the run that finished last.
    const failed = accountWith(
      firing({
        detail: "an unrelated firing's own failure",
        exitCode: 1,
        outcome: "failed",
        reason: `exit 1: ${cause}`,
        settledAtIso: "2026-10-10T10:00:00.000Z",
      }),
    )!;

    // Dead, at the same instant, with word-for-word the same cause: only its slot says it is not the one.
    const deadOfTheSameCause = accountWith(
      firing({
        detail: cause,
        exitCode: null,
        outcome: "dead",
        reason: cause,
        settledAtIso: "2026-10-10T10:00:00.000Z",
      }),
    )!;

    expect([worked.said, worked.detail]).toEqual([null, cause]);
    expect([failed.said, failed.detail]).toEqual([null, cause]);
    expect([deadOfTheSameCause.said, deadOfTheSameCause.detail]).toEqual([null, cause]);
  });
});
