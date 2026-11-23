/**
 * The two halves of a Queue card's currency mark (`./cardCurrencyMark.ts`): its facts, when its register last read it,
 * and the owner's steers, the tick's reading of everything the owner said since. Pure; the clock reaches it through `ageOf`.
 */
import {
  type CurrencyCard,
  type CurrencyCardRow,
  type CurrencyDone,
  type CurrencyReading,
  isNotConfirmedWhy,
  type SaidFold,
} from "./cardCurrency";
import { saidFoldOf } from "./cardCurrencySaidFold";

/**
 * One half of the check: passed at an instant, or not, with the line saying why. A failed half also carries `failedWords`,
 * the few words the badge says when NEITHER half passed — authored where the reason is known, never parsed out of `line`.
 */
type Half =
  | { readonly passed: true; readonly iso: string; readonly line: string }
  | { readonly passed: false; readonly line: string; readonly failedWords: string };

/** The facts half's badge words when nothing re-confirmed the card. */
const NOT_RECONFIRMED = "not re-confirmed";
/** The facts half's badge words when a read inside it failed. */
const FACTS_READ_FAILED = "facts read failed";

/**
 * The ask key a card is checked under: its own, or the ask a hand step opens.
 *
 * @param card the row
 * @returns the key, or `undefined` for a card no ask stands behind
 */
function askKeyOf({ card }: { card: CurrencyCard }): string | undefined {
  if (card.key.startsWith("ask:")) {
    return card.key;
  }
  return card.aliases?.find((alias) => alias.startsWith("ask:"));
}

/** The page's "3m ago", reaching this file as a seam. */
export type AgeOf = (args: { iso: string }) => string;

/** An ISO instant inside a producer's prose — the shape a source's failure reason can carry. */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gu;

/**
 * A producer's reason, with every instant in it said as an age. The reading's gaps and a failed read's `why` are
 * written by code this card does not own, and a line on the owner's card never shows a raw instant.
 *
 * @param text the producer's prose
 * @returns the prose, aged
 */
export function agedText({ text, ageOf }: { text: string; ageOf: AgeOf }): string {
  return text.replaceAll(ISO_INSTANT, (iso) => ageOf({ iso }));
}

/**
 * What "done" means for this card, in the owner's words.
 *
 * @param done the reading's done-check
 * @returns one sentence
 */
export function doneSentence({ done, ageOf }: { done: CurrencyDone; ageOf: AgeOf }): string {
  if (done.kind === "replied") {
    return `Done when you reply in its Slack thread. You did, ${ageOf({ iso: done.atIso })}: ${done.permalink}`;
  }
  if (done.kind === "not-yet") {
    return `Done when you reply in its Slack thread after the message it is anchored to: none yet, read ${ageOf({ iso: done.readAtIso })}.`;
  }
  if (done.kind === "could-not-check") {
    // Whether the owner has replied did not read: the mark beside the check says so (`unreadOf`), never this sentence.
    return "Done when you reply in its Slack thread.";
  }
  if (done.kind === "declared-not-run") {
    return "Done when its declared checks pass, which the tick does not run.";
  }
  return "Done when you rule on it or it is settled.";
}

/**
 * The card's row in the reading, when the reading covers the card as it stands, or the line saying why not.
 *
 * @param card the row
 * @param reading the last recorded reading
 * @returns the reading's row, or why there is none
 */
export function readingRowOf({
  card,
  reading,
  ageOf,
}: {
  card: CurrencyCard;
  reading: CurrencyReading | undefined;
  ageOf: AgeOf;
}): { readonly row: CurrencyCardRow; readonly reading: CurrencyReading } | { readonly why: string } {
  if (reading === undefined) {
    return { why: "No check has been recorded yet. The supervisor tick records one each pass (`handover currency`)." };
  }
  if (reading.schemaVersion !== undefined) {
    return exactRowOf({ ageOf, card, reading });
  }
  // An older, ask-only reading: a card joins under its own ask key or the ask a hand step opens.
  const askKey = askKeyOf({ card });
  if (askKey === undefined) {
    return { why: "No check of what you have said since covers this kind of card." };
  }
  const row = reading.rows.find((each) => each.key === askKey);
  if (row === undefined) {
    return {
      why: `The last check (${ageOf({ iso: reading.checkedIso })}) did not include this card: it is newer than the check, or the board no longer has it waiting on you.`,
    };
  }
  if (card.key === askKey && card.whenIso !== undefined && row.askedIso !== card.whenIso) {
    return {
      why: `Asked again ${ageOf({ iso: card.whenIso })}, after the last check (${ageOf({ iso: reading.checkedIso })}) read it.`,
    };
  }
  return { reading, row };
}

/**
 * A schema-2 reading's row for this card: its own key, never an alias, at the card's own floor — a row at another floor
 * read a different version of the card, so it neither freshens nor re-tiers this one.
 *
 * @param card the row
 * @param reading a schema-2 reading
 * @returns the reading's row, or why there is none
 */
function exactRowOf({
  card,
  reading,
  ageOf,
}: {
  card: CurrencyCard;
  reading: CurrencyReading;
  ageOf: AgeOf;
}): { readonly row: CurrencyCardRow; readonly reading: CurrencyReading } | { readonly why: string } {
  const checked = ageOf({ iso: reading.checkedIso });
  const keyed = reading.rows.filter((each) => each.key === card.key);
  const row = keyed.find((each) => each.floorIso === card.currencyFloorIso);
  if (row !== undefined) {
    return { reading, row };
  }
  if (keyed.length === 0) {
    return {
      why: `The last check (${checked}) did not include this card: it is newer than the check, or its register no longer holds it.`,
    };
  }
  if (card.currencyFloorIso === undefined) {
    return { why: `The last check (${checked}) read a version of this card that is dated; this one is not.` };
  }
  return { why: `Changed ${ageOf({ iso: card.currencyFloorIso })}, after the last check (${checked}) read it.` };
}

/**
 * The facts half: its own register's read or still-real check, and, for an ask, the done-check's read. A done-check
 * that would not read never passes the half; the line keeps what was last confirmed and the staleness mark says why.
 *
 * @param card the row
 * @param row the card's row in the reading, when one covers it
 * @returns the half
 */
export function factsHalf({
  card,
  row,
  exact,
  ageOf,
}: {
  card: CurrencyCard;
  row: CurrencyCardRow | undefined;
  exact: boolean;
  ageOf: AgeOf;
}): Half {
  // A schema-2 row says itself what confirmed the card's facts, and when; the register's read never stands in for it,
  // so a card such a reading did not cover has no confirmed facts at all — a hand step the hands register merely still
  // holds is not one its monitor re-confirmed.
  if (exact && row === undefined) {
    return {
      failedWords: "facts not checked",
      line: "Facts: not confirmed, because the last check did not read this card as it stands.",
      passed: false,
    };
  }
  const fact = row?.fact;
  if (fact !== undefined) {
    // A read that failed is named as one wherever the producer put it: on the fact itself, or — for an ask whose
    // Slack thread would not read — on the row's done-check beside it.
    const readFailed =
      fact.kind === "not-confirmed" && (fact.unread !== undefined || row?.done?.kind === "could-not-check");
    const failedWords = readFailed ? FACTS_READ_FAILED : NOT_RECONFIRMED;
    // Only a reason this build's producers write is printed here: anything else a reading carries — an older
    // producer's free text, which could name a session or a path — goes to the staleness mark (`unreadOf`) instead.
    if (fact.kind === "not-confirmed" && isNotConfirmedWhy({ why: fact.why })) {
      return { failedWords, line: `Facts: not confirmed, because ${fact.why}.`, passed: false };
    }
    if (fact.kind === "not-confirmed") {
      return { failedWords, line: "Facts: not confirmed.", passed: false };
    }
    return {
      iso: fact.atIso,
      line: `Facts: last confirmed ${ageOf({ iso: fact.atIso })}, by ${fact.by}.`,
      passed: true,
    };
  }
  // An older, ask-only reading: the card's own confirmation, and the done-check's read beside it.
  const done = row?.done;
  if (done?.kind === "declared-not-run") {
    return {
      failedWords: "facts check not run",
      line: "Facts: its declared done-check was not run by the currency check.",
      passed: false,
    };
  }
  const instants: string[] = [];
  if (card.verifiedIso !== undefined) {
    instants.push(card.verifiedIso);
  }
  // A row reached through an alias checked the ask's thread, not this card: it confirms a card only beside the card's
  // own confirmation, so a monitor's step, which has none, never borrows one.
  const doneConfirms = row?.key === card.key || card.verifiedIso !== undefined;
  if (done?.kind === "not-yet" && doneConfirms) {
    instants.push(done.readAtIso);
  }
  const iso = instants.toSorted((a, b) => a.localeCompare(b)).at(-1);
  if (iso === undefined) {
    return { failedWords: NOT_RECONFIRMED, line: "Facts: never re-confirmed since it was asked.", passed: false };
  }
  const line = `Facts: last confirmed ${ageOf({ iso })}.`;
  if (done?.kind === "could-not-check") {
    return { failedWords: FACTS_READ_FAILED, line, passed: false };
  }
  return { iso, line, passed: true };
}

/**
 * What "since" counts from, in the owner's words: an ask's asking or its last re-confirming, a parked post's words being written
 * — floored at its newest revision, so the words that reworked it are not "since" (`./postCurrencyFloor.ts`) — and for
 * every other card the moment it reached the owner. A row with no done-check is never an ask's (`src/handover/currency.ts`).
 *
 * @param row the card's row in the reading
 * @returns the words closing "since …"
 */
export function sinceWords({ row }: { row: CurrencyCardRow }): string {
  if (row.key.startsWith("post:")) {
    return "its words were last written";
  }
  if (row.done === undefined) {
    return "it reached you";
  }
  if (row.floorIso !== undefined && row.floorIso !== row.askedIso) {
    return "it was last re-confirmed";
  }
  return "it was asked";
}

/**
 * The steers half: whether anything the owner said, or any change to their standing rulings, memories and owner profile, since
 * the card's floor could bear on it. A reading older than schema 3 never read the standing half, so it never passes;
 * a schema-3 one passes only when nothing since and no gap stands. "Nothing new" is the claim, never "nothing you ever
 * said": the floor is when the card's producer had the owner's standing guidance, which this check does not re-judge
 * (`src/handover/currencyStanding.ts`).
 *
 * @param covered the card's row in the reading, or why none covers it
 * @returns the half, and the fold of what could bear on it
 */
export function steersHalf({ covered, ageOf }: { covered: ReturnType<typeof readingRowOf>; ageOf: AgeOf }): {
  readonly half: Half;
  readonly said: SaidFold | undefined;
} {
  if ("why" in covered) {
    return {
      half: { failedWords: "steers not checked", line: `Your steers: not checked. ${covered.why}`, passed: false },
      said: undefined,
    };
  }
  const { reading, row } = covered;
  const checked = ageOf({ iso: reading.checkedIso });
  const since = sinceWords({ row });
  const { words } = row.since;
  // The decision checks the schema itself rather than trusting the decoder to strip a smuggled list: only a schema-3
  // reading read the owner's standing guidance.
  const standing = reading.schemaVersion === 3 ? row.since.standing : undefined;
  const items = standing === undefined ? words : [...words, ...standing];
  const said = saidFoldOf({ ageOf, items, said: reading.said, since });
  if (said !== undefined) {
    const found =
      standing !== undefined && standing.length > 0
        ? `things you said or standing guidance that changed since ${since} could bear on it`
        : `you have said things since ${since} that could bear on it`;
    return {
      half: {
        failedWords: words.length > 0 ? "you said things since" : "your guidance changed since",
        line: `Your steers: checked ${checked}; ${found}, not yet folded in; they are listed below.`,
        passed: false,
      },
      said,
    };
  }
  const half = quietHalf({
    checked,
    checkedIso: reading.checkedIso,
    gaps: row.since.gaps.length,
    read: standing !== undefined,
    since,
  });
  return { half, said: undefined };
}

/**
 * The steers half when nothing since could bear on the card: passed only when the reading read the owner's standing guidance
 * and no read failed. A place that would not read is the staleness mark beside the check (`unreadOf`); what did read is
 * still said, and the half never passes over it.
 *
 * @param checked how long ago the check ran, as the card says it
 * @param checkedIso when the check ran
 * @param gaps how many reads failed
 * @param read whether the reading read the owner's standing guidance at all
 * @param since what "since" counts from
 * @returns the half
 */
function quietHalf({
  checked,
  checkedIso,
  gaps,
  read,
  since,
}: {
  checked: string;
  checkedIso: string;
  gaps: number;
  read: boolean;
  since: string;
}): Half {
  if (!read) {
    return {
      failedWords: "standing guidance not checked",
      line: `Your steers: checked ${checked} against what you said since ${since}, but not against your standing rulings, memories and owner profile, which that check predates reading.`,
      passed: false,
    };
  }
  if (gaps > 0) {
    return {
      failedWords: "some steers unread",
      line: `Your steers: checked ${checked}; nothing that read since ${since} bears on it.`,
      passed: false,
    };
  }
  return {
    iso: checkedIso,
    line: `Your steers: checked ${checked} against everything you said and every change to your standing rulings, memories and owner profile since ${since}; nothing new bears on it.`,
    passed: true,
  };
}
