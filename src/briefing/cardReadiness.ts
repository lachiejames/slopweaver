/**
 * The one rule about WHETHER a card is answerable yet: a card that waits on a session never outranks one
 * that does not.
 *
 * A react-now card that says its session is still working is not ready for the owner to react to, and it must
 * not sit above cards that are: squinting to tell the two apart is a cost the page must not hand the owner.
 *
 * The defect is not the waiting card's existence — a card whose work is in flight is worth showing. It is
 * that nothing on the page would tell the two apart, so the cost of finding the answerable cards would be the
 * owner's to pay, card by card. Rule 7 says shape is enforced by the schema rather than by review, so readiness is a TYPED
 * field on the card (`../outbound/briefing/types.ts`'s `BriefingCardReadiness`), the renderer puts every
 * ready card above every waiting one, and `./reactNowCard.ts` refuses a page arranged the other way.
 *
 * ## What this module is, and what it is NOT
 *
 * It is the BACKSTOP, not the mechanism. The mechanism is the type: a composer declares `ready` or declares
 * `waiting` naming a session and the event it waits on, and the renderer orders the block from that. This
 * detector exists for the one shape the type alone cannot refuse — a card that declares itself `ready` while
 * its own `what` says a session is still working, which is precisely the contradiction a card carries when
 * its `what` reads "The session is adopting the four into one native stack and rewriting the Problem section
 * to lead with the origin."
 *
 * ## Deliberately NARROW, which is the opposite call to `./ownHandAction.ts`
 *
 * That module is over-broad on purpose, because the shape it pushes toward escapes it by construction. This
 * one cannot borrow that trade. A `what` legitimately reports what the fleet has been doing all the time —
 * "the session landed it", "the session opens the consent tab on your word" — and a card whose work is
 * genuinely finished is not made unready by naming the session that did it. Refusing those would push
 * composers to write cards that never say who acted, which is worse than the defect. So the criterion is one
 * narrow thing: a fleet actor as the subject of a PROGRESSIVE work verb, which is the grammar of work that
 * has not finished. Past and present tense are outside it on purpose — "the session landed it" reports, "the
 * session is landing it" does not.
 *
 * MEASURED across the whole supervisor-scratch briefing archive: 122 distinct rendered form snapshots
 * carrying react-now cards, 991 cards between them, 10 cards matching this criterion across 10 snapshots, 1
 * snapshot carrying one of them ABOVE three ready cards. One such card stood for 8 consecutive snapshots as the
 * block's card 1.
 */

/**
 * The fleet, named as the subject: a session, the chat driving it, the run it belongs to.
 *
 * The determiner is required so an ordinary noun ("session" inside a longer phrase) cannot be read as the
 * subject of the verb that follows, and one optional word may sit between it and the noun so `an Opus
 * session` and `the query-layer session` both bind.
 */
const FLEET_ACTOR = String.raw`(?:the|that|this|a|an|another|its|one)\s+(?:[\w-]+\s+)?(?:sessions?|chat|run|fleet|worktree|agent)`;

/**
 * The work verbs, in the progressive form only, that say a piece of work has not finished.
 *
 * Measuring, building, adopting and rewriting lead, plus the ones the archive
 * measurement actually found in this position. Every entry is a verb of PRODUCING something; a verb that can
 * describe a steady state ("running", "holding", "owning") is deliberately absent, because a session that is
 * running is not thereby a session whose card is unanswerable.
 */
const WORK_VERB =
  "adopting|assembling|auditing|benchmarking|building|collecting|composing|converting|drafting|extending|" +
  "finishing|gathering|implementing|investigating|landing|measuring|migrating|porting|preparing|proving|" +
  "rebasing|refactoring|re-measuring|remeasuring|reworking|rewriting|splitting|sweeping|verifying|" +
  "waiting|wiring|working|writing";

/**
 * The words that may stand between the actor and its verb without breaking the binding — an adverb of
 * incompleteness, and nothing else. A closed set, so a match cannot wander into the next clause.
 */
const FILLER = "still|now|currently|already|just|also|meanwhile|today|then|first";

const IN_FLIGHT = new RegExp(
  String.raw`\b${FLEET_ACTOR}\b(?:\s+(?:${FILLER})\b)*\s+(?:is|are)\b(?:\s+(?:${FILLER})\b)*\s+(?:${WORK_VERB})\b`,
  "i",
);

/**
 * The phrase saying a session is still working, when a cell carries one.
 *
 * @param text the cell's plain text, above the fold
 * @returns the offending phrase, or `undefined` when the cell describes no work still in flight
 */
export function sessionStillWorking({ text }: { text: string }): string | undefined {
  return IN_FLIGHT.exec(text)?.[0];
}

/**
 * The shape that replaces a card contradicting its own readiness, worded once so the form and the gate
 * cannot drift apart on it.
 *
 * The form states it as a schema message and the gate appends it to a refusal naming the offending phrase;
 * both end in the same sentence, which is the one a composer actually acts on.
 */
export const READINESS_ADVICE =
  'Declare `"readiness": { "state": "waiting", "session": "…", "event": "…" }` so the card ranks below the ' +
  "ones you can answer now, or reword the `what` to report work that has finished.";

/**
 * The gate's refusal for one card whose prose and declared readiness disagree.
 *
 * @param cell what the composer should go and fix — always `what` today, named so a widened scope reads
 *   correctly without rewording this
 * @param phrase the offending phrase {@link sessionStillWorking} found
 * @returns one line naming the cell, the phrase and the shape that replaces it
 */
export function readinessRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return (
    `${cell} says a session is still working, with "${phrase}", while the card declares itself ready for ` +
    `your word. ${READINESS_ADVICE}`
  );
}

/**
 * The gate's refusal for a waiting card ranked above one you can answer now.
 *
 * @param card the 1-based position of the waiting card within the react-now block
 * @param ready the 1-based position of the first ready card below it
 * @returns one line naming both positions and the arrangement that replaces them
 */
export function waitingAboveReadyRefusal({ card, ready }: { card: number; ready: number }): string {
  return (
    `card ${String(card)} waits on a session and ranks above card ${String(ready)}, which you can answer now. ` +
    "Every ready card comes first; the waiting ones sit under their own heading below."
  );
}
