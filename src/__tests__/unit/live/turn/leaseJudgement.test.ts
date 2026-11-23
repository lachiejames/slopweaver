import { describe, expect, it } from "vitest";

import { leaseState, MAX_REVIEW_HOLD_HOURS, type ReviewPosture } from "../../../../live/turn/leaseJudgement.js";

/** The lease from the measured incident: dispatched, then expiring two hours later. */
const EXPIRES = "2026-09-03T08:30:25.000Z";
/** The instant that ask actually went terminal, two minutes inside its own lease. */
const AT_08_28 = "2026-09-03T08:28:09.209Z";
/** Well past it. */
const AT_09_25 = "2026-09-03T09:25:33.736Z";

const NOTHING: ReviewPosture = { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined };

describe("leaseState", () => {
  it("is active inside the lease with no review running", () => {
    expect(leaseState({ leaseExpiresAt: EXPIRES, nowIso: AT_08_28, review: NOTHING })).toEqual({ kind: "active" });
  });

  it("expires past the lease with no review running, so the bound still exists", () => {
    expect(leaseState({ leaseExpiresAt: EXPIRES, nowIso: AT_09_25, review: NOTHING })).toEqual({ kind: "expired" });
  });

  it("never discards an answer a reviewer has already passed, however late the clock is", () => {
    const state = leaseState({
      leaseExpiresAt: EXPIRES,
      nowIso: AT_09_25,
      review: { hasUsableVerdict: true, inFlight: false, recordOpen: true, spawnedAt: "2026-09-03T08:10:00.000Z" },
    });

    expect(state).toEqual({
      because: "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
      kind: "held",
      outranksScreenTruth: true,
    });
  });

  it("holds the clock while an independent reviewer is mid-verdict — the measured incident", () => {
    const state = leaseState({
      leaseExpiresAt: EXPIRES,
      nowIso: AT_09_25,
      review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "2026-09-03T08:13:40.961Z" },
    });

    expect(state).toEqual({
      because: "an independent reviewer is mid-verdict, and its time is not the worker's to pay for",
      kind: "held",
      outranksScreenTruth: false,
    });
  });

  it("holds the clock BETWEEN rounds — a round returned, the review is not released, the fix loop is running", () => {
    // The window this branch exists for: the current round's verdict is on disk, so `inFlight`
    // is false and a `broken` verdict is not usable, yet `releasedAt` has not been stamped.
    const state = leaseState({
      leaseExpiresAt: EXPIRES,
      nowIso: AT_09_25,
      review: { hasUsableVerdict: false, inFlight: false, recordOpen: true, spawnedAt: "2026-09-03T08:13:40.961Z" },
    });

    expect(state).toEqual({
      because:
        "a review round has returned but the review is not released — the worker is inside the fix-and-re-review loop a broken verdict opens",
      kind: "held",
      outranksScreenTruth: false,
    });
  });

  it("lets the clock resume once an open ROUND has held it past the same cap", () => {
    const spawnedAt = "2026-09-03T08:13:40.961Z";
    const wellPast = new Date(Date.parse(spawnedAt) + (MAX_REVIEW_HOLD_HOURS + 1) * 60 * 60 * 1000).toISOString();

    expect(
      leaseState({
        leaseExpiresAt: EXPIRES,
        nowIso: wellPast,
        review: { hasUsableVerdict: false, inFlight: false, recordOpen: true, spawnedAt },
      }),
    ).toEqual({ kind: "expired" });
  });

  it("hands the clock straight back once the review is RELEASED, whatever its last verdict said", () => {
    expect(
      leaseState({
        leaseExpiresAt: EXPIRES,
        nowIso: AT_09_25,
        review: {
          hasUsableVerdict: false,
          inFlight: false,
          recordOpen: false,
          spawnedAt: "2026-09-03T08:13:40.961Z",
        },
      }),
    ).toEqual({ kind: "expired" });
  });

  it("lets the clock resume once a reviewer has held it past the cap, so the hold is not a second lease", () => {
    const spawnedAt = "2026-09-03T08:13:40.961Z";
    const wellPast = new Date(Date.parse(spawnedAt) + (MAX_REVIEW_HOLD_HOURS + 1) * 60 * 60 * 1000).toISOString();

    expect(
      leaseState({
        leaseExpiresAt: EXPIRES,
        nowIso: wellPast,
        review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt },
      }),
    ).toEqual({
      kind: "expired",
    });
  });

  it("grants no hold when the reviewer's spawn instant is unparseable, so a corrupt clock buys no time", () => {
    expect(
      leaseState({
        leaseExpiresAt: EXPIRES,
        nowIso: AT_09_25,
        review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "not an instant" },
      }),
    ).toEqual({ kind: "expired" });
  });

  it("grants no hold when a reviewer is running but recorded no spawn instant at all", () => {
    expect(
      leaseState({
        leaseExpiresAt: EXPIRES,
        nowIso: AT_09_25,
        review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: undefined },
      }),
    ).toEqual({ kind: "expired" });
  });

  it("still expires an unparseable lease, keeping isLeaseExpired's fail-closed direction", () => {
    expect(leaseState({ leaseExpiresAt: "08:30 on the third", nowIso: AT_08_28, review: NOTHING })).toEqual({
      kind: "expired",
    });
  });
});
