/**
 * The freshness half of the briefing gate: a react-now card whose pull request has already merged, closed,
 * or entered the merge queue while the page was being composed.
 *
 * MEASURED on five react-now cards the owner ruled on in one afternoon: TWO were stale at the moment of
 * reading. One asked whether to resolve a colleague's
 * review thread on a pull request already sitting Queued with that feedback addressed, and one asked whether to
 * post a proof on a pull request that had merged fifteen hours earlier. Every other half of this gate measures the card's own
 * text; none measures whether the world the card describes still exists.
 *
 * ## Why the premise is a LIVE read and cannot be anything else
 *
 * The cards come from a sweep, and a sweep's document is only ever as fresh as the moment it ran. Making the
 * page state its own staleness would not help: the owner does not read the page to audit it, they read it to
 * answer it, and a card they cannot act on costs the same attention whether or not a timestamp above it was
 * honest. So the gate re-reads the pull request at the moment of publication, which is the one instant that
 * matters, and REFUSES rather than annotating — the same call `./bareRef.ts` makes about a plaintext
 * reference.
 *
 * ## Pure: the premise arrives as a value
 *
 * The read itself is `../live/github/prPremise.ts`, and the CLI edge does it. This module only ever sees the
 * page's markup and a map of what GitHub said, so its whole rule set is driven by a test holding both as
 * values. A card whose pull request is absent from that map is reported as UNVERIFIED rather than passed:
 * "the read did not happen" and "the premise holds" are different facts, and only one of them is evidence.
 *
 * ## Which pull request a card's premise IS
 *
 * The card's SUBJECT link — `{ "text": "owner/repo#<n> — title", "url": … }`, which
 * `skills/supervisor/reference/fleet-briefing-shape.md` defines as what the card is about, and which
 * `./openPrCards.ts` fills with the pull request the card exists for. A card carrying no subject falls back
 * to the first pull-request link in its fold, because the schema requires a card to have one or the other.
 *
 * A pull request merely CITED inside a cell is deliberately not checked. "The fix landed in that pull
 * request, so should we now do X" is a live question about X whose background happens to be merged, and
 * refusing it would make the gate punish a card for citing its own evidence.
 */
import type { PrAddress, PrPremise } from "../live/github/prPremise.js";
import { prAddressOfUrl, prIdentity } from "../live/github/prPremise.js";
import { extractCards } from "./cardSpans.js";
import { renderedCardSubject } from "./cardSubject.js";
import { cardLabel, reactNowRegion } from "./reactNowCard.js";

/**
 * One react-now card and the pull request its premise rests on.
 *
 * @internal — the row shape {@link cardPrRefs} returns; the two CLI edges read `address` off it and nothing
 * else names the type.
 */
export interface CardPrRef {
  /** 1-based position of the card within the react-now block. */
  readonly card: number;
  /** The card's own question, for identifying it in output. */
  readonly question: string;
  readonly address: PrAddress;
  /** `owner/repo#number`, the key a premise is looked up by. */
  readonly identity: string;
}

/** One card whose pull request no longer holds the state the card was written for. */
interface PrPremiseDefect {
  readonly card: number;
  readonly question: string;
  readonly identity: string;
  readonly reason: string;
}

/** What checking one fleet-briefing artifact's cards against live pull-request state found. */
export interface PrPremiseCheck {
  /** How many cards named a pull request at all. */
  readonly refsChecked: number;
  readonly defects: readonly PrPremiseDefect[];
}

/** The empty result — what {@link checkPrPremises} returns when the leg does not run. */
export const NO_PR_PREMISE: PrPremiseCheck = { defects: [], refsChecked: 0 };

/** Every `href` on a card, in document order, for the no-subject fallback. */
const ANY_LINK = /<a href="([^"]+)"/g;

/** The card's own question block, which is what a defect names the card by. */
const QUESTION_DIV = /<div class="q">([\s\S]*?)<\/div>/;

/**
 * The pull request one card's premise rests on, or `undefined` when the card names none.
 *
 * The subject is read through `./cardSubject.ts`'s shared parser rather than a regex of this file's own, so
 * the three readers of a subject line cannot drift apart. The FALLBACK is deliberately unchanged by that: a
 * subject carrying no pull-request link — including a `no page` subject, which carries no link at all —
 * still falls through to the first pull request in the card's fold, exactly as a card with no subject line
 * does. Narrowing it to the no-subject case is refused: this gate exists because two of five cards ruled on
 * were stale at the moment the owner read them, and a card whose premise the fold names is a card this can still check.
 */
function premiseAddressOf({ cardHtml }: { cardHtml: string }): PrAddress | undefined {
  const subjectUrl = renderedCardSubject({ cardHtml })?.url;
  if (subjectUrl !== undefined) {
    const address = prAddressOfUrl({ url: subjectUrl });
    if (address !== undefined) {
      return address;
    }
  }
  for (const link of cardHtml.matchAll(ANY_LINK)) {
    const href = link[1];
    const address = href === undefined ? undefined : prAddressOfUrl({ url: href });
    if (address !== undefined) {
      return address;
    }
  }
  return undefined;
}

/**
 * Every react-now card that names a pull request, with the pull request its premise rests on.
 *
 * @param html the whole artifact file
 * @returns one entry per card carrying a pull-request link, in document order
 */
export function cardPrRefs({ html }: { html: string }): readonly CardPrRef[] {
  const { block } = reactNowRegion({ html });
  if (block === undefined) {
    return [];
  }
  const refs: CardPrRef[] = [];
  extractCards({ block }).forEach((cardHtml, index) => {
    const address = premiseAddressOf({ cardHtml });
    if (address === undefined) {
      return;
    }
    refs.push({
      address,
      card: index + 1,
      identity: prIdentity({ address }),
      question: cardLabel({ text: questionTextOf({ cardHtml }) }),
    });
  });
  return refs;
}

/**
 * The text a card is named by: its question, or its whole markup when it carries none. A hand-written page
 * can hold a card with no `q` block — `./reactNowCard.ts` reports that as the card's own defect, "no `.q`
 * question block found" — and a premise found on such a card must still say which card it is about.
 */
function questionTextOf({ cardHtml }: { cardHtml: string }): string {
  const question = QUESTION_DIV.exec(cardHtml);
  if (question === null) {
    return cardHtml;
  }
  // The pattern's one group is not optional, so every match carries it.
  return question[1]!;
}

/** The tail every stale-premise refusal ends in: the two ways a composer fixes one. */
const HOW_TO_FIX = "Drop the card, or re-render the page from a fresh sweep.";

/**
 * The refusal for one card whose premise no longer holds, or `undefined` when it still does.
 *
 * A queued pull request is stale for the same reason a merged one is: GitHub merges it without the owner, so any
 * question about what to do to it before it lands has already been answered by the queue.
 *
 * @param ref the card and the pull request it rests on
 * @param premise what GitHub said about that pull request, absent when the read did not answer for it
 * @returns the operator-facing reason, or `undefined` when the card is still answerable
 */
function refusalFor({ ref, premise }: { ref: CardPrRef; premise: PrPremise | undefined }): string | undefined {
  if (premise === undefined) {
    return `${ref.identity}'s live state could not be read, so this card's premise is unverified. ${HOW_TO_FIX}`;
  }
  const state = premise.state.toUpperCase();
  if (state === "MERGED" || state === "CLOSED") {
    return `${ref.identity} is ${state} on GitHub, so this card asks about work that is already settled. ${HOW_TO_FIX}`;
  }
  if (premise.queue !== undefined) {
    return (
      `${ref.identity} is in the merge queue (entry ${premise.queue.state}, position ` +
      `${String(premise.queue.position)}), so it lands without the owner. ${HOW_TO_FIX}`
    );
  }
  return undefined;
}

/**
 * Check every react-now card's pull request against the state GitHub currently reports for it.
 *
 * @param html the whole artifact file
 * @param states what the live read answered, keyed by `owner/repo#number`
 * @returns one defect per card whose premise no longer holds, or whose premise could not be read
 */
export function checkPrPremises({
  html,
  states,
}: {
  html: string;
  states: ReadonlyMap<string, PrPremise>;
}): PrPremiseCheck {
  const refs = cardPrRefs({ html });
  const defects: PrPremiseDefect[] = [];
  for (const ref of refs) {
    const reason = refusalFor({ premise: states.get(ref.identity), ref });
    if (reason !== undefined) {
      defects.push({ card: ref.card, identity: ref.identity, question: ref.question, reason });
    }
  }
  return { defects, refsChecked: refs.length };
}
