/**
 * WHETHER THE CLOCK MAY END A TURN — the judgement that stops a two-hour wall clock throwing away an answer
 * a reviewer has already passed.
 *
 * ## The measured failure this exists for
 *
 * The cost-monitoring ask, dispatched on a two-hour lease. Five
 * review rounds ran, each about twenty minutes. The ask went terminal just before the lease edge with the
 * reason its own lifecycle row still carries: `round 5 returned broken on the core deliverable and the lease
 * expired before a fix could be re-reviewed`. The owner had to notice and rescue it by hand; it finally
 * posted 178 minutes after the tag. Reproduce the class over any live home with:
 *
 * ```
 * jq -r 'select(.kind=="failed") | .reason' "$SLOPWEAVER_HOME/live/slack/asks.jsonl" | grep -i lease
 * ```
 *
 * The owner's ruling on the fix was exact, and both halves of it are the rule here: keep a bound, because a review
 * that runs ten thousand years is its own failure — but never forego a good answer to an artificial limit.
 *
 * ## Two changes, and the reason they are different
 *
 * **A verified answer is never discarded.** A `clean` verdict bound to the answer in hand means the work is
 * done and the only thing left is to post it. Reporting that as `lease-expired` destroys a finished answer to
 * enforce a clock, which is the failure above. So a usable verdict outranks the lease entirely — the work is
 * finished and there is nothing left to expire. A worker's own `ready` report does NOT: it means validated,
 * not reviewed, and `./dispatch.ts`'s `sweepDecision` lets it stand only while this judgement is not
 * `expired`.
 *
 * **Time inside a review does not count against the worker.** The lease exists to bound how long a session
 * may sit un-checked-on. A session waiting on an independent reviewer is not that: it is blocked on a
 * mechanism this system chose to put in its way, and charging it for the wait is what made five honest rounds
 * fatal. So a review in flight HOLDS the clock.
 *
 * **A review is over when it is RELEASED, not when a round returns.** The third reason, and the one the first
 * two left out. `./reviewPosture.ts`'s `inFlight` requires that no verdict file be present, so it flips false
 * the instant the CURRENT round's reviewer writes one — and a `broken` verdict is not usable, so both holds
 * lapsed and the wall clock decided over a worker standing in the middle of the fix-and-re-review loop that
 * `broken` exists to open. MEASURED on ask `C0SYN000006/1789952379.135579`, lease expiring
 * 04:39:27.978Z with the review record's `releasedAt` not written until 05:17:02.952Z: three
 * windows totalling 9m41s in which any sweep lap would have reported `lease-expired` over a live turn —
 * 04:39:29→04:43:00, 04:55:19→04:59:07, 05:12:31→05:14:53, each one a round's verdict landing and the next
 * round being spawned. A lap is roughly ten minutes, so surviving it was luck. Reproduce the SHAPE over any
 * live home — for each review, when each round's verdict landed against when the next round opened:
 *
 * ```
 * cd "$SLOPWEAVER_HOME/live/slack/reviews" && for d in $(ls -d -- *); do
 *   ls "$d" | grep '^verdict-superseded-' | while read -r f; do
 *     echo "$d verdict-landed $(TZ=UTC stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%SZ' "$d/$f") $f"; done
 *   echo "$d next-spawn $(jq -r .spawnedAt "$d/record.json")"
 * done
 * ```
 *
 * Over the 185 real inter-round gaps that command reports on this machine: p50 157s, p90 524s, p95 955s,
 * longest live loop 3388s — and two abandoned turns at 30591s and 111632s, which is exactly the shape the
 * cap below has to end and the hold must not.
 *
 * ## Why the hold is capped, and why the cap is not the same instrument
 *
 * An uncapped hold is not a lease. A reviewer that wedges would pause the clock forever and the ask would sit
 * un-swept with nobody watching, which is the failure the lease itself exists to prevent, reintroduced
 * through its exemption. {@link MAX_REVIEW_HOLD_HOURS} bounds it: past that, the hold lapses and the lease
 * decides again, so the worst case is bounded rather than unbounded. The open-ROUND hold takes that same cap
 * off the same `spawnedAt`, which is what makes it renew for a live loop — every round rewrites the record
 * with a fresh instant — and lapse for a dead one.
 *
 * A post-verdict grace was considered as the sharper anchor and rejected on what is actually on disk:
 * `../../admit/reviewVerdict.ts`'s `ReviewVerdict` carries no written-at instant, so the only available
 * signal is the verdict file's mtime — which no schema declares, which `../../__tests__/replayFixture.ts`
 * does not preserve, and which would put a filesystem timestamp inside a clock judgement. One number, one
 * `withinReviewHold`, three callers.
 *
 * The cap is deliberately NOT a second lease on the review. It never ends a review and never touches a
 * reviewer — it only stops the review's existence from postponing the sweep indefinitely. What to do about a
 * reviewer that has been running for hours is a judgement for whoever reads the sweep, and this file
 * deliberately does not make it for them.
 *
 * ## What a hold does NOT outrank
 *
 * Only the verified-answer hold outranks live screen truth, and {@link LeaseState}'s `outranksScreenTruth`
 * is how `./dispatch.ts`'s `sweepDecision` knows. A `clean` verdict bound to the bytes in hand means the
 * answer is finished, so a dead worker behind it is irrelevant and reporting `phantom` would destroy it. The
 * other two holds are claims about a worker that is supposed to be ALIVE, so an empty workspace beats them —
 * without that, widening the hold would make a dead worker invisible for up to {@link MAX_REVIEW_HOLD_HOURS},
 * which is the class `phantom` exists for.
 */
import { isLeaseExpired } from "./tier.js";

/**
 * How long a review in flight may hold the lease open before the clock resumes.
 *
 * Two hours, matching `./tier.ts`'s `DEFAULT_LEASE_HOURS`, and provisional for the same reason: it is a
 * bound nobody has measured a real distribution for. The measured shape it has to cover is the ask in this
 * module's header — five rounds at roughly twenty minutes each, so about 100 minutes of genuine review on one
 * ask. Two hours clears that with room and still bounds the worst case at four hours rather than forever.
 */
export const MAX_REVIEW_HOLD_HOURS = 2;

/** What the ask's review looks like right now, as far as the sweep can see it. */
export interface ReviewPosture {
  /** A reviewer is open and has not yet been released. */
  readonly inFlight: boolean;
  /** When the current reviewer was spawned — the instant the hold is measured from. */
  readonly spawnedAt: string | undefined;
  /** A `clean` verdict exists AND binds to the answer now in hand. Anything less is not usable. */
  readonly hasUsableVerdict: boolean;
  /**
   * The review RECORD is open — no `releasedAt` — whatever any round's verdict currently says.
   *
   * Deliberately WIDER than {@link inFlight}, which additionally requires that no verdict file be present.
   * Both of the other two fields imply this one, so it is only ever read after they have had their say; what
   * it adds on its own is the between-rounds window, where a round has returned `broken` and the worker is
   * inside the fix loop that verdict exists to open.
   */
  readonly recordOpen: boolean;
}

/**
 * What the clock says about one dispatched ask.
 *
 * @internal — `leaseState` returns it and `./dispatch.ts` branches on the returned value; nothing names the
 *   type itself outside this module.
 */
type LeaseState =
  | { readonly kind: "active" }
  | {
      readonly kind: "held";
      readonly because: string;
      /**
       * Whether this hold survives the workspace behind the dispatch being EMPTY. True only for the
       * verified-answer hold — see this module's header § What a hold does NOT outrank.
       */
      readonly outranksScreenTruth: boolean;
    }
  | { readonly kind: "expired" };

/**
 * Whether the clock may end this turn.
 *
 * Ordered so the strongest reason to keep the answer is checked first, which is the whole point: a verified
 * answer outranks everything, then a review in flight inside its cap, then a review ROUND still open inside
 * the same cap, and only then the wall clock. The order is load-bearing rather than cosmetic — each
 * predicate is implied by the one above it, so a reshuffle would report the weakest true reason.
 *
 * @param leaseExpiresAt the dispatch's own expiry instant
 * @param nowIso the clock, as an ISO instant
 * @param review what the ask's review looks like right now
 * @returns whether the lease is active, held open, or genuinely expired
 */
export function leaseState({
  leaseExpiresAt,
  nowIso,
  review,
}: {
  leaseExpiresAt: string;
  nowIso: string;
  review: ReviewPosture;
}): LeaseState {
  if (review.hasUsableVerdict) {
    return {
      because: "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
      kind: "held",
      outranksScreenTruth: true,
    };
  }
  const insideCap = withinReviewHold({ nowIso, spawnedAt: review.spawnedAt });
  if (review.inFlight && insideCap) {
    return {
      because: "an independent reviewer is mid-verdict, and its time is not the worker's to pay for",
      kind: "held",
      outranksScreenTruth: false,
    };
  }
  if (review.recordOpen && insideCap) {
    return {
      because:
        "a review round has returned but the review is not released — the worker is inside the fix-and-re-review loop a broken verdict opens",
      kind: "held",
      outranksScreenTruth: false,
    };
  }
  return isLeaseExpired({ leaseExpiresAt, nowIso }) ? { kind: "expired" } : { kind: "active" };
}

/**
 * Whether a reviewer spawned at `spawnedAt` is still inside its hold.
 *
 * Fails CLOSED on an unparseable or absent instant — no hold — for the same reason `isLeaseExpired` fails
 * closed on one: a corrupt timestamp must never grant an unbounded exemption, and the safe direction is to
 * let the lease decide rather than to postpone it forever. That direction matters MORE to this function's
 * second caller than to its first: `./inlineReviewHold.ts` holds a thirty-minute bound open with it, not a
 * two-hour lease, so a corrupt instant there would buy proportionally far more time.
 *
 * Exported so one cap serves every pass that weighs a reviewer, rather than a second number being minted
 * each time. Two callers beyond this file now: `./inlineReviewHold.ts` for the undispatched pass, and
 * `../../sessions/closeDone.ts`, which bounds how long a reviewer mid-verdict may hold `session close-done`
 * off its own workspace. The third is the reason to say "every pass" rather than name them — the number
 * moving must move all of them at once.
 *
 * @param nowIso the clock, as an ISO instant
 * @param spawnedAt when the reviewer was spawned
 * @returns whether the hold still applies
 */
export function withinReviewHold({ nowIso, spawnedAt }: { nowIso: string; spawnedAt: string | undefined }): boolean {
  if (spawnedAt === undefined) {
    return false;
  }
  const spawned = Date.parse(spawnedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(spawned) || Number.isNaN(now)) {
    return false;
  }
  return now - spawned < MAX_REVIEW_HOLD_HOURS * 60 * 60 * 1000;
}
