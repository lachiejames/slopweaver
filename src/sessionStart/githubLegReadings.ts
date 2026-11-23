/**
 * What one pull request's row is scored and graded on: the readings the ranker takes, whether its placement could
 * be established, and the evidence the trace carries. {@link ./githubLeg.ts} composes these into its rank input.
 *
 * Pure — no I/O, no clock. `nowIso` is supplied by the caller.
 */

import type { PrReviewState } from "../review/reviewState.js";
import type { WhoseMove } from "../silver/ruleZero.js";
import type { TraceEvidence } from "../silver/traceBeforeRanking.js";
import type { SignalReadings } from "./rank.js";

/**
 * The most days of silence that still count, matching `SIGNAL_CAPS.age`.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const AGE_DAYS_CAP = 2;

/**
 * Whether this row's freshness could not be established.
 *
 * True exactly when the recommendation itself is `unknown`, so the row carries its own limit into the
 * ranking instead of the reader inferring one. CodeRabbit's own `unknown` is deliberately NOT read here:
 * it is advisory on this repository and cannot withhold an ask, so it cannot make a row unverified either.
 *
 * @param state the pull request's seven answers
 * @returns whether the Slack answer left the placement unbounded
 */
export function prUnverified({ state }: { state: PrReviewState }): boolean {
  return state.recommendation === "unknown";
}

/**
 * What this leg measured for one pull request.
 *
 * `stoppedOnOwner` fires only on evidence that somebody actually did their half and handed it back — a human
 * review landing after the newest ask. Being asked-about is not being blocked, and asserting the cap
 * without that evidence is how every row on a list becomes urgent.
 *
 * `drift` is always zero, and the first live run is what settled that. A STALE CodeRabbit verdict — it
 * reviewed an earlier push, so it reads green while not being green — looks like drift, and reading it that
 * way was the build this leg shipped first. MEASURED on real data: about a quarter of the owner's open pull requests are stale,
 * and because `drift` outranks every signal that would otherwise carry a row, it won the explanation on all
 * of them — putting *"what the system says about this stopped matching what is true"* directly under *"Get
 * CI green on the pull request"*. The arithmetic was right and the sentence did not match its own row's action, which
 * is exactly the row the owner cannot argue with. Staleness is a caveat on ONE check that never changes
 * what the owner does next; it stays in the row's `state` for a reader who wants it, and out of the ranking.
 *
 * `explicitPriority` is always zero. Nothing GitHub carries here is a priority the OWNER set, and dressing a
 * label or a CI signal as their stated urgency is how a row becomes one they cannot argue with.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @param nowIso the run's own instant, supplied rather than read
 * @returns the readings
 */
export function prReadings({
  state,
  whose,
  nowIso,
}: {
  state: PrReviewState;
  whose: WhoseMove;
  nowIso: string;
}): SignalReadings {
  const moved = Date.parse(state.updatedAtIso);
  const now = Date.parse(nowIso);
  const days = Number.isNaN(moved) || Number.isNaN(now) ? 0 : Math.floor((now - moved) / 86_400_000);
  return {
    age: Math.min(Math.max(0, days), AGE_DAYS_CAP),
    directness: 3,
    distanceToDone: distanceToDone({ state, whose }),
    drift: 0,
    explicitPriority: 0,
    stoppedOnOwner: state.reviewedSinceAsk.length > 0 ? 5 : 0,
  };
}

/**
 * How close one act is to finishing this pull request.
 *
 * A chase, an ask and a self-merge are each one act. A draft needs undrafting and then asking, so it is
 * two. Something blocked needs the block cleared before either, and how long that takes is not knowable
 * from here, so it scores lowest rather than pretending.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @returns the reading, before the ranker caps it
 */
function distanceToDone({ state, whose }: { state: PrReviewState; whose: WhoseMove }): number {
  if (whose.party === "other") {
    return 3;
  }
  const stuckOnTheBranch =
    state.recommendation === "blocked" || state.recommendation === "conflicting" || state.recommendation === "stacked";
  if (stuckOnTheBranch) {
    return 1;
  }
  return state.recommendation === "still-draft" ? 2 : 3;
}

/**
 * The evidence one pull request carries into the trace.
 *
 * Graded `provider-fact` because GitHub owns whether its own pull request is open and what its checks say,
 * and the row was read live rather than from a stored copy. `showsResolved` is false throughout: an open
 * pull request is by definition not resolved, and the leg never sees a closed one.
 *
 * @param state the pull request's seven answers
 * @param whose whose move it is
 * @returns the evidence, in the words a row shows
 */
export function prEvidence({ state, whose }: { state: PrReviewState; whose: WhoseMove }): readonly TraceEvidence[] {
  const asked =
    whose.party === "other"
      ? `${whose.who} was asked to review it in Slack`
      : "nobody a bump could reach has been asked to review it in Slack";
  return [
    {
      grade: "provider-fact",
      showsResolved: false,
      source: state.url,
      what: `open since its last push at ${state.updatedAtIso}, CI ${state.ci}, and ${asked}`,
    },
  ];
}
