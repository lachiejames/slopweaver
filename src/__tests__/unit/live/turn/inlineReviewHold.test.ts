/**
 * inlineReviewHold — the thirty-minute undispatched bound may not end a turn whose reviewer is open.
 *
 * The instants below are the real ones from the incident the module's header measures: the ask
 * was carded 01:13:12.738Z, its round-1 reviewer spawned 01:26:36.637Z, and the sweep finalised the card as
 * never-dispatched at 01:46:28.759Z while that reviewer was still mid-verdict.
 */
import { describe, expect, it } from "vitest";

import { inlineReviewHold } from "../../../../live/turn/inlineReviewHold.js";
import { MAX_REVIEW_HOLD_HOURS } from "../../../../live/turn/leaseJudgement.js";

/** The reviewer's own spawn instant, from the archived round-1 verdict's filename. */
const SPAWNED_AT = "2026-09-16T01:26:36.637Z";
/** The instant the sweep actually wrote `dispatch-failed` over this turn. */
const FINALISED_AT = "2026-09-16T01:46:28.759Z";

/** A reviewer that is open and has written nothing yet — the posture at {@link FINALISED_AT}. */
const MID_VERDICT = { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: SPAWNED_AT } as const;

/** The same reviewer once its round has RETURNED and the record has not been released. */
const ROUND_RETURNED = { hasUsableVerdict: false, inFlight: false, recordOpen: true, spawnedAt: SPAWNED_AT } as const;

describe("inlineReviewHold", () => {
  it("holds the bound open while an independent reviewer is mid-verdict", () => {
    const hold = inlineReviewHold({ nowIso: FINALISED_AT, review: MID_VERDICT });
    expect(hold!.because).toBe("an independent reviewer is mid-verdict, and its time is not the worker's to pay for");
    expect(hold!.spawnedAt).toBe(SPAWNED_AT);
  });

  it("holds it open for a clean verdict bound to the answer in hand, whatever the reviewer is doing", () => {
    const hold = inlineReviewHold({
      nowIso: FINALISED_AT,
      review: { hasUsableVerdict: true, inFlight: false, recordOpen: true, spawnedAt: SPAWNED_AT },
    });
    expect(hold!.because).toBe(
      "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
    );
  });

  it("holds the bound open BETWEEN rounds — a verdict has landed and the record is not released", () => {
    const hold = inlineReviewHold({ nowIso: FINALISED_AT, review: ROUND_RETURNED });
    expect(hold!.because).toBe(
      "a review round has returned but the review is not released — the worker is inside the fix-and-re-review loop a broken verdict opens",
    );
    expect(hold!.spawnedAt).toBe(SPAWNED_AT);
  });

  it("lapses that between-rounds hold at the same cap, so it is not a second bound either", () => {
    const justPast = new Date(Date.parse(SPAWNED_AT) + MAX_REVIEW_HOLD_HOURS * 60 * 60 * 1000 + 1000).toISOString();
    expect(inlineReviewHold({ nowIso: justPast, review: ROUND_RETURNED })).toBeUndefined();
  });

  it("grants nothing when no review has ever been opened for the ask", () => {
    expect(
      inlineReviewHold({
        nowIso: FINALISED_AT,
        review: { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined },
      }),
    ).toBeUndefined();
  });

  it("grants nothing once the reviewer has been released — a finished review is the bound's to end", () => {
    expect(
      inlineReviewHold({
        nowIso: FINALISED_AT,
        review: { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: SPAWNED_AT },
      }),
    ).toBeUndefined();
  });

  it("lapses at the cap, so a wedged reviewer cannot postpone the bound forever", () => {
    const spawned = Date.parse(SPAWNED_AT);
    const justInside = new Date(spawned + MAX_REVIEW_HOLD_HOURS * 60 * 60 * 1000 - 1000).toISOString();
    const justPast = new Date(spawned + MAX_REVIEW_HOLD_HOURS * 60 * 60 * 1000 + 1000).toISOString();
    expect(inlineReviewHold({ nowIso: justInside, review: MID_VERDICT })).toBeDefined();
    expect(inlineReviewHold({ nowIso: justPast, review: MID_VERDICT })).toBeUndefined();
  });

  it("fails CLOSED on a reviewer record that states no spawn instant — a corrupt file buys no time", () => {
    expect(
      inlineReviewHold({
        nowIso: FINALISED_AT,
        review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: undefined },
      }),
    ).toBeUndefined();
  });

  it("fails CLOSED on an unparseable spawn instant for the same reason", () => {
    expect(
      inlineReviewHold({
        nowIso: FINALISED_AT,
        review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "not-an-instant" },
      }),
    ).toBeUndefined();
  });

  it("still holds for a usable verdict whose spawn instant is unreadable — the cap guards only the reviewer", () => {
    // The usable-verdict arm is the one `MAX_REVIEW_HOLD_HOURS` deliberately does not bound, exactly as in
    // `leaseJudgement.ts`: there is no reviewer left to wedge, only an answer waiting to be posted.
    const hold = inlineReviewHold({
      nowIso: "2030-01-01T00:00:00.000Z",
      review: { hasUsableVerdict: true, inFlight: true, recordOpen: true, spawnedAt: undefined },
    });
    expect(hold!.because).toBe(
      "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
    );
  });
});
