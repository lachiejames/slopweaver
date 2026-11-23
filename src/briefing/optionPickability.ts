/**
 * The one rule about an OPTION: the owner can pick it where it sits, and picking it does not change what a pull
 * request ships.
 *
 * A card the owner could not act on is the worked example for both halves at once. It offered:
 *
 * ```text
 *   C: rebase each onto staging, three change what they ship.
 *   D: decide per pull request off the numbers in the fold.
 * ```
 *
 * `C` names its own defect in its own sentence — a stack member rebases onto its PARENT, and rebasing three
 * of the five onto staging absorbs the parent's commits, so picking it would have shipped work the owner never
 * reviewed. `D` is not a choice at all: picking it leaves the decision exactly where it was, one fold away.
 * The owner answered neither, which is the honest response to a card offering neither.
 *
 * ## Sent elsewhere: a verb the owner performs, on a target they have to go and read
 *
 * BOTH halves are required, within one option. A verb alone refuses "wait until those sessions finish and
 * restack then"; a target alone refuses every option that cites its evidence. Together they name the exact
 * shape where picking the option is a promise to decide later — `decide per pull request off the numbers in
 * the fold`, and `hold, you will read the page first`.
 *
 * **That second one is deliberate, and it retires a house habit.** Four of the seven me-facing cards in one
 * batch closed with a `hold, you will read <something> first` option. `if silent` already tells the owner what
 * happens when they say nothing, so a hold whose content is homework is a duplicate of silence that also
 * sends them away. The shape that replaces it is no third option at all.
 *
 * ## Wrong-framed: a content verb governing a shipment object, on a pull-request card
 *
 * Scoped to a card whose PREMISE is a pull request, because "what it ships" only means something there. The
 * verb must govern a shipment object within a short run of words, which is what keeps the rule off "remove
 * the draft label" and "change the reviewer" — both operate on a pull request without changing one line of
 * what it ships.
 *
 * The residue is stated rather than closed: a euphemism the verb set does not
 * carry will pass. The criterion stays narrow and measurable instead of growing into a classifier that
 * guesses.
 *
 * Pure: one option's text in, one refusal or nothing out.
 */

/**
 * A verb the owner would be the one performing, in the reading where the option asks them to go and look.
 *
 * Third-person forms are absent on purpose: "the session reads the fold" is the fleet doing the work, which
 * is the shape every well-formed option already has.
 */
const OWNER_READS =
  "read|reading|open|opening|check|checking|review|reviewing|inspect|inspecting|compare|comparing|look|looking";

/** The things an option can send the owner to, each one somewhere other than the option being read. */
const ELSEWHERE =
  "page|pages|fold|folds|link|links|artifact|artifacts|numbers|table|tables|document|documents|thread|threads|detail|details";

/**
 * `read the page`, `look at the numbers`, `read the touch-seam page` — the verb and the target inside one
 * short run.
 *
 * Two bounded gaps rather than one: a closed run of determiners and prepositions, then up to two words of
 * anything. The second gap is what reaches `read the touch-seam page`, which card one offered and a
 * determiner-only gap misses; two is the measured distance on the four cards that carried this shape, and
 * bounding it is what keeps the match inside one clause.
 */
const SENT_TO_READ = new RegExp(
  String.raw`\b(?:${OWNER_READS})\b(?:\s+(?:the|its|that|this|his|your|at|into|over|through|first|each|all|a|an|one)){0,3}(?:\s+[a-z][a-z'-]*){0,2}\s+(?:${ELSEWHERE})\b`,
  "i",
);

/** `decide off the numbers`, `pick from the table` — the choice itself deferred to something the owner must read. */
const DECIDE_ELSEWHERE = new RegExp(
  String.raw`\b(?:decide|decides|deciding|pick|picks|picking|choose|chooses|choosing)\b(?:\s+(?:per|each|every|one|by)\b)?(?:\s+[a-z]+){0,3}\s+(?:from|off|based on|after|using|against)\s+(?:the\s+|those\s+|its\s+)?(?:${ELSEWHERE})\b`,
  "i",
);

/**
 * The phrase that makes an option unpickable where it sits, when it carries one.
 *
 * @param text the option's body, above the fold
 * @returns the offending phrase, or `undefined` when the owner can pick the option from the card alone
 */
export function sentElsewhere({ text }: { text: string }): string | undefined {
  const present = DECIDE_ELSEWHERE.exec(text)?.[0];
  if (present === undefined) {
    return SENT_TO_READ.exec(text)?.[0];
  }
  return present;
}

/**
 * A verb that changes a pull request's CONTENT, rather than its metadata.
 *
 * `label`, `reviewer`, `base` and `title` verbs are absent, and that absence is the rule: an option
 * retargeting a base or dropping a draft mark is a fine thing to offer the owner.
 */
const CONTENT_VERB =
  "absorb|absorbs|absorbing|add|adds|adding|combine|combines|drop|drops|dropping|exclude|excludes|" +
  "include|includes|move|moves|moving|pull in|remove|removes|removing|rewrite|rewrites|rewriting|" +
  "split|splits|splitting|squash|squashes|squashing|change|changes|changing";

/** The thing a content verb has to govern for the option to be changing what the pull request ships. */
const SHIPMENT_OBJECT =
  "commits?|files?|diffs?|scope|contents?|behaviours?|behaviors?|what (?:it|they|each|the pull requests?) ships?";

/**
 * The verb governing a shipment object within a short run — six words, which is the distance a real sentence
 * puts between them and short enough that the match cannot cross into the next clause.
 */
const SCOPE_CHANGE = new RegExp(String.raw`\b(?:${CONTENT_VERB})\b(?:\s+[a-z']+){0,5}\s+(?:${SHIPMENT_OBJECT})\b`, "i");

/**
 * The phrase by which an option would change what a pull request ships, when it carries one.
 *
 * @param text the option's body, above the fold
 * @returns the offending phrase, or `undefined` when the option leaves the pull request's contents alone
 */
export function changesWhatShips({ text }: { text: string }): string | undefined {
  return SCOPE_CHANGE.exec(text)?.[0];
}

/** The shape that replaces an option the owner cannot pick where it sits. */
export const SENT_ELSEWHERE_ADVICE =
  "An option is something the owner picks from the card alone. Put the fact that decides it above the fold, or drop " +
  "the option — `if silent` already covers the owner saying nothing.";

/** The shape that replaces an option that would change what a pull request ships.  *
 * @internal — the one sentence {@link scopeChangeRefusal} ends in; no caller outside this file names it.
 */
export const SCOPE_CHANGE_ADVICE =
  "That is a different pull request, not an option on this decision. Offer the routes that leave what it " +
  "ships alone, and say in `what` why the other one is not on the card.";

/**
 * The gate's refusal for an option the owner cannot pick where it sits.
 *
 * @param cell what the composer should go and fix — `option D`
 * @param phrase the offending phrase {@link sentElsewhere} found
 * @returns one line naming the cell, the phrase and the shape that replaces it
 */
export function sentElsewhereRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return `${cell} cannot be picked where it sits — "${phrase}" sends the owner somewhere else to decide. ${SENT_ELSEWHERE_ADVICE}`;
}

/**
 * The gate's refusal for an option that would change what a pull request ships.
 *
 * @param cell what the composer should go and fix — `option C`
 * @param phrase the offending phrase {@link changesWhatShips} found
 * @returns one line naming the cell, the phrase and the shape that replaces it
 */
export function scopeChangeRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return `${cell} would change what the pull request ships, with "${phrase}". ${SCOPE_CHANGE_ADVICE}`;
}
