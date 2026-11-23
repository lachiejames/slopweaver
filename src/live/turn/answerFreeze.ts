/**
 * THE ANSWER IS FROZEN THE MOMENT IT IS SENT FOR REVIEW — what an edit after that costs, and when it is
 * refused until its author states a reason.
 *
 * ## What "clean" stopped meaning
 *
 * One ask: five review rounds, outcomes `broken`, `broken`, `clean`, `clean`, `broken`, and the
 * answer rewritten after EVERY one of them (11029 → 11093 → 11312 → 11303 → 11368 bytes). A verdict binds to
 * the exact bytes it read (`../../admit/reviewVerdict.ts`), so each rewrite made the verdict that had just
 * arrived unusable and bought another round at a measured ~20 minutes each. Rounds three and four were both
 * SENDABLE and neither was sent. The fifth returned broken four minutes before the lease expired,
 * with a fully investigated answer never posted.
 *
 * Two rewrites in that sequence were to fix `low`-impact reviewer notes on an answer that already had no
 * unresolved high-impact claim. Each cost a round, and rounds are what ran the turn out of clock.
 *
 * ## Why this is NOT "a clean verdict is terminal"
 *
 * Because the same incident refutes that rule. Round FIVE found the answer broken on the CORE deliverable
 * after rounds three and four had read clean. Had a clean verdict ended the review, the turn would have
 * posted at round three an answer missing the thing the question existed for, and called it a success.
 * Whether rounds three and four missed the gap or a later edit introduced it is not established, and a rule
 * that assumes either is a rule built on a guess.
 *
 * So what is enforced here is narrower and survives both readings: an edit that DISCARDS a verdict which
 * could have been posted as it stood is refused until its author says why, and the refusal names what it is
 * about to spend. Every other edit is free, most importantly the one a `broken` verdict exists to invite —
 * `../../live/turn/reviewRounds.ts` explains why refusing the fix-and-re-review path would be the worse bug.
 *
 * Pure: a record, a verdict read and a digest in; a decision out. The files are `./reviewStore.ts`, the
 * wiring is `../../cli/commands/turn/resume.ts`.
 */
import type { ReviewVerdict } from "../../admit/reviewVerdict.js";
import { MAX_REVIEW_HOLD_HOURS } from "./leaseJudgement.js";
import type { ReviewRecord } from "./review.js";
import type { VerdictFileRead } from "./reviewPoll.js";
import { unresolvedHighImpactClaims } from "./reviewRounds.js";

/**
 * Whether a verdict could be posted with, exactly as it stands — the same bar
 * `../../admit/answerQualityGate.ts` applies at the door, expressed over a verdict alone because the digest
 * half is what an edit is about to break.
 *
 * @param verdict the verdict to judge
 * @returns whether the door would let this verdict through on its own merits
 */
export function verdictIsSendable({ verdict }: { verdict: ReviewVerdict }): boolean {
  return verdict.outcome === "clean" && unresolvedHighImpactClaims({ verdict }).length === 0;
}

/**
 * What an author is allowed to do with the answer bytes right now, and why.
 *
 * @internal
 */
export type AnswerEditGate =
  /**
   * Nothing has been reviewed, these are the reviewed bytes, or the reviewed bytes were already POSTED as this
   * dispatch's first answer — that verdict was spent by the post, so the final answer discards nothing.
   */
  | { readonly kind: "free"; readonly why: "no-review-opened" | "unchanged-since-review" | "already-posted" }
  /** The standing verdict named a defect, so a rewrite is exactly what it asked for. */
  | { readonly kind: "free"; readonly why: "reviewer-named-a-defect"; readonly round: number }
  /** A round is open with no verdict yet: this edit makes it judge bytes that will already be gone. */
  | { readonly kind: "needs-reason"; readonly why: "review-in-flight"; readonly round: number }
  /** A verdict that could be posted right now is about to become unusable. */
  | {
      readonly kind: "needs-reason";
      readonly why: "discards-a-sendable-verdict";
      readonly round: number;
      readonly verdictPath: string;
    };

/**
 * Decide what this answer's bytes may do, given whatever review already stands over them.
 *
 * A `superseded` or `invalid` verdict file is treated exactly as an absent one: neither is evidence about
 * the round now standing, which is the same classification `./reviewStore.ts`'s `readVerdictFile` exists to
 * make un-bypassable.
 *
 * @param answerDigest the digest of the bytes about to be validated
 * @param record the review standing over this ask, or `undefined` when none was ever opened
 * @param verdictRead how this review's verdict file reads right now
 * @param postedDigest the digest of the first answer this dispatch already posted, or `undefined` when none
 * @returns the gate's decision
 */
export function answerEditGate({
  answerDigest,
  postedDigest,
  record,
  verdictRead,
}: {
  answerDigest: string;
  postedDigest?: string | undefined;
  record: ReviewRecord | undefined;
  verdictRead: VerdictFileRead | undefined;
}): AnswerEditGate {
  if (record === undefined) {
    return { kind: "free", why: "no-review-opened" };
  }
  if (record.answerDigest === answerDigest) {
    return { kind: "free", why: "unchanged-since-review" };
  }
  if (postedDigest !== undefined && record.answerDigest === postedDigest) {
    return { kind: "free", why: "already-posted" };
  }
  if (verdictRead?.kind !== "present") {
    return { kind: "needs-reason", round: record.round, why: "review-in-flight" };
  }
  if (!verdictIsSendable({ verdict: verdictRead.verdict })) {
    return { kind: "free", round: record.round, why: "reviewer-named-a-defect" };
  }
  return {
    kind: "needs-reason",
    round: record.round,
    verdictPath: record.verdictPath,
    why: "discards-a-sendable-verdict",
  };
}

/**
 * How long one review round measurably takes on this install, in minutes — what an edit after review spends.
 *
 * Not exported: {@link answerEditRefusalLines} is the only thing that states it, and a number a caller could
 * pass in is a number a caller could get wrong, which is the whole reason the old shape took it as an option.
 *
 * Round-to-round durations, over every ask on an install that has archived more than one verdict:
 *
 * ```
 * find "$SLOPWEAVER_HOME/live/slack/reviews" -name 'verdict-superseded-*.json' |
 *   sed -E 's|.*-([0-9-]+T[0-9-]+Z)\.json|\1|' | sort
 * ```
 *
 * Measured over 18 asks and the 36 round-to-round gaps they hold: median 18.4 minutes, mean 18.0,
 * p90 27.1, max 36.4. Stated as 20 because a refusal is read by a person, and the median is what the next
 * round will most likely cost them.
 */
const REVIEW_ROUND_MINUTES = 20;

/**
 * The refusal an author sees when an edit needs a reason and none was given — it must name what the edit
 * spends, because "refused" alone teaches nothing and the whole failure was an author who did not know each
 * rewrite cost a round.
 *
 * The clock it names is the dispatched lease, and the sentence around it has to stay exact. Under
 * `./leaseJudgement.ts` a clean verdict bound to the bytes in hand holds that clock with NO cap, and that is
 * the hold this edit forfeits. What the turn keeps is the weaker one: while the review RECORD is open the
 * clock is still held, but only for {@link MAX_REVIEW_HOLD_HOURS} from the current round's own spawn, and
 * past that the dispatched instant decides. Saying "forfeits the hold" flatly would be a confident lie —
 * an author who believed it would think the lease was about to end when it was not.
 *
 * @param editReasonFlag the exact flag spelling the caller should re-run with
 * @param gate the decision, already known to be `needs-reason`
 * @param leaseExpiresAt the turn's dispatched lease — the clock that decides once no review holds it
 * @returns the lines to print, in order
 */
export function answerEditRefusalLines({
  editReasonFlag,
  gate,
  leaseExpiresAt,
}: {
  editReasonFlag: string;
  gate: Extract<AnswerEditGate, { kind: "needs-reason" }>;
  leaseExpiresAt: string;
}): readonly string[] {
  const cost =
    `this edit costs another review round — about ${String(REVIEW_ROUND_MINUTES)} minutes — and forfeits the ` +
    `UNCAPPED hold a postable verdict has on the clock: while the review stays open the clock is held only ` +
    `for ${String(MAX_REVIEW_HOLD_HOURS)}h from the current round's spawn, and past that the lease as ` +
    `dispatched decides, and it runs out at ${leaseExpiresAt}`;
  if (gate.why === "review-in-flight") {
    return [
      `round ${String(gate.round)} is still reading the bytes you are about to replace, so its verdict will ` +
        "bind to an answer that no longer exists and cannot be posted with",
      cost,
      `if the edit is worth that, say why: ${editReasonFlag} "<why these bytes had to change>"`,
    ];
  }
  return [
    `round ${String(gate.round)} returned a verdict you could post RIGHT NOW — clean, with no unresolved ` +
      `high-impact claim — bound to the bytes you are about to replace (${gate.verdictPath})`,
    "editing them makes that verdict unusable: a new digest needs a new verdict",
    cost,
    "if the answer is genuinely wrong, that is exactly what this flag is for — a `low`-impact note the " +
      "reviewer wrote down is not",
    `say why: ${editReasonFlag} "<why these bytes had to change>"`,
  ];
}
