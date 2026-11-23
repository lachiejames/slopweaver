/**
 * The one rule about WHOSE HANDS a card puts an action in: never the owner's.
 *
 * A me-facing react-now card reports on work only the owner ever sees, and a card that ends by handing the
 * owner the last step — "then you reset", "in your own file", "only you can write", "add it now" — is not a
 * wording preference: the owner does not touch their own code or config, ever. They instruct the supervisor and
 * the session performs the edit on the relayed word. A step in the owner's own hands will never happen, which
 * makes the card unanswerable while reading as complete — the same defect `./replyChannel.ts` refuses one
 * field over.
 *
 * ## Deliberately over-broad, with the escape written into the shape
 *
 * The criterion is the OWNER named as the actor of a hand action — `you` within a short run of fillers before a
 * verb like `edit`, `run`, `reset` or `click`, `your own` sitting on a file or a console, or an option that
 * OPENS with one of those verbs, since an option is addressed to the owner by construction. That will refuse a
 * sentence that only meant to describe what the owner is able to do, and that is the trade taken on purpose: the
 * shape this rule pushes toward is "tell the supervisor <word> and the session does it", which names the
 * session as the actor and never trips the tell. A narrower rule would have to guess whether a second-person
 * verb instructs the owner or describes them, and a gate that guesses is the kind prose already was.
 *
 * Past tense is deliberately outside the criterion. "You already approved it" reports something, and a
 * report is not a step waiting on the owner's hands — only the bare and present forms are instructions.
 *
 * ## What this does NOT govern
 *
 * The team-facing grouping, and every field but `options` and `what`. The scope is the me-facing grouping.
 * Widening it is the owner's call, not a tidy-up: a team-facing card has a colleague on the other end, and
 * what such a card says about who does what has not been measured the way this has.
 *
 * ## The hand-step register has the OPPOSITE polarity, and does NOT invert this rule
 *
 * `src/hand/` records the narrow set of steps only the owner's hands CAN take — a sign-in, an approval, a
 * code-owner pick — so its gate refuses the mirror image of what this one refuses. It is not an inversion of
 * this function: `HAND_ACTION` below carries no `sign`, no `approve` and no `pick`, so inverting it would
 * refuse the three steps that register exists for, the flagship sign-in first. `src/hand/step.ts`'s criterion
 * is the other end of the sentence — who is DOING it — and it calls this function as its own escape: a
 * sentence naming a session but handing the OWNER the hand action ("Click Approve on the session's Vanta
 * request") is the owner's, and this is the measured criterion for exactly that. Keep the two lists apart; a
 * verb added here is not automatically wanted there.
 */

/**
 * Every hand action the owner does not perform — an edit, a command, a console click — in the bare and
 * third-person forms an instruction is written in.
 *
 * The list is short on purpose. A verb generic enough to carry a non-action reading (`set`, `open`,
 * `change`) buys refusals of sentences nobody meant as instructions, and the shape the rule pushes toward
 * already escapes every one of these by naming the session instead.
 */
const HAND_ACTION =
  "add|adds|amend|amends|apply|applies|click|clicks|commit|commits|configure|configures|delete|deletes|" +
  "disable|disables|edit|edits|enable|enables|install|installs|paste|pastes|patch|patches|push|pushes|" +
  "rebase|rebases|remove|removes|rename|renames|rerun|reruns|reset|resets|restart|restarts|run|runs|" +
  "toggle|toggles|tweak|tweaks|type|types|write|writes";

/**
 * The words that may stand between the owner and the verb without breaking the binding — a modal, an
 * infinitive marker, an adverb of immediacy. A closed set, so the match cannot wander into the next clause.
 */
const FILLER = "will|would|can|could|should|must|may|might|need|have|to|then|just|also|manually|simply|first|only";

/** The owner, named as the actor: `you reset`, `only you can write`, `you'll need to add it`. */
const ADDRESSED = new RegExp(String.raw`\byou\b(?:'\w+)?(?:\s+(?:${FILLER})\b)*\s+(?:${HAND_ACTION})\b`, "i");

/**
 * The thing itself placed in the owner's hands: `in your own file`, `your own settings`.
 *
 * The noun must follow `your own` immediately. The open-pull-request leg already writes `your own pull
 * request` and `your own work-console branch` about work that is the owner's without being in their hands, and an
 * intervening word is the difference between the two readings.
 */
const POSSESSED =
  /\byour own\s+(?:files?|settings|config(?:uration)?|console|terminal|editor|checkout|machine|repo(?:sitory)?|hands?|keyboard)\b/i;

/** An option that OPENS with a hand action, which is that action addressed to nobody but the owner. */
const IMPERATIVE = new RegExp(String.raw`^(?:${HAND_ACTION})\b`, "i");

/**
 * The phrase that puts an action in the owner's own hands, when a cell carries one.
 *
 * @param text the cell's plain text, above the fold
 * @param imperative whether a bare opening verb counts — true for an option, which is addressed to the owner
 * @returns the offending phrase, or `undefined` when the cell leaves every action with the fleet
 */
export function ownHandAction({ text, imperative }: { text: string; imperative: boolean }): string | undefined {
  const addressed = ADDRESSED.exec(text)?.[0];
  if (addressed !== undefined) {
    return addressed;
  }
  const possessed = POSSESSED.exec(text)?.[0];
  if (possessed !== undefined) {
    return possessed;
  }
  if (!imperative) {
    return undefined;
  }
  return IMPERATIVE.exec(text.trim())?.[0];
}

/**
 * The shape that replaces an own-hand cell, worded once so the form and the gate cannot drift apart on it.
 *
 * The form states it as a static schema message and the gate appends it to a refusal naming the offending
 * phrase; both end in the same sentence, which is the one a composer actually acts on.
 */
export const OWN_HAND_ADVICE =
  "The owner never edits a file, runs a command or clicks a console themselves, so name the session as the actor: " +
  '"tell the supervisor <word> and the session does it".';

/**
 * The gate's refusal for one own-hand cell.
 *
 * @param cell what the composer should go and fix — `option A`, `what`
 * @param phrase the offending phrase {@link ownHandAction} found
 * @returns one line naming the cell, the phrase and the shape that replaces it
 */
export function ownHandRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return `${cell} puts an action in the owner's own hands with "${phrase}". ${OWN_HAND_ADVICE}`;
}
