/**
 * The exclusions the ASK-LIFECYCLE LOG decides for one recovery candidate — `already-resolved`,
 * `terminal-lifecycle`, `in-flight`, `blocked-on-human` and `already-worked`.
 *
 * Split out of `./recover.ts`'s classifier because all five read the same two lookups (the candidate's own
 * folded entry and the raw-history terminal event) and nothing else there does. `./recover.ts`'s header is
 * where the measured incident and the reasoning for each exclusion live; this module carries the state sets
 * and the predicates they feed.
 */
import type { AskLifecycle, TerminalAskLifecycleEvent } from "../ask/lifecycle.js";
import { RESOLVED_WITHOUT_ANSWER } from "../ask/lifecycleEvents.js";
import type { RecoveryExclusion } from "./recover.js";
import { STRANDED_STATES } from "./stranded.js";

/**
 * The ask-lifecycle states meaning a turn is holding this ask RIGHT NOW — see `./recover.ts`'s own header for
 * the measured incident. `captured` is one of them: a re-capture posts a SECOND capture checklist over the
 * first, and the worker finalises only its own, so the duplicate freezes forever.
 *
 * `dispatch-unwitnessed` is in flight, NOT worked: it says a worker was sent a pickup nothing saw arrive,
 * which is a statement about the evidence rather than about the worker. Re-capturing an ask a live session
 * is answering is the exact double-work this set exists to prevent, so it belongs here and never below.
 *
 * `first-answered` is in flight for the same reason: the plan is posted and the same worker is still
 * building it, so a window scan re-capturing it would start a second turn over the first.
 */
const LIFECYCLE_IN_FLIGHT_STATES: ReadonlySet<AskLifecycle["state"]> = new Set([
  "captured",
  "checklist-posted",
  "dispatched",
  "dispatch-unwitnessed",
  "dispatch-witnessed",
  "first-answered",
]);

/**
 * The ask-lifecycle states meaning this ask was already worked and ended WITHOUT an answer. None of them is
 * terminal (`../ask/lifecycle.ts` is deliberate about that: each is a re-judgement candidate for the visible
 * supervisor), and that is exactly why they need naming here — a candidate a recovery sweep re-captures is
 * re-run by nobody's decision, hours later, which is the opposite of the supervisor judging it.
 *
 * `redispatched` is in this set for a different reason and it is not an oversight: an ask a visible session
 * has ALREADY picked back up is spent, so it is excluded from here on whatever state it reaches next. Every
 * other state that follows a re-dispatch is covered by its own exclusion — `captured` and `dispatched` by
 * `in-flight`, an answer by `already-answered`/`terminal-lifecycle`, a second strand by
 * {@link strandedExemption} finding the spend record on the fold.
 */
const LIFECYCLE_WORKED_STATES: ReadonlySet<AskLifecycle["state"]> = new Set([
  "failed",
  "answer-lost",
  "dispatch-failed",
  "lease-expired",
  "redispatched",
]);

/**
 * Whether an `already-worked` state is the ONE case that is not an exclusion after all: an ask stranded with
 * its single re-dispatch still unspent, being classified BY the stranded lane.
 *
 * This is the owner's one-re-dispatch ruling reaching the classifier (`./stranded.ts` carries it in full).
 * `already-worked` is not permanent, and a fresh tag is not the retry path — the owner does not re-tag. It is
 * permanent only from the SECOND time onward.
 *
 * **`strandedLane` is required rather than inferred, and that is the whole safety of it.** The ordinary
 * window scan re-reads recent history, so a strand only minutes old is inside its window too — and a scan
 * that picked it up would capture it with none of the two things the ruling actually asks for: the in-thread
 * notice, and the spend record that makes it happen once. Keeping the exemption opt-in leaves exactly one
 * path to a stranded ask, and it is the one that does both.
 *
 * Deliberately keyed on the spend record rather than on the state: `answer-lost` is stranded by neither
 * `./stranded.ts`'s set nor this one, so an answer that was composed and lost still never re-enters here.
 *
 * @param lifecycle the candidate's own folded entry
 * @param strandedLane whether the caller IS the stranded lane, and has already established strandedness
 * @returns whether this ask is exempt from `already-worked` this once
 */
function strandedExemption({ lifecycle, strandedLane }: { lifecycle: AskLifecycle; strandedLane: boolean }): boolean {
  return strandedLane && STRANDED_STATES.has(lifecycle.state) && lifecycle.redispatched === undefined;
}

/**
 * Why this ask is standing against the owner rather than dropped, or `undefined` when it is not.
 *
 * TWO states, and both have to be here or the second re-opens the hole the first closes: an ask WAITING on
 * the owner, and one the owner has already cleared that no visible session has re-dispatched yet. Neither is in flight
 * (nothing is running) and neither was worked-and-ended (an answer is still coming), so without this the
 * ordinary window scan would re-capture both — posting a second capture checklist over the very card the
 * hourglass is standing on, which is the double-work every other exclusion here exists to prevent.
 *
 * The waiting arm reads `blockedOnHuman` on the fold, which `turn unblock` clears; the cleared arm reads the
 * `unblocked` state, which the resuming `dispatched` event replaces. So a row leaves this exclusion by the
 * turn actually moving, never by a clock.
 *
 * @param lifecycle the candidate's own folded entry, or `undefined` when the log carries none for it
 * @returns the sentence for the exclusion, or `undefined` when nothing of the owner's is outstanding on this ask
 */
function blockedStanding({ lifecycle }: { lifecycle: AskLifecycle | undefined }): string | undefined {
  const blocked = lifecycle?.blockedOnHuman;
  if (blocked !== undefined) {
    return (
      `a step of this turn is waiting on the owner ("${blocked.what}") — it is not dropped and it is not ` +
      "done, and re-capturing it would post a second card over the one carrying the hourglass. " +
      "`slopweaver turn unblock` is what moves it, whenever the owner gets to it"
    );
  }
  if (lifecycle?.state === "unblocked") {
    return (
      "the owner has done the thing this turn was waiting on and a visible session owes it one " +
      "`turn dispatch` over its existing brief — resuming the card it already has, never re-capturing it"
    );
  }
  return undefined;
}

/**
 * The exclusions the ASK-LIFECYCLE LOG decides, in test order.
 *
 * @param lifecycle the candidate's own folded entry, or `undefined` when the log carries none for it
 * @param strandedLane whether the caller is the stranded lane — see {@link strandedExemption}
 * @param terminal the terminal event this ask has EVER reached, from the raw history rather than the fold
 * @returns every log-decided exclusion that applies, and a sentence per exclusion, in the same order
 */
export function lifecycleExclusions({
  lifecycle,
  strandedLane,
  terminal,
}: {
  lifecycle: AskLifecycle | undefined;
  strandedLane: boolean;
  terminal: TerminalAskLifecycleEvent | undefined;
}): { readonly exclusions: readonly RecoveryExclusion[]; readonly why: readonly string[] } {
  const exclusions: RecoveryExclusion[] = [];
  const why: string[] = [];
  if (lifecycle !== undefined && RESOLVED_WITHOUT_ANSWER.has(lifecycle.state)) {
    exclusions.push("already-resolved");
    why.push(`the ask-lifecycle log already resolved this ask (${lifecycle.state}), never posting an answer message`);
  }
  if (terminal !== undefined) {
    exclusions.push("terminal-lifecycle");
    why.push(
      `the ask-lifecycle log already has a terminal "${terminal.kind}" event for exactly this ask — never ` +
        "re-flagged, even with no Slack answer metadata to independently confirm it",
    );
  }
  if (lifecycle !== undefined && LIFECYCLE_IN_FLIGHT_STATES.has(lifecycle.state)) {
    exclusions.push("in-flight");
    why.push(
      `a turn is holding this ask right now (${lifecycle.state}) — re-capturing it posts a second capture ` +
        "checklist the worker will never finalise, and hides the worker from the dispatch sweep",
    );
  }
  const standing = blockedStanding({ lifecycle });
  if (standing !== undefined) {
    exclusions.push("blocked-on-human");
    why.push(standing);
  }
  if (
    lifecycle !== undefined &&
    LIFECYCLE_WORKED_STATES.has(lifecycle.state) &&
    !strandedExemption({ lifecycle, strandedLane })
  ) {
    exclusions.push("already-worked");
    why.push(
      `this ask was already worked and ended without an answer (${lifecycle.state}) — its one re-dispatch ` +
        "by a running visible session is spent, so nothing picks it up again",
    );
  }
  return { exclusions, why };
}
