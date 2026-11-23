/**
 * The silent-row measure, and the WITNESS its finding asked for: `vulnfix-digest-acme-admin`
 * deferring two of its daily slots must produce a row that names DEFERRED and carries what it was waiting
 * for. Every case here is the shape of a real record — a deferred slot row, a non-zero exit stamp, an absent
 * stamp, a cadence that will not parse — rather than an invented one.
 */
import { describe, expect, it } from "vitest";

import { stampedOutcomeOf } from "../../../../live/automation/silentRowReader.js";
import { type SilenceCandidate, silentRows } from "../../../../live/automation/silentRows.js";
import type { RecipeSlotAttempt, RecipeSlotOutcome } from "../../../../live/automation/slotAttempt.js";

const NOW = "2026-09-18T08:00:00.000Z";

/** The digest row as the finding found it, with whatever the case under test changes. */
function digest({ over = {} }: { over?: Partial<SilenceCandidate> } = {}): SilenceCandidate {
  return {
    cadence: "30 9 * * *",
    currentSlotHold: null,
    currentSlotOutcome: null,
    firingsSinceWatermark: 1,
    lastExitCode: 0,
    lastRunAtIso: "2026-09-16T03:46:41.000Z",
    recipeId: "vulnfix-digest-acme-admin",
    ...over,
  };
}

/** A four-hourly resync row, for the sub-daily half of the threshold. */
function resync({ over = {} }: { over?: Partial<SilenceCandidate> } = {}): SilenceCandidate {
  return {
    cadence: "0 */4 * * *",
    currentSlotHold: null,
    currentSlotOutcome: null,
    firingsSinceWatermark: 1,
    lastExitCode: 0,
    lastRunAtIso: "2026-09-18T04:00:00.000Z",
    recipeId: "resync-atlas-datadog",
    ...over,
  };
}

describe("silentRows", () => {
  it("says nothing about a daily row that is merely due and has missed no slot", () => {
    expect(silentRows({ candidates: [digest()], nowIso: NOW })).toEqual([]);
  });

  it("reports a daily row the moment ONE whole slot has gone by unrun", () => {
    const rows = silentRows({ candidates: [digest({ over: { firingsSinceWatermark: 2 } })], nowIso: NOW });

    expect(rows.length).toBe(1);
    expect(rows[0]!.recipeId).toBe("vulnfix-digest-acme-admin");
    expect(rows[0]!.missedSlots).toBe(1);
    expect(rows[0]!.reason).toBe("MISSED");
  });

  it("stays quiet about a FOUR-HOURLY row that has missed one slot, and reports it on the second", () => {
    const one = silentRows({ candidates: [resync({ over: { firingsSinceWatermark: 2 } })], nowIso: NOW });
    const two = silentRows({ candidates: [resync({ over: { firingsSinceWatermark: 3 } })], nowIso: NOW });

    expect(one).toEqual([]);
    expect(two.length).toBe(1);
    expect(two[0]!.missedSlots).toBe(2);
  });

  it("THE WITNESS — vulnfix-digest-acme-admin deferring twice reads DEFERRED, carrying what it waits on", () => {
    const rows = silentRows({
      candidates: [
        digest({
          over: {
            currentSlotOutcome: {
              detail: "a top-up generation is still opening this batch: vulnfix-topup-acme-acme-admin-1789633808900",
              kind: "deferred",
              settledAtIso: "2026-09-18T00:05:00.000Z",
            },
            firingsSinceWatermark: 3,
          },
        }),
      ],
      nowIso: NOW,
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.reason).toBe("DEFERRED");
    expect(rows[0]!.missedSlots).toBe(2);
    expect(rows[0]!.detail).toContain("vulnfix-topup-acme-acme-admin-1789633808900");
    expect(rows[0]!.detail).toContain("the verb ran and declined to act");
  });

  it("reads NEVER RUN off an absent stamp rather than reporting a plain miss", () => {
    const rows = silentRows({
      candidates: [digest({ over: { firingsSinceWatermark: 4, lastExitCode: null, lastRunAtIso: null } })],
      nowIso: NOW,
    });

    expect(rows[0]!.reason).toBe("NEVER RUN");
    expect(rows[0]!.detail).toContain("never run at all");
  });

  it("reads FAILING off a non-zero exit, and names the code", () => {
    const rows = silentRows({
      candidates: [digest({ over: { firingsSinceWatermark: 2, lastExitCode: 1 } })],
      nowIso: NOW,
    });

    expect(rows[0]!.reason).toBe("FAILING");
    expect(rows[0]!.detail).toContain("exited 1");
  });

  it("never reads FAILING off an exit the slot ledger settled as a success — a verb-run's exit 3 is nothing to do", () => {
    const succeeded = { exitCode: 3, kind: "succeeded", settledAtIso: "2026-09-16T03:46:41.000Z" } as const;
    const failed = {
      detail: "exit 3",
      exitCode: 3,
      kind: "failed",
      retryNotBeforeIso: "2026-09-16T04:00:00.000Z",
      settledAtIso: succeeded.settledAtIso,
    } as const;
    const reasonWith = ({ outcome }: { outcome: SilenceCandidate["lastRunSlotOutcome"] }): string =>
      silentRows({
        candidates: [digest({ over: { firingsSinceWatermark: 2, lastExitCode: 3, lastRunSlotOutcome: outcome } })],
        nowIso: NOW,
      })[0]!.reason;

    expect([
      reasonWith({ outcome: succeeded }),
      reasonWith({ outcome: failed }),
      reasonWith({ outcome: null }),
      reasonWith({ outcome: undefined }),
    ]).toEqual(["MISSED", "FAILING", "FAILING", "FAILING"]);
  });

  it("joins the run stamp to the firing that settled at its instant, not to its watermark slot", () => {
    // The 10:00 slot dies at 10:05; the older 09:00 slot then succeeds with exit 3 at 10:10. The stamp keeps the
    // 10:00 watermark and the 10:10 run's exit code.
    const firing = ({ slotIso, outcome }: { slotIso: string; outcome: RecipeSlotOutcome }): RecipeSlotAttempt => ({
      attempt: 1,
      holder: "automation run-due",
      holderPid: null,
      holderToken: "token",
      leaseExpiresIso: "2026-09-16T11:00:00.000Z",
      outcome,
      recipeId: "vulnfix-digest-acme-admin",
      runStartedAtIso: slotIso,
      schemaVersion: 1,
      slotIso,
      startedAtIso: slotIso,
    });
    const worked = { exitCode: 3, kind: "succeeded", settledAtIso: "2026-09-16T10:10:00.000Z" } as const;
    const attempts = [
      firing({
        outcome: {
          detail: "lease expired",
          kind: "dead",
          reason: "HOLDER_GONE",
          settledAtIso: "2026-09-16T10:05:00.000Z",
        },
        slotIso: "2026-09-16T10:00:00.000Z",
      }),
      firing({ outcome: worked, slotIso: "2026-09-16T09:00:00.000Z" }),
    ];
    const run = { exitCode: 3, lastRunAtIso: worked.settledAtIso, watermarkIso: "2026-09-16T10:00:00.000Z" };
    const stamped = stampedOutcomeOf({ attempts, run });

    expect([
      stamped,
      stampedOutcomeOf({ attempts: attempts.slice(0, 1), run }),
      silentRows({
        candidates: [digest({ over: { firingsSinceWatermark: 2, lastExitCode: 3, lastRunSlotOutcome: stamped } })],
        nowIso: NOW,
      })[0]!.reason,
    ]).toEqual([worked, null, "MISSED"]);
  });

  it("joins the run stamp to the firing whose exit code it carries when two settled in the same millisecond", () => {
    const at = "2026-09-16T10:10:00.000Z";
    const firing = ({ slotIso, outcome }: { slotIso: string; outcome: RecipeSlotOutcome }): RecipeSlotAttempt => ({
      attempt: 1,
      holder: "automation run-due",
      holderPid: null,
      holderToken: "token",
      leaseExpiresIso: "2026-09-16T11:00:00.000Z",
      outcome,
      recipeId: "vulnfix-digest-acme-admin",
      runStartedAtIso: slotIso,
      schemaVersion: 1,
      slotIso,
      startedAtIso: slotIso,
    });
    const failed = { detail: "boom", exitCode: 1, kind: "failed", retryNotBeforeIso: at, settledAtIso: at } as const;
    const worked = { exitCode: 3, kind: "succeeded", settledAtIso: at } as const;
    const attempts = [
      firing({ outcome: failed, slotIso: "2026-09-16T10:00:00.000Z" }),
      firing({ outcome: worked, slotIso: "2026-09-16T09:00:00.000Z" }),
    ];

    expect([
      stampedOutcomeOf({ attempts, run: { exitCode: 3, lastRunAtIso: at, watermarkIso: "2026-09-16T10:00:00.000Z" } }),
      stampedOutcomeOf({ attempts, run: { exitCode: 1, lastRunAtIso: at, watermarkIso: "2026-09-16T10:00:00.000Z" } }),
    ]).toEqual([worked, failed]);
  });

  it("reports an UNSCHEDULABLE row although its cadence produced no firings to count", () => {
    const rows = silentRows({
      candidates: [digest({ over: { cadence: "not a cron expression", firingsSinceWatermark: 0 } })],
      nowIso: NOW,
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.reason).toBe("UNSCHEDULABLE");
    expect(rows[0]!.missedSlots).toBe(0);
    expect(rows[0]!.detail).toContain("never will be");
  });

  it("prefers the deferral's own reason over a stale zero exit code from the last run that did happen", () => {
    const rows = silentRows({
      candidates: [
        digest({
          over: {
            currentSlotOutcome: { detail: "waiting on the batch", kind: "deferred", settledAtIso: NOW },
            firingsSinceWatermark: 2,
            lastExitCode: 0,
          },
        }),
      ],
      nowIso: NOW,
    });

    expect(rows[0]!.reason).toBe("DEFERRED");
  });

  it("does not read a SUCCEEDED slot row as a reason — that firing ran", () => {
    const rows = silentRows({
      candidates: [
        digest({
          over: {
            currentSlotOutcome: { exitCode: 0, kind: "succeeded", settledAtIso: NOW },
            firingsSinceWatermark: 2,
          },
        }),
      ],
      nowIso: NOW,
    });

    expect(rows[0]!.reason).toBe("MISSED");
  });

  it("orders worst first, ties broken by recipe id so two reads of one world agree", () => {
    const rows = silentRows({
      candidates: [
        digest({ over: { firingsSinceWatermark: 2, recipeId: "b-row" } }),
        digest({ over: { firingsSinceWatermark: 6, recipeId: "z-row" } }),
        digest({ over: { firingsSinceWatermark: 2, recipeId: "a-row" } }),
      ],
      nowIso: NOW,
    });

    expect(rows.map((row) => row.recipeId)).toEqual(["z-row", "a-row", "b-row"]);
  });

  it("carries a row's steer through untouched, on a missed row and on an unschedulable one", () => {
    const rows = silentRows({
      candidates: [
        digest({ over: { firingsSinceWatermark: 3, steerId: "resync-restart" } }),
        digest({
          over: {
            cadence: "not a cron expression",
            firingsSinceWatermark: 0,
            recipeId: "b",
            steerId: "resync-restart",
          },
        }),
      ],
      nowIso: NOW,
    });

    expect(rows.map((row) => [row.recipeId, row.steerId])).toEqual([
      ["vulnfix-digest-acme-admin", "resync-restart"],
      ["b", "resync-restart"],
    ]);
  });

  it("leaves the steer ABSENT on a row no steer covers, rather than present and undefined", () => {
    const [row] = silentRows({ candidates: [digest({ over: { firingsSinceWatermark: 3 } })], nowIso: NOW });

    expect(Object.keys(row!).includes("steerId")).toBe(false);
  });

  it("still reports a row whose current firing a seat holds, carrying the holder and changing neither count nor reason", () => {
    const hold = { holder: "automations-seat-40cae177", startedAtIso: "2026-09-18T07:13:20.286Z" };
    const rows = silentRows({
      candidates: [digest({ over: { currentSlotHold: hold, firingsSinceWatermark: 2 } })],
      nowIso: NOW,
    });

    expect(rows.map((row) => [row.missedSlots, row.reason, row.currentSlotHold])).toEqual([[1, "MISSED", hold]]);
  });

  it("answers empty on an installation with no scheduled rows at all", () => {
    expect(silentRows({ candidates: [], nowIso: NOW })).toEqual([]);
  });
});
