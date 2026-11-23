/**
 * WHETHER THE UNDISPATCHED BOUND MAY END A TURN NOBODY RECORDED A DISPATCH FOR — the judgement that stops a
 * thirty-minute proxy clock finalising a turn whose independent reviewer is still mid-verdict.
 *
 * `./leaseJudgement.ts` is the same question asked of a DISPATCHED ask, and this module is deliberately its
 * mirror rather than a second design: same two reasons, same cap, same fail-closed direction. What differs
 * is only which clock is being held — a lease there, `./dispatch.ts`'s
 * `UNDISPATCHED_ABANDON_AFTER_MINUTES` (`./undispatchedSweep.ts`) here.
 *
 * ## The measured failure this exists for
 *
 * Ask `C0SYN000001/1789521183.332199`, captured and carded nine seconds apart. Its whole
 * lifecycle then went quiet: no `dispatched` row was ever written for it, because the loop session composed
 * the answer ITSELF and opened the review straight off the brief and decision files —
 * `turn review --brief <file> --decision <file> --answer <file>`, which never asks whether a dispatch was
 * recorded. So `activeDispatch` stayed `undefined` for the turn's whole life, every lap printed
 * `UNROUTED — ROUTE IT NOW` at a turn a session was actively working, and 33 minutes after the card the sweep wrote
 * `dispatch-failed` and finalised the card as never-dispatched. Round 1 of its review was open at that
 * moment — reviewer spawned 01:26:36.637Z, no verdict written until roughly three minutes after the sweep's write — and the answer
 * posted fifteen minutes after the card said nobody was coming. Reproduce it over any live home with:
 *
 * ```
 * jq -r 'select(.messageTs=="1789521183.332199") | "\(.tsIso) \(.kind)"' "$SLOPWEAVER_HOME/live/slack/asks.jsonl"
 * ```
 *
 * ## The half this does NOT close, and where it lives instead
 *
 * An inline turn is invisible to the sweep from `checklist-posted` until its review OPENS — thirteen minutes
 * on the ask above — because until then nothing on disk says a session is inside it. The `unrouted` notice
 * firing in that window is not wrong so much as uninformed, and it settles nothing. The root cause is that
 * `../../cli/commands/turn/dispatchInitial.ts`'s `handleInline` is what journals an `inline` dispatch and nothing
 * makes `turn review`'s inline door require that it ran; closing THAT is a new refusal on the bot's own
 * answer path and belongs to its own row, not to this one.
 *
 * A second consequence, stated here because this is where a reader will be standing: `../ask/burst.ts`'s
 * `activeAsks` excludes an ask past the undispatched bound from the ACTIVE list, so an inline turn held open
 * by this module past thirty minutes is live work that `activeAsks` still calls dead, and a burst follow-up
 * could be promoted over it. That function is pure over lifecycle events with no home to read a posture
 * from, so giving it one is a separate change with its own blast radius.
 */
import type { ReviewPosture } from "./leaseJudgement.js";
import { withinReviewHold } from "./leaseJudgement.js";

/** Why the sweep may not call an undispatched turn over — the reason, in words a sweep line can print. */
export interface InlineReviewHold {
  readonly because: string;
  /** When the reviewer holding this turn open was spawned, so a line can say how long it has been. */
  readonly spawnedAt: string | undefined;
}

/**
 * Whether a review holds the undispatched bound open for one ask with NO recorded dispatch. Pure — the clock
 * is injected, never read.
 *
 * Ordered exactly as `./leaseJudgement.ts`'s `leaseState` is, and for the same reason: a verified answer
 * outranks everything, then a reviewer mid-verdict inside its cap, then a review ROUND returned with the
 * record still open inside the same cap. A RELEASED reviewer grants no hold, and neither does a corrupt
 * spawn instant. A `broken` verdict on its own does not end the review — the review ends when it is
 * released — so the third branch is what stops this bound finalising a turn between two rounds; see
 * `./leaseJudgement.ts`'s header for the measurement.
 *
 * There is no screen truth on this side, so `LeaseState`'s `outranksScreenTruth` has no mirror here: an
 * undispatched ask has no workspace for a `phantom` reading to be taken of.
 *
 * The cap is `./leaseJudgement.ts`'s own `MAX_REVIEW_HOLD_HOURS`, not a second number. The bound this holds
 * open is not a budget for the work — it is a bound on how long a card may stand with nothing journalled
 * behind it — and a review in flight IS something behind it, so an inline turn's reviewer earns exactly the
 * protection a dispatched turn's already has.
 *
 * @param nowIso the instant the hold is judged against
 * @param review what this ask's review looks like right now, as `../../cli/commands/turn/dispatchSweep.ts`'s
 *   `reviewPostureOf` reads it off disk
 * @returns the hold and the reason to print, or `undefined` when nothing about the review stops the bound
 */
export function inlineReviewHold({
  nowIso,
  review,
}: {
  nowIso: string;
  review: ReviewPosture;
}): InlineReviewHold | undefined {
  if (review.hasUsableVerdict) {
    return {
      because: "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
      spawnedAt: review.spawnedAt,
    };
  }
  const insideCap = withinReviewHold({ nowIso, spawnedAt: review.spawnedAt });
  if (review.inFlight && insideCap) {
    return {
      because: "an independent reviewer is mid-verdict, and its time is not the worker's to pay for",
      spawnedAt: review.spawnedAt,
    };
  }
  if (review.recordOpen && insideCap) {
    return {
      because:
        "a review round has returned but the review is not released — the worker is inside the fix-and-re-review loop a broken verdict opens",
      spawnedAt: review.spawnedAt,
    };
  }
  return undefined;
}
