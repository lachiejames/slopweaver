/**
 * Trace before ranking — **an old item is followed back to where it came from before it is called work.**
 *
 * The owner's ruling, on a ticket a ranked list once put eighth: it had not been relevant since the day it was
 * written, because the problem was already solved. The item was
 * real, urgent and thirty days old; it was also finished. A list that says "do this" about finished work
 * costs more trust than one that omits it, because the reader has to go and find that out.
 *
 * So the item does not go straight to the ranker. It goes to its origin first, and what the origin says
 * decides which of three things it is:
 *
 *  1. **`rank`** — the trace found the work genuinely outstanding. Rank it as work.
 *  2. **`propose-close`** — the trace found it already done somewhere else. The item is not "do this", it
 *     is "close this", and it arrives carrying the evidence that decided it. It never closes anything.
 *  3. **`re-read-live`** — nothing load-bearing was traced. The item is held OUT of the list until
 *     somebody reads the live source, rather than ranked on what a document says about it.
 *
 * ## Why grade the evidence at all
 *
 * Because the first trace this rule was written from would have reached the right answer for the wrong
 * reason. `EEEE-589` asks for one specific one-line change; a pull request on a sibling ticket made exactly
 * that change and merged **33 minutes later**; the pull request raised against the ticket itself was closed,
 * never merged. In the Slack thread it all came from, a message says outright which pull request was the
 * root fix — and that message was posted by an app, not typed by a person. Reading it as the answer would
 * have been this system believing its own output back.
 *
 * The load-bearing evidence was the merge state of the three pull requests: a field the provider owns,
 * which nothing here could have written. That is the distinction {@link EvidenceGrade} carries, and the
 * whole decision rule is one sentence: **only a provider fact can close an item.**
 *
 * ## The same rule catches a second class
 *
 * The ranked list told the owner to restart their listener. It was not down. The item's evidence was a board
 * doc's own summary prose, taken as a reading of the world when it is an authored CLAIM about it — written
 * once, by a session, and true only of the moment it was written. `slopweaver session standing` said the
 * listener was live all along. That is the same failure as the app-posted Slack message, in a different
 * costume, which is why doc prose grades as a machine account here rather than getting a category of its
 * own: a sentence this system could have produced is corroboration, never proof.
 *
 * ## What this module deliberately does not do
 *
 * **There is no age threshold.** The rule reads "before an OLD item is ranked", and picking the hours that
 * make an item old would be inventing a heuristic where the owner has ruled none. The caller decides what
 * it is worth tracing; this decides what a trace means. {@link ./ruleZero.DEFAULT_THRESHOLD_HOURS} is the
 * one number the owner has actually set, and it answers a different question.
 *
 * Pure — no I/O, no clock, no network. The caller supplies the trace; this reads it.
 */

import type { ActorKind } from "./actorKind.js";

/**
 * How much weight one piece of traced evidence can carry.
 *
 * The three are ordered by what could have written them, not by how confident they sound:
 *
 * - `provider-fact` — a state field the provider owns and nobody here authored: a pull request's merge
 *   state, an issue's state, a file's existence on a remote. This is the only grade that can close an item.
 * - `human-account` — prose a person typed. Real evidence, and it may accompany a close, but it is one
 *   person's account of what happened rather than the thing that happened.
 * - `machine-account` — prose this system or another machine produced, INCLUDING a board doc's own summary
 *   and an agent's written status. Corroboration only. An unattributed actor grades here too, for the
 *   reason {@link ./actorKind} defaults the other way from `accountKind`: naming a machine as a person is
 *   the failure being prevented, so what cannot be placed is never treated as a person.
 */
export type EvidenceGrade = "human-account" | "machine-account" | "provider-fact";

/**
 * One thing the trace found, and what it is worth.
 *
 * `showsResolved` is separate from `grade` on purpose: a provider fact can just as easily show an item is
 * still open, and a card that could not say which would be no better than the doc prose it replaced.
 */
export interface TraceEvidence {
  /** One clause naming what was found, shown to the reader verbatim. */
  readonly what: string;
  /** Where to go and check it — a permalink, a native id, a command. */
  readonly source: string;
  /** What could have written this. See {@link EvidenceGrade}. */
  readonly grade: EvidenceGrade;
  /** Whether this piece points at the work already being done elsewhere. */
  readonly showsResolved: boolean;
}

/**
 * What the trace decided about one item. See the module header for what each means.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export type TraceVerdict = "propose-close" | "rank" | "re-read-live";

/**
 * A trace decision, with the reason a card shows and only the evidence that actually carried it.
 *
 * `carried` is filtered rather than echoed back whole, because an item proposed for closing has to arrive
 * with the facts that closed it and nothing else — the owner's stated objection to the first list was
 * rows the owner could not argue with.
 *
 * @internal the public contract for the ranking, exported ahead of the consumer that reads it.
 */
export interface TraceDecision {
  readonly verdict: TraceVerdict;
  /** One clause, plain words, no term the reader has to look up. */
  readonly reason: string;
  /** The evidence that decided this, in the order it was traced. Empty when nothing was traced. */
  readonly carried: readonly TraceEvidence[];
}

/**
 * Grade prose by who wrote it.
 *
 * A human's account is a human account; everything else — a bot, this program's own as-me lane, and
 * anything unplaceable — is a machine account, which cannot close an item on its own.
 *
 * @param actor how {@link ./actorKind.classifyActor} placed the writer
 * @returns the grade that prose carries
 */
export function gradeAuthoredEvidence({ actor }: { actor: ActorKind }): EvidenceGrade {
  return actor === "human" ? "human-account" : "machine-account";
}

/**
 * Apply trace-before-ranking to one item.
 *
 * The three outcomes fall out of two questions asked in order. Did the trace find anything a provider
 * owns? If not, nothing here is load-bearing and the item is held for a live read — including the case
 * where a machine-written sentence says plainly that the work is done, which is exactly the trap this
 * exists for. Then: does that provider fact show the work already resolved?
 *
 * An item traced to provider facts that all show it still open ranks as work, which is the ordinary case
 * and must stay cheap — most items are simply not finished.
 *
 * @param evidence everything the trace found, in the order it was found
 * @returns the verdict, the reason a card shows, and the evidence that carried it
 */
export function traceBeforeRanking({ evidence }: { evidence: readonly TraceEvidence[] }): TraceDecision {
  const providerFacts = evidence.filter((item) => item.grade === "provider-fact");

  if (providerFacts.length === 0) {
    const claimedResolved = evidence.some((item) => item.showsResolved);
    if (claimedResolved) {
      return {
        carried: [],
        reason: "something says this is already done, but nothing the provider owns confirms it — read it live",
        verdict: "re-read-live",
      };
    }
    return {
      carried: [],
      reason: "nothing was traced back to a source the provider owns — read it live",
      verdict: "re-read-live",
    };
  }

  const resolving = providerFacts.filter((item) => item.showsResolved);
  if (resolving.length === 0) {
    return { carried: providerFacts, reason: "traced, and still open where it came from", verdict: "rank" };
  }

  const corroborating = evidence.filter((item) => item.grade !== "provider-fact" && item.showsResolved);
  return {
    carried: [...resolving, ...corroborating],
    reason: "the work this asks for was already done somewhere else — close it, do not do it",
    verdict: "propose-close",
  };
}

/**
 * Whether a decision puts the item in front of the owner at all, given a name so no caller re-derives it and
 * forgets that a close proposal IS a row on the list — a short one, but the owner's to answer.
 *
 * `re-read-live` is the only verdict that shows nothing, and it shows nothing because the list would
 * otherwise be asserting something it has not checked.
 *
 * @param decision the trace decision to test
 * @returns true for `rank` and `propose-close`, false for `re-read-live`
 */
export function isRankable({ decision }: { decision: TraceDecision }): boolean {
  return decision.verdict !== "re-read-live";
}
