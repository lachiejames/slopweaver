/**
 * The key a console card is named by: `<kind>:<id>`, the same string the queue's `?open=` deep link carries,
 * `read_page` names and a relay's `about` records. One pattern, so the relay, the call transcript and the card a
 * spoken word lands on can never disagree about what a key is. `site/` restates it once (`site/lib/cardKey.ts`)
 * because it cannot import this tree; `unit/talk/cardKey.test.ts` holds the two to the same source text.
 *
 * `recipe:<id>` names an Automations card, not a Queue card: a steer about an automation carries it so the
 * supervisor and that page both know which row it is about. `align:<id>` names a question
 * the Alignment page asks that no register holds — a voice scenario, or whether the owner's repeated words on one kind of
 * act should become a standing rule. `candidate:<id>` names a proposed workstream on the
 * Workstreams page, so a word said in the call while one is open names it — the console takes no typed words but the
 * call's own. None of the three is held by a register, so {@link isRegisterCardKey} is what a
 * consumer of register cards asks.
 */

/** A card key. Anchored, so a longer string carrying one does not pass. */
export const CARD_KEY = /^(ask|hand|draft|post|review|import|pr|act|recipe|align|candidate):[A-Za-z0-9._-]{1,160}$/u;

/**
 * The Queue card a board row's held question is drawn as: `ask:<slug>`. Named once here so a reader binding the owner's
 * words to a run's question by its card cannot spell the key a second way.
 *
 * @param slug the board row's slug, already a safe slug
 * @returns the card key
 */
export function askCardKey({ slug }: { slug: string }): string {
  return `ask:${slug}`;
}

/** The card kinds no register holds: an Automations card, an Alignment-page question, and a proposed workstream. */
const UNHELD_KINDS = ["recipe:", "align:", "candidate:"] as const;

/**
 * Whether a card key names a card a register holds — a Queue card, or an act on the Alignment page — and so a card
 * a spoken or typed word can land on and take off the owner's list. `recipe:`, `align:` and `candidate:` name cards no
 * register holds.
 *
 * @param key a key that already passed {@link CARD_KEY}
 * @returns whether a register can hold it
 */
export function isRegisterCardKey({ key }: { key: string }): boolean {
  return !UNHELD_KINDS.some((kind) => key.startsWith(kind));
}

/**
 * The most OTHER cards one relay may name as also answered by the owner's words (`relay_steer`'s `also_answers`). One
 * stretch of their words deciding more than a handful of cards at once is a reading gone wrong rather than a ruling, so
 * past this the page refuses the whole call instead of clearing the owner's Queue on it.
 * `site/lib/alsoAnsweredCards.ts` restates it; `site/__tests__/unit/alsoAnsweredCards.test.ts` holds the two equal.
 */
export const ALSO_ANSWERS_MAX = 5;

/**
 * The card kinds words never answer as an ALSO-answered card: a hand step (only the owner's hands take it), a check-in
 * (`check_in` carries the owner's verdict on one), and the three kinds no register holds.
 */
export const NEVER_ALSO_ANSWERED: readonly string[] = ["hand:", "act:", ...UNHELD_KINDS];

/**
 * A turn record's stored `alsoAnswers`, read the way `./turnRecordShape.ts` reads every field a record written before
 * it existed lacks: absent stays absent, a list of card keys is stored, and anything else makes the record unreadable
 * rather than reading as a relay that named no other card.
 *
 * @param value the parsed field
 * @returns which of the three it is, with the keys when stored
 */
export function storedAlsoAnswersOf({
  value,
}: {
  value: unknown;
}): { kind: "absent" } | { kind: "malformed" } | { kind: "stored"; keys: readonly string[] } {
  if (value === undefined) {
    return { kind: "absent" };
  }
  if (!Array.isArray(value)) {
    return { kind: "malformed" };
  }
  const keys = value.filter((key): key is string => typeof key === "string" && CARD_KEY.test(key));
  if (keys.length !== value.length || keys.length > ALSO_ANSWERS_MAX) {
    return { kind: "malformed" };
  }
  return { keys, kind: "stored" };
}
