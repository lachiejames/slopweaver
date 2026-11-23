/**
 * A hand step that asks the owner to DECIDE, and the posting rule that makes one open the record holding its choice.
 *
 * A decision card must say what is being asked, point somewhere for more context, and offer options that make
 * sense. `./step.ts` owns the record; this module owns the one question of whether its sentence
 * is a choice, and what a choice must link to. Pure, total and clock-free.
 *
 * Every test here is a linear scan — a `redos-check` pass refused the single pattern it replaced, whose adjacent
 * `\s` quantifiers and lookaheads backtracked polynomially on a long run of spaces.
 */

import { type HandStepError, HandStepErrors } from "./errors.js";
import { isIncidentProofUrl, isPublishedPageUrl, onIncidentRow, onPostmortemRow } from "./proofAddress.js";
import { consoleQueueTarget, isConsoleQueuePage, opensOwnHandStep } from "./queueLink.js";
import type { HandStep } from "./step.js";

/** `decide`, said outright — a decision whatever else the sentence is about. */
const DECIDE = /\bdecide\b/i;

/** What opens a named alternative — "whether … or", "either … or". */
const ALTERNATIVE_OPENER = /\b(?:whether|either)\b/i;

/** The `or` that closes one, as a word. */
const OR_WORD = /\bor\b/i;

/** Where a sentence ends — a named alternative never spans two. */
const SENTENCE_END = /[.?!]/;

/** A ", or" and the word right after it — that word says whether an action or a consequence follows. */
const COMMA_OR = /,\s*or\s+([a-z']+)/gi;

/**
 * A word opening a ", or" clause as its SUBJECT — a consequence ("…, or the window closes", "…, or it'll time
 * out", "…, or else"), never an alternative, which opens on an action ("hold it", "close it").
 */
const CONSEQUENCE_LEADS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "else",
  "everything",
  "it",
  "its",
  "nothing",
  "otherwise",
  "our",
  "somebody",
  "someone",
  "that",
  "the",
  "their",
  "these",
  "they",
  "this",
  "those",
  "we",
  "you",
  "your",
]);

/**
 * The third-person singular pronouns that open a consequence the same way, "…, or she loses access". Kept as a pattern
 * rather than in {@link CONSEQUENCE_LEADS} because they match how anybody writes, and the owner-pronoun gate
 * (`../devLint/ownerPronouns.ts`) reads a regular-expression literal as a recogniser, never as prose about the owner.
 */
const PERSON_LEADS = /^(?:he|she|his|her)$/;

/** A modal verb or contraction anywhere in a ", or" clause — "…, or authentication will expire". */
const CONSEQUENCE_MODAL = /\b(?:will|won't|would|might|may|could|can|can't|cannot|should|must)\b|'(?:ll|d)\b/i;

/** Where a ", or" clause ends — global, so a scan starts at the clause and stops at its end. */
const CLAUSE_END = /[.?!,]/g;

/** A sign-in sentence — a step the owner performs, even when it offers two accounts. */
const SIGN_IN =
  /\b(?:sign|log)(?:ging|ing)?[-\s]?(?:in|on|into)\b|\bsingle sign-on\b|\bsso\b|\bauth\b|\bauthenticat(?:e|ing)\b/i;

/**
 * Whether a sentence is a sign-in — never a queue reaction and never a decision, even when it asks the owner to pick
 * the account.
 *
 * @returns true when the sentence reads as signing in
 */
export function isSignIn({ what }: { what: string }): boolean {
  return SIGN_IN.test(what);
}

/**
 * The phrase that makes a sentence ask the owner to CHOOSE between things — `decide`, "whether … or", "either … or",
 * or a ", or" followed by an ACTION. Narrower than `./step.ts`'s reaction phrases by design, because `pick` is
 * how a phone approval or a sign-in reads and those have no ask to record.
 *
 * A heuristic with known misses in both directions, stated rather than discovered: a subject the lead list does
 * not hold, with no modal ("…, or John loses access"), still reads as a choice. No finite word list closes that —
 * three review passes each found one more — so the refusal names the rephrase that clears a false one.
 *
 * @returns the phrase, or `undefined` when the sentence offers no choice
 */
function decisionPhrase({ what }: { what: string }): string | undefined {
  const said = DECIDE.exec(what);
  if (said !== null) {
    return said[0];
  }
  // Opener first, then an `or` after it, per sentence: one pass each. A single unanchored pattern re-scanned
  // the rest of the sentence from every "whether" — quadratic, the r3 counterexample, even under WHAT_CAP.
  for (const sentence of what.split(SENTENCE_END)) {
    const opener = ALTERNATIVE_OPENER.exec(sentence);
    if (opener !== null && OR_WORD.test(sentence.slice(opener.index + opener[0].length))) {
      return `${opener[0]} … or`;
    }
  }
  for (const match of what.matchAll(COMMA_OR)) {
    const word = match[1]!;
    const lead = word.toLowerCase().split("'")[0]!;
    // Scan from this clause to its own end only, so every clause is read once however many ", or" there are.
    const start = match.index + match[0].length - word.length;
    CLAUSE_END.lastIndex = start;
    const end = CLAUSE_END.exec(what);
    const clause = what.slice(start, end === null ? what.length : end.index);
    const consequence = CONSEQUENCE_LEADS.has(lead) || PERSON_LEADS.test(lead);
    if (!consequence && !CONSEQUENCE_MODAL.test(clause)) {
      return ", or";
    }
  }
  return undefined;
}

/**
 * The refusal for a DECISION that opens nothing carrying its choice — a POSTING rule, for `linkAsLiteral`'s reason.
 *
 * A hand step's own card knows only the note — done, hide it, leave it — so a step asking the owner to choose between
 * things has to open the record that holds the choice: a shaped ask (its problem, options and trade-offs, lean
 * and stakes, which the queue card then draws), a pull request, a held draft, or the page where the choice is
 * made — or it has to CARRY that record whole, as `./decisionContext.ts`'s embedded decision, which the queue card
 * draws the same way. Refused: no link at all, a queue link opening no item, and a `hand:` item — the step
 * opening ITSELF, which is exactly the card that cannot be read — each unless the step carries its decision.
 *
 * MEASURED over the 68 steps ever posted: 7 read as a decision, every one already opened a shaped
 * ask, and this rule refuses none — the defect on those was the CARD, which `site/lib/handStepAsk.ts` builds
 * from the ask. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `hand post --home "$(mktemp -d)"`.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step is no decision, is a paste, is a sign-in that never says
 *   "decide", or opens its choice
 */
export function decisionWithoutAsk({ step }: { step: HandStep }): HandStepError | undefined {
  const phrase = decisionPhrase({ what: step.what });
  const pastes = step.literal !== undefined || step.checklist !== undefined;
  if (phrase === undefined || pastes || step.decision !== undefined) {
    return undefined;
  }
  // A sign-in offering two ways in ("with SSO, or the Google button") is a step the owner performs; a step SAYING
  // "decide" is a decision whatever it is about — the sign-in test matches a bare "auth".
  if (!DECIDE.test(step.what) && isSignIn({ what: step.what })) {
    return undefined;
  }
  if (step.url !== undefined) {
    if (!isConsoleQueuePage({ url: step.url })) {
      return undefined;
    }
    const target = consoleQueueTarget({ url: step.url });
    if (target !== undefined && target.kind !== "hand") {
      return undefined;
    }
  }
  return HandStepErrors.decisionWithoutAsk({ id: step.id, phrase: phrase.trim() });
}

/**
 * A sentence asking the owner only for a GO-AHEAD — permission for an act somebody else then performs.
 *
 * A phrase tell in `./stepReaction.ts`'s REACTION house style, and narrow for the same reason: a false refusal costs a
 * session the ability to post a step the owner really has to take. "say the word / yes / go", "give (me) the go-ahead",
 * "ok(ay) to", "want me to", "would you like me to", "are you happy / ok / fine for me to", "is it ok(ay) if",
 * "(do you) mind if I / we", "should I / we", "can / may / shall I / we", "confirm you want". A HEURISTIC, never a
 * guarantee: a paraphrase outside these arms posts, and replaying past steps bounds only past language.
 * `can I` never before `have`, `get`, `see` or `borrow`, and `approve` and `confirm` alone are left out on purpose —
 * "can I have the code from your phone" and "approve the push on your phone" are the owner's steps, with nothing for them to
 * weigh. Every arm is a fixed word run, so the scan is linear.
 *
 * MEASURED over the 128 steps posted at the first measurement: 5 match — `vanta-entry-group-approval`,
 * `vulnfix-where-on-the-app`, `steer-iso-rosa-replies`, `mon-park-local-e2es-become-a-3bfd69` and
 * `store-backup-daily-stopped-firing`. Over the 130 posted by the second measurement the `can / may / shall` and "would you like
 * me to" arms add 2, both real go-aheads — "Can I post this one reply as you", "Can I delete
 * v2-ada-owner-work-console" — and no false match. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `parseHandLine` then `goAheadPhrase`.
 */
const GO_AHEAD =
  /\bsay\s+(?:the\s+word|yes|go)\b|\bgive\s+(?:me\s+)?the\s+go-ahead\b|\bok(?:ay)?\s+to\b|\bwant\s+me\s+to\b|\bwould\s+you\s+like\s+me\s+to\b|\bare\s+you\s+(?:happy|ok(?:ay)?|fine)\s+(?:for\s+me\s+to|with\s+me)\b|\bis\s+it\s+ok(?:ay)?\s+if\b|\bmind\s+if\s+(?:i|we)\b|\bshould\s+(?:i|we)\b|\b(?:can|may|shall)\s+(?:i|we)\b(?!\s+(?:have|get|see|borrow)\b)|\bconfirm\s+you\s+want\b/i;

/**
 * The phrase that makes a sentence ask the owner for a go-ahead ({@link GO_AHEAD}), when it carries one.
 *
 * Shared by `./posting.ts`'s `bareGoAhead`, which refuses one carrying nothing to weigh, and by
 * {@link misplacedDecision}, which lets one carry a decision: "Should I close the Vanta group move?" is a choice
 * between doing it and not, and a closure reserved to the owner is exactly what carries its decision.
 *
 * @returns the phrase as written, or `undefined` when the sentence asks for no go-ahead
 */
export function goAheadPhrase({ what }: { what: string }): string | undefined {
  return GO_AHEAD.exec(what)?.[0];
}

/**
 * The refusal for an embedded decision in the wrong place — a POSTING rule, for `decisionWithoutAsk`'s reason.
 *
 * Two shapes. A decision on a sentence that asks for no choice — neither a {@link decisionPhrase} nor a
 * {@link goAheadPhrase} — because the card would draw options under a line that never offered them. And a
 * decision beside a link to ANOTHER record holding a choice — an ask, a pull request, a page — because two
 * contexts on one card leave the owner to work out which one they are answering. The step's own card, on whatever console
 * origin minted it (`./queueLink.ts`'s `opensOwnHandStep`), is one link a decision may sit beside; the other is an
 * incident's PROOF ({@link opensIncidentProof}), which holds the evidence the choice rests on rather than a second
 * choice — `./proofLink.ts`'s `incidentWithoutProof` requires that link on every incident card, decision or not,
 * and `postmortemWithoutBriefing` the briefing page on every postmortem card.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step carries no decision or carries it where it belongs
 */
export function misplacedDecision({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.decision === undefined) {
    return undefined;
  }
  if (decisionPhrase({ what: step.what }) === undefined && goAheadPhrase({ what: step.what }) === undefined) {
    return HandStepErrors.invalidField({
      field: "decision",
      why: "is carried by a step whose sentence asks for no choice — say the choice in `what`, or drop the decision",
    });
  }
  if (step.url !== undefined && !opensOwnHandStep({ id: step.id, url: step.url }) && !opensIncidentProof({ step })) {
    return HandStepErrors.invalidField({
      field: "decision",
      why: "is carried beside a link to another record — link the record that holds the choice, or carry it here, never both",
    });
  }
  return undefined;
}

/**
 * Whether the step is an incident card whose link is its proof — a published page or a Datadog view — or a
 * postmortem card whose link is its briefing, a published page.
 *
 * @returns true when the step names an `incident-` row and its `url` is that row's evidence, or a `postmortem-` row
 *   and its `url` is a published page
 */
function opensIncidentProof({ step }: { step: HandStep }): boolean {
  if (step.url === undefined) {
    return false;
  }
  if (onPostmortemRow({ step })) {
    return isPublishedPageUrl({ url: step.url });
  }
  return onIncidentRow({ step }) && isIncidentProofUrl({ url: step.url });
}
