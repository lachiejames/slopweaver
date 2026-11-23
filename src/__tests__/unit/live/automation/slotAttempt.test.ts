import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import {
  coolingWhy,
  judgeSlotAttempt,
  MAX_ATTEMPTS_PER_SLOT,
  openSlotAttempt,
  RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
  type RecipeSlotAttempt,
  retryAfterUnknownIsSafe,
  retryFloorMs,
  settleableAttempt,
  slotIsRetired,
} from "../../../../live/automation/slotAttempt.js";
import { RecipeSlotAttemptErrors } from "../../../../live/automation/slotAttemptErrors.js";

const SLOT = "2026-09-16T12:00:00.000Z";
const LEASE = "2026-09-17T12:00:00.000Z";

const open = (over: Partial<RecipeSlotAttempt> = {}): RecipeSlotAttempt => ({
  ...openSlotAttempt({
    attempt: 1,
    holder: "recipe run-due",
    holderPid: null,
    holderToken: "tok-1",
    leaseExpiresIso: LEASE,
    nowIso: SLOT,
    recipeId: "growth-ops",
    slotIso: SLOT,
  }),
  ...over,
});

describe("judgeSlotAttempt", () => {
  it("calls a firing nothing has ever attempted OPEN, at attempt 1", () => {
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:05:00.000Z", stored: null });
    expect(verdict.kind).toBe("open");
    expect(verdict).toEqual({ attempt: 1, kind: "open" });
  });

  it("calls a DEFERRED attempt OPEN again, at the SAME attempt number — a deferral spends nothing", () => {
    const stored = open({
      attempt: 2,
      outcome: { detail: "waiting on the batch", kind: "deferred", settledAtIso: SLOT },
    });
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:05:00.000Z", stored });

    expect(verdict).toEqual({ attempt: 2, kind: "open" });
  });

  it("calls a deferred attempt open even past its lease — an expired lease on a settled row is nothing", () => {
    const stored = open({ outcome: { detail: "waiting on the batch", kind: "deferred", settledAtIso: SLOT } });
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-20T00:00:00.000Z", stored });

    expect(verdict).toEqual({ attempt: 1, kind: "open" });
  });

  it("calls an attempt inside its lease HELD, naming the holder and the expiry", () => {
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:05:00.000Z", stored: open() });
    expect(verdict).toEqual({
      attempt: 1,
      holder: "recipe run-due",
      kind: "held",
      leaseExpiresIso: LEASE,
    });
  });

  it("calls an attempt past its lease with no outcome ABANDONED, not open", () => {
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-18T00:00:00.000Z", stored: open() });
    expect(verdict).toEqual({
      abandonment: { kind: "lease-expired" },
      attempt: 1,
      holder: "recipe run-due",
      holderToken: "tok-1",
      kind: "abandoned",
      ran: false,
    });
  });

  it("calls an attempt whose holder process is GONE abandoned inside its lease, naming the pid", () => {
    const verdict = judgeSlotAttempt({
      holderAlive: false,
      nowIso: "2026-09-16T12:05:00.000Z",
      stored: open({ attempt: 2, holderPid: 4242 }),
    });
    expect(verdict).toEqual({
      abandonment: { holderPid: 4242, kind: "holder-gone" },
      attempt: 2,
      holder: "recipe run-due",
      holderToken: "tok-1",
      kind: "abandoned",
      ran: true,
    });
  });

  it("keeps an attempt whose holder process is ALIVE held inside its lease", () => {
    const verdict = judgeSlotAttempt({
      holderAlive: true,
      nowIso: "2026-09-16T12:05:00.000Z",
      stored: open({ holderPid: 4242 }),
    });
    expect(verdict).toEqual({ attempt: 1, holder: "recipe run-due", kind: "held", leaseExpiresIso: LEASE });
  });

  it("calls a live holder past its lease abandoned for the LEASE, not for the process", () => {
    const verdict = judgeSlotAttempt({
      holderAlive: true,
      nowIso: "2026-09-18T00:00:00.000Z",
      stored: open({ holderPid: 4242 }),
    });
    expect(verdict).toEqual({
      abandonment: { kind: "lease-expired" },
      attempt: 1,
      holder: "recipe run-due",
      holderToken: "tok-1",
      kind: "abandoned",
      ran: true,
    });
  });

  it("calls an abandoned attempt RAN when its seated run started, though no pid was ever recorded", () => {
    const verdict = judgeSlotAttempt({
      holderAlive: null,
      nowIso: "2026-09-18T00:00:00.000Z",
      stored: open({ runStartedAtIso: "2026-09-16T12:01:00.000Z" }),
    });
    expect(verdict).toMatchObject({ abandonment: { kind: "lease-expired" }, kind: "abandoned", ran: true });
  });

  it("never abandons a PID-less attempt early, whatever reading it is handed", () => {
    const verdict = judgeSlotAttempt({ holderAlive: false, nowIso: "2026-09-16T12:05:00.000Z", stored: open() });
    expect(verdict).toEqual({ attempt: 1, holder: "recipe run-due", kind: "held", leaseExpiresIso: LEASE });
  });

  it("ignores a dead holder on a SETTLED attempt — the reading only matters while nothing has settled", () => {
    const stored = open({
      holderPid: 4242,
      outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:01:00.000Z" },
    });
    const verdict = judgeSlotAttempt({ holderAlive: false, nowIso: "2026-09-16T12:05:00.000Z", stored });
    expect(verdict).toEqual({ kind: "settled", outcome: stored.outcome! });
  });

  it("reads an unparseable lease as expired, so a corrupt row releases the firing", () => {
    const verdict = judgeSlotAttempt({
      holderAlive: null,
      nowIso: "2026-09-16T12:05:00.000Z",
      stored: open({ leaseExpiresIso: "not an instant" }),
    });
    expect(verdict.kind).toBe("abandoned");
  });

  it("calls a SUCCEEDED firing settled", () => {
    const stored = open({
      outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-16T12:01:00.000Z" },
    });
    const verdict = judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:05:00.000Z", stored });
    expect(verdict).toEqual({ kind: "settled", outcome: stored.outcome! });
  });

  it("calls a DEAD firing settled", () => {
    const stored = open({
      outcome: {
        detail: "three attempts, all exit 1",
        kind: "dead",
        reason: "ATTEMPTS_EXHAUSTED",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
    });
    expect(judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:05:00.000Z", stored }).kind).toBe("settled");
  });

  it("calls a failed attempt COOLING before its floor, carrying when and why it failed", () => {
    const stored = open({
      outcome: {
        detail: "exit 1",
        exitCode: 1,
        kind: "failed",
        retryNotBeforeIso: "2026-09-16T18:00:00.000Z",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
    });
    expect(judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T13:00:00.000Z", stored })).toEqual({
      attempt: 1,
      failedAtIso: "2026-09-16T12:01:00.000Z",
      kind: "cooling",
      previousDetail: "exit 1",
      retryNotBeforeIso: "2026-09-16T18:00:00.000Z",
    });
  });

  it("calls a failed attempt RETRY once its floor has passed, at the next attempt number", () => {
    const stored = open({
      outcome: {
        detail: "exit 1",
        exitCode: 1,
        kind: "failed",
        retryNotBeforeIso: "2026-09-16T18:00:00.000Z",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
    });
    expect(judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T18:00:01.000Z", stored })).toEqual({
      attempt: 2,
      kind: "retry",
      previousDetail: "exit 1",
    });
  });

  it("reads an unparseable floor as PASSED rather than blocking the firing forever", () => {
    const stored = open({
      outcome: {
        detail: "exit 1",
        exitCode: 1,
        kind: "failed",
        retryNotBeforeIso: "not an instant",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
    });
    expect(judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-16T12:02:00.000Z", stored }).kind).toBe("retry");
  });

  it("calls the last permitted attempt EXHAUSTED rather than retrying it a fourth time", () => {
    const stored = open({
      attempt: MAX_ATTEMPTS_PER_SLOT,
      outcome: {
        detail: "exit 1 again",
        exitCode: 1,
        kind: "failed",
        retryNotBeforeIso: "2026-09-16T12:02:00.000Z",
        settledAtIso: "2026-09-16T12:01:00.000Z",
      },
    });
    expect(judgeSlotAttempt({ holderAlive: null, nowIso: "2026-09-17T00:00:00.000Z", stored })).toEqual({
      attempt: MAX_ATTEMPTS_PER_SLOT,
      holderToken: "tok-1",
      kind: "exhausted",
      previousDetail: "exit 1 again",
    });
  });
});

describe("coolingWhy", () => {
  it("names when the attempt failed and what it recorded, so a replay hours later is not read as fresh", () => {
    const why = coolingWhy({
      verdict: {
        attempt: 1,
        failedAtIso: "2026-09-28T21:58:43.084Z",
        kind: "cooling",
        previousDetail: "recipe store-backup-daily · ran · slopweaver store backup · exit 1",
        retryNotBeforeIso: "2026-09-29T03:58:43.084Z",
      },
    });
    expect(why).toBe(
      "COOLING · attempt 1 failed at 2026-09-28T21:58:43.084Z " +
        "(recipe store-backup-daily · ran · slopweaver store backup · exit 1); " +
        "the next may start at 2026-09-29T03:58:43.084Z",
    );
  });
});

describe("retryFloorMs", () => {
  it("doubles the wait with each attempt, as a fraction of the row's own period", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    expect(retryFloorMs({ attempt: 1, periodMs: dayMs })).toBe(dayMs / 4);
    expect(retryFloorMs({ attempt: 2, periodMs: dayMs })).toBe(dayMs / 2);
  });

  it("keeps every attempt of one firing inside that firing's own period", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const total = retryFloorMs({ attempt: 1, periodMs: dayMs }) + retryFloorMs({ attempt: 2, periodMs: dayMs });
    expect(total).toBe(dayMs * 0.75);
  });

  it("never asks for a negative wait on an attempt past the cap", () => {
    expect(retryFloorMs({ attempt: 99, periodMs: 4000 })).toBe(2000);
  });
});

describe("retryAfterUnknownIsSafe", () => {
  it("retries a read-only run freely", () => {
    expect(retryAfterUnknownIsSafe({ destinationTakesKey: false, writes: false })).toBe(true);
  });

  it("retries a write whose destination takes the firing's key", () => {
    expect(retryAfterUnknownIsSafe({ destinationTakesKey: true, writes: true })).toBe(true);
  });

  it("refuses to retry a write whose destination can prove nothing", () => {
    expect(retryAfterUnknownIsSafe({ destinationTakesKey: false, writes: true })).toBe(false);
  });
});

describe("slotIsRetired", () => {
  it("retires a success, so the watermark moves past the firing", () => {
    expect(slotIsRetired({ outcome: { exitCode: 0, kind: "succeeded", settledAtIso: SLOT } })).toBe(true);
  });

  it("retires a death, so a firing nobody can finish stops holding the schedule", () => {
    expect(
      slotIsRetired({
        outcome: { detail: "gave up", kind: "dead", reason: "OUTCOME_UNKNOWN", settledAtIso: SLOT },
      }),
    ).toBe(true);
  });

  it("does NOT retire a failure — leaving the watermark is the whole of the retry", () => {
    expect(
      slotIsRetired({
        outcome: { detail: "exit 1", exitCode: 1, kind: "failed", retryNotBeforeIso: SLOT, settledAtIso: SLOT },
      }),
    ).toBe(false);
  });

  it("does NOT retire a DEFERRAL — nothing ran, so stamping it would silence the row until tomorrow", () => {
    expect(slotIsRetired({ outcome: { detail: "waiting on the batch", kind: "deferred", settledAtIso: SLOT } })).toBe(
      false,
    );
  });
});

describe("settleableAttempt", () => {
  it("hands back the row when the token matches", () => {
    const stored = open();
    const settled = settleableAttempt({ holderToken: "tok-1", recipeId: "growth-ops", slotIso: SLOT, stored });
    expect(settled.isOk()).toBe(true);
    expect(unwrap(settled).attempt).toBe(1);
  });

  it("refuses a token that is not the one the attempt was taken under", () => {
    const settled = settleableAttempt({
      holderToken: "tok-2",
      recipeId: "growth-ops",
      slotIso: SLOT,
      stored: open(),
    });
    expect(settled.isErr()).toBe(true);
    expect(settled._unsafeUnwrapErr().code).toBe("SLOT_TOKEN_MISMATCH");
  });

  it("refuses a firing nothing holds, so nothing can advance the schedule on its own say-so", () => {
    const settled = settleableAttempt({
      holderToken: "tok-1",
      recipeId: "growth-ops",
      slotIso: SLOT,
      stored: null,
    });
    expect(settled.isErr()).toBe(true);
    expect(settled._unsafeUnwrapErr().code).toBe("SLOT_NOT_HELD");
  });
});

describe("openSlotAttempt", () => {
  it("opens a row with no outcome, carrying the schema version a reader accepts", () => {
    expect(open()).toEqual({
      attempt: 1,
      holder: "recipe run-due",
      holderPid: null,
      holderToken: "tok-1",
      leaseExpiresIso: LEASE,
      outcome: null,
      recipeId: "growth-ops",
      runStartedAtIso: null,
      schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
      slotIso: SLOT,
      startedAtIso: SLOT,
    });
  });
});

describe("RecipeSlotAttemptErrors", () => {
  it("names the firing and the holder on a token mismatch, so a reader can go and look", () => {
    const error = RecipeSlotAttemptErrors.tokenMismatch({
      holder: "seat-abc",
      recipeId: "growth-ops",
      slotIso: SLOT,
    });
    expect(error.code).toBe("SLOT_TOKEN_MISMATCH");
    expect(error.message).toContain("growth-ops");
    expect(error.message).toContain(SLOT);
    expect(error.message).toContain("seat-abc");
  });

  it("says an unreadable row refuses rather than being read as never attempted", () => {
    const error = RecipeSlotAttemptErrors.unreadable({
      reason: "not JSON",
      recipeId: "growth-ops",
      slotIso: SLOT,
    });
    expect(error.code).toBe("SLOT_UNREADABLE");
    expect(error.message).toContain("a second time");
  });
});
