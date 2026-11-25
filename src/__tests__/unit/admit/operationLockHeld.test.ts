/**
 * The held-holder judgement on its own: which record is stale, and which refusal is contention a rerun waits
 * out rather than one no rerun clears. The first holder is THIS process, which the liveness check answers for
 * without a signal to anyone else; the guarded holder a sandboxed verb records is judged through a plain fake
 * process table, so a dead, recycled or unreadable guardian is a fixture rather than a process.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_STALE_AFTER_MS, heldReason, type LockContents } from "../../../admit/operationLockHeld.js";
import type { ProcessStart, StartOf } from "../../../talk/relayLease.js";

const LIVE = { acquiredAtIso: "2026-08-11T00:00:00Z", pid: process.pid, start: undefined };

describe("heldReason", () => {
  it("answers stale for a record aged past its threshold, whoever holds it", () => {
    expect(heldReason({ existing: LIVE, nowIso: "2026-08-11T00:20:00Z", staleAfterMs: DEFAULT_STALE_AFTER_MS })).toBe(
      undefined,
    );
  });

  it("types a live holder within its threshold as contention", () => {
    const reason = heldReason({ existing: LIVE, nowIso: "2026-08-11T00:00:05Z", staleAfterMs: DEFAULT_STALE_AFTER_MS });
    expect(reason!.code).toBe("LOCK_CONTENDED");
    expect(reason!.message).toContain("it was ALIVE when checked at 2026-08-11T00:00:05Z");
  });

  it("types an age it could not compare as a refusal, naming the unreadable instant", () => {
    const reason = heldReason({ existing: LIVE, nowIso: "not-an-instant", staleAfterMs: DEFAULT_STALE_AFTER_MS });
    expect(reason!.code).toBe("LOCK_REFUSED");
    expect(reason!.message).toContain("the instant of this attempt, not-an-instant, is not a readable instant");
  });
});

/** The holder a sandboxed verb records: its pid, no start stamp of its own, and the worker that vouches for it. */
const HOLDER_PID = 4242;
const GUARDIAN_PID = 5151;
const GUARDIAN_START = "Wed Nov  5 09:01:02 2026";
const ACQUIRED = "2026-11-25T00:00:00Z";
/** Two hours on: far past the ordinary fifteen-minute window an unidentified record ages out on. */
const LATER = "2026-11-25T02:00:00Z";
const GUARDED: LockContents = {
  acquiredAtIso: ACQUIRED,
  guardian: { pid: GUARDIAN_PID, start: GUARDIAN_START },
  pid: HOLDER_PID,
  start: undefined,
};

const GONE: ProcessStart = { running: false, start: undefined };

/**
 * The contention a live guarded holder reads while its guardian still vouches, written out in full.
 *
 * @returns the exact message
 */
function vouchedMessage({ ageMs, nowIso }: { ageMs: number; nowIso: string }): string {
  return `held by pid 4242 since ${ACQUIRED} (${String(ageMs)}ms old, under a lease declared never to go stale while its holder lives, and the holder answered signal 0, and its guardian, pid 5151 recorded as started ${GUARDIAN_START}, still vouched for it — it was ALIVE when checked at ${nowIso}, so this is contention rather than a lock left behind by a dead process; wait for the holder to finish)`;
}

/**
 * The refusal a live guarded holder reads once its guardian no longer vouches, written out in full.
 *
 * @returns the exact message
 */
function unvouchedMessage({ ageMs, nowIso }: { ageMs: number; nowIso: string }): string {
  return `held by pid 4242 since ${ACQUIRED} (${String(ageMs)}ms old, under a lease declared never to go stale while its holder lives), and the holder answered signal 0 at ${nowIso}, but it carries no start stamp of its own and its guardian, pid 5151 recorded as started ${GUARDIAN_START}, no longer vouches for it — whether pid 4242 is still the writer cannot be told, so this is refused rather than taken over; run again once pid 4242 has exited, or, if it is no slopweaver process, remove the lock record its writer left`;
}

/**
 * A process table as a plain fake: each pid listed answers its row, every other pid is gone.
 *
 * @returns the probe
 */
function table({ rows }: { rows: ReadonlyMap<number, ProcessStart> }): StartOf {
  return (candidate) => {
    const row = rows.get(candidate);
    if (row === undefined) {
      return GONE;
    }
    return row;
  };
}

/** The holder alive (unstampable), and the guardian answering with the given row. */
function holderWithGuardian({ guardian }: { guardian: ProcessStart }): StartOf {
  return table({
    rows: new Map<number, ProcessStart>([
      [HOLDER_PID, { running: true, start: undefined }],
      [GUARDIAN_PID, guardian],
    ]),
  });
}

describe("heldReason with a guardian", () => {
  it("keeps an unstamped holder's never-stale lease held past the ordinary window while its guardian is exact", () => {
    const reason = heldReason({
      existing: GUARDED,
      nowIso: LATER,
      staleAfterMs: Number.POSITIVE_INFINITY,
      startOf: holderWithGuardian({ guardian: { running: true, start: GUARDIAN_START } }),
    });
    expect(reason!.code).toBe("LOCK_CONTENDED");
    expect(reason!.message).toBe(vouchedMessage({ ageMs: 7_200_000, nowIso: LATER }));
  });

  it("answers stale for a dead holder pid, however live its guardian", () => {
    const startOf = table({
      rows: new Map<number, ProcessStart>([[GUARDIAN_PID, { running: true, start: GUARDIAN_START }]]),
    });
    expect(
      heldReason({
        existing: GUARDED,
        nowIso: "2026-11-25T00:00:05Z",
        staleAfterMs: Number.POSITIVE_INFINITY,
        startOf,
      }),
    ).toBe(undefined);
  });

  it("refuses rather than ages out a live holder's record two hours on, once its guardian is gone", () => {
    const reason = heldReason({
      existing: GUARDED,
      nowIso: LATER,
      staleAfterMs: Number.POSITIVE_INFINITY,
      startOf: holderWithGuardian({ guardian: GONE }),
    });
    expect(reason!.code).toBe("LOCK_REFUSED");
    expect(reason!.message).toBe(unvouchedMessage({ ageMs: 7_200_000, nowIso: LATER }));
  });

  it("refuses rather than ages out a live holder's record once the guardian's pid names another process", () => {
    const reason = heldReason({
      existing: GUARDED,
      nowIso: LATER,
      staleAfterMs: Number.POSITIVE_INFINITY,
      startOf: holderWithGuardian({ guardian: { running: true, start: "Thu Nov  6 10:00:00 2026" } }),
    });
    expect(reason!.code).toBe("LOCK_REFUSED");
    expect(reason!.message).toBe(unvouchedMessage({ ageMs: 7_200_000, nowIso: LATER }));
  });

  it("refuses a gone guardian's live holder inside the ordinary window too: a guardian never makes a holder dead", () => {
    const reason = heldReason({
      existing: GUARDED,
      nowIso: "2026-11-25T00:05:00Z",
      staleAfterMs: Number.POSITIVE_INFINITY,
      startOf: holderWithGuardian({ guardian: GONE }),
    });
    expect(reason!.code).toBe("LOCK_REFUSED");
    expect(reason!.message).toBe(unvouchedMessage({ ageMs: 300_000, nowIso: "2026-11-25T00:05:00Z" }));
  });

  it("answers stale for a dead holder pid whose guardian is gone too", () => {
    expect(
      heldReason({
        existing: GUARDED,
        nowIso: LATER,
        staleAfterMs: Number.POSITIVE_INFINITY,
        startOf: table({ rows: new Map<number, ProcessStart>() }),
      }),
    ).toBe(undefined);
  });

  it("still ages out a record with neither a stamp nor a guardian on the ordinary window, as before the guardian", () => {
    expect(
      heldReason({
        existing: { acquiredAtIso: ACQUIRED, pid: HOLDER_PID, start: undefined },
        nowIso: LATER,
        staleAfterMs: Number.POSITIVE_INFINITY,
        startOf: holderWithGuardian({ guardian: GONE }),
      }),
    ).toBe(undefined);
  });

  it("keeps the lease held for a reader inside the sandbox, which sees the guardian answer but cannot read its stamp", () => {
    const reason = heldReason({
      existing: GUARDED,
      nowIso: LATER,
      staleAfterMs: Number.POSITIVE_INFINITY,
      startOf: holderWithGuardian({ guardian: { running: true, start: undefined } }),
    });
    expect(reason!.code).toBe("LOCK_CONTENDED");
    expect(reason!.message).toBe(vouchedMessage({ ageMs: 7_200_000, nowIso: LATER }));
  });

  it("lets the holder's own stamp decide over its guardian: a recycled stamped holder is stale", () => {
    const startOf = table({
      rows: new Map<number, ProcessStart>([
        [HOLDER_PID, { running: true, start: "Thu Nov  6 10:00:00 2026" }],
        [GUARDIAN_PID, { running: true, start: GUARDIAN_START }],
      ]),
    });
    expect(
      heldReason({
        existing: { ...GUARDED, start: "Wed Nov  5 09:01:05 2026" },
        nowIso: "2026-11-25T00:00:05Z",
        staleAfterMs: Number.POSITIVE_INFINITY,
        startOf,
      }),
    ).toBe(undefined);
  });
});
