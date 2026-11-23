/**
 * A Queue card's currency mark (`./cardCurrency.ts` states what it means to the owner), and the Queue ordered by it. Pure;
 * the clock reaches it through `ageOf`.
 */
import {
  type CardCurrency,
  type CheckedLines,
  type CurrencyCard,
  type CurrencyCardRow,
  type CurrencyReading,
  type CurrencyUnread,
  isNotConfirmedWhy,
  MAY_BE_STALE,
  type SaidFold,
} from "./cardCurrency";
import {
  type AgeOf,
  agedText,
  doneSentence,
  factsHalf,
  readingRowOf,
  sinceWords,
  steersHalf,
} from "./cardCurrencyHalves";

export { CURRENCY_CHECK, type CurrencyReading } from "./cardCurrency";

/**
 * A card the owner already reacted to: a schema-2 or later row carrying a word of the owner's filed to THIS card after
 * its floor — typed into the supervisor chat and marked to the card, relayed from a call about it, or (schema 3) a
 * ruling recorded on the card's own row. It is no longer the owner's to react to until a
 * seat folds that word in, so it leaves the waiting tiers the way a looks-answered card does (both the facts and the
 * steers are checked). A word nothing has filed may bear on any card, so it
 * leaves this card's steers unchecked and never counts here; nor does a row with no floor, which cannot say "after".
 *
 * @param covered the card's row in the reading
 * @param said the fold of what the owner said since, which the mark keeps
 * @returns the mark, or `undefined` when the owner has not reacted to it
 */
function reactedOf({
  covered,
  said,
  ageOf,
}: {
  covered: { readonly row: CurrencyCardRow; readonly reading: CurrencyReading };
  said: SaidFold | undefined;
  ageOf: AgeOf;
}): CardCurrency | undefined {
  const { row, reading } = covered;
  const floorIso = row.floorIso;
  if (reading.schemaVersion === undefined || floorIso === undefined) {
    return undefined;
  }
  const floorMs = Date.parse(floorIso);
  const { standing, words } = row.since;
  const latest = (standing === undefined ? words : [...words, ...standing])
    .filter((word) => word.filed === "here" && Date.parse(word.atIso) > floorMs)
    .map((word) => word.atIso)
    .toSorted((a, b) => a.localeCompare(b))
    .at(-1);
  if (latest === undefined) {
    return sameQuestionReactedOf({ ageOf, row, said });
  }
  const line = `You said something about this card ${ageOf({ iso: latest })}, after ${sinceWords({ row })}. A seat folds it in; nothing here waits on you until it comes back.`;
  return {
    fresh: false,
    kind: "reacted",
    lines: [line],
    said,
    title: line,
    unread: unreadOf({ ageOf, row }),
    words: `you reacted · ${ageOf({ iso: latest })}`,
  };
}

/**
 * A card asked again in the same words after the owner ruled on it — `talk restore` re-asking a landed ask — read as
 * their reaction, so it sits in the check-ins rather than first in line as never answered. Their ruling predates the
 * floor, so it is said as before the re-ask, never as after it.
 *
 * @param row the card's row, whose `sameQuestionRuling` carries the ruling
 * @param said the fold of what the owner said since, which the mark keeps
 * @returns the mark, or `undefined` when the row carries no such ruling
 */
function sameQuestionReactedOf({
  row,
  said,
  ageOf,
}: {
  row: CurrencyCardRow;
  said: SaidFold | undefined;
  ageOf: AgeOf;
}): CardCurrency | undefined {
  const ruled = row.sameQuestionRuling;
  if (ruled === undefined) {
    return undefined;
  }
  const line = `You already ruled on this same question ${ageOf({ iso: ruled.atIso })}, and it was asked again in the same words. Nothing here waits on you: a re-ask that needs you says what changed since your ruling.`;
  return {
    fresh: false,
    kind: "reacted",
    lines: [line],
    said,
    title: line,
    unread: unreadOf({ ageOf, row }),
    words: `you ruled · ${ageOf({ iso: ruled.atIso })}`,
  };
}

/**
 * The mark one card wears.
 *
 * @param card the row
 * @param reading the last recorded reading, or `undefined` when none has arrived
 * @param ageOf the page's own "3m ago", the clock reaching this file as a seam
 * @returns the mark
 */
export function cardCurrencyOf({
  card,
  reading,
  ageOf,
}: {
  card: CurrencyCard;
  reading: CurrencyReading | undefined;
  ageOf: AgeOf;
}): CardCurrency {
  if (card.ruledIso !== undefined) {
    const line = `The ask this card opens already carries your ruling, decided ${ageOf({ iso: card.ruledIso })}. A seat executes it; nothing here waits on you, and the card leaves when its step is marked done.`;
    return {
      fresh: false,
      kind: "ruled",
      lines: [line],
      said: undefined,
      title: line,
      unread: [],
      words: `you ruled on it · ${ageOf({ iso: card.ruledIso })}`,
    };
  }
  const covered = readingRowOf({ ageOf, card, reading });
  const row = "row" in covered ? covered.row : undefined;
  const rowDone = row?.done;
  if (row !== undefined && rowDone?.kind === "replied") {
    const lines: CheckedLines = [doneSentence({ ageOf, done: rowDone }), "Settle it if that reply answered it."];
    return {
      fresh: false,
      kind: "looks-answered",
      lines,
      said: undefined,
      title: lines.join("\n"),
      unread: unreadOf({ ageOf, row }),
      words: `looks answered · you replied ${ageOf({ iso: rowDone.atIso })}`,
    };
  }
  const facts = factsHalf({ ageOf, card, exact: reading?.schemaVersion !== undefined, row });
  const steers = steersHalf({ ageOf, covered });
  const reacted = "row" in covered ? reactedOf({ ageOf, covered, said: steers.said }) : undefined;
  if (reacted !== undefined) {
    return reacted;
  }
  const done = rowDone === undefined ? undefined : doneSentence({ ageOf, done: rowDone });
  const fresh = facts.passed && steers.half.passed;
  const lines = checkedLines({ done, facts: facts.line, stale: !fresh, steers: steers.half.line });
  const unread = row === undefined ? [] : unreadOf({ ageOf, row });
  const base = { lines, said: steers.said, title: lines.join("\n"), unread };
  if (facts.passed && steers.half.passed) {
    // The older of the two is the bound on how fresh the card is.
    const older = [facts.iso, steers.half.iso].toSorted((a, b) => a.localeCompare(b)).at(0)!;
    return { ...base, fresh: true, kind: "fresh", words: `fresh · checked ${ageOf({ iso: older })}` };
  }
  if (facts.passed) {
    return {
      ...base,
      fresh: false,
      kind: "facts-only",
      words: `facts checked ${ageOf({ iso: facts.iso })} · not your steers`,
    };
  }
  if (steers.half.passed) {
    return {
      ...base,
      fresh: false,
      kind: "steers-only",
      words: `your steers checked ${ageOf({ iso: steers.half.iso })} · not its facts`,
    };
  }
  // A check ran over this card and neither half passed: say WHAT failed, never "not checked yet" and never an age. An
  // age there read as the check being late, when the check was seconds old and both halves had simply failed: every
  // card on the owner's Queue once wore "checked 67s ago · not fresh", which told the owner nothing to act on.
  if ("reading" in covered) {
    return {
      ...base,
      fresh: false,
      kind: "unchecked",
      words: `${facts.failedWords} · ${steers.half.failedWords}`,
    };
  }
  return { ...base, fresh: false, kind: "unchecked", words: "not checked yet" };
}

/**
 * Every read inside the check that failed — each place what the owner said is read from that would not, a done-check that
 * could not read, and a fact's own failed read — with the producer's reason, every instant in it said as an age. This
 * mark is the one place a producer's raw reason reaches; the card's lines and hover never carry one.
 *
 * @param row the card's row in the reading
 * @returns the facts for one staleness mark; empty when every read answered
 */
function unreadOf({ row, ageOf }: { row: CurrencyCardRow; ageOf: AgeOf }): readonly CurrencyUnread[] {
  const unread: CurrencyUnread[] = row.since.gaps.map((gap) => ({
    subject: "one place what you said since is read from",
    why: agedText({ ageOf, text: gap }),
  }));
  if (row.done?.kind === "could-not-check") {
    unread.push({
      subject: "whether you have replied in its Slack thread",
      why: agedText({ ageOf, text: row.done.why }),
    });
  }
  const factWhy = factUnreadOf({ row });
  if (factWhy !== undefined) {
    unread.push({ subject: "how its facts were checked", why: agedText({ ageOf, text: factWhy }) });
  }
  return unread;
}

/**
 * The reason a not-confirmed fact keeps off the card's own lines: a failed read's own reason, or an older producer's
 * free-text `why`, which the Facts line never prints (`factsHalf`).
 *
 * @param row the card's row in the reading
 * @returns the reason for the staleness mark, or `undefined` when the fact carries none
 */
function factUnreadOf({ row }: { row: CurrencyCardRow }): string | undefined {
  const fact = row.fact;
  if (fact?.kind !== "not-confirmed") {
    return undefined;
  }
  if (fact.unread !== undefined) {
    return fact.unread;
  }
  if (isNotConfirmedWhy({ why: fact.why })) {
    return undefined;
  }
  return fact.why;
}

/**
 * The Checked fold's lines, in their fixed order — never more than {@link CheckedLines} allows.
 *
 * @param done what done means for this card, when an ask stands behind it
 * @param stale whether to close on what a card that is not fresh means
 * @returns the lines
 */
function checkedLines({
  facts,
  steers,
  done,
  stale,
}: {
  facts: string;
  steers: string;
  done: string | undefined;
  stale: boolean;
}): CheckedLines {
  if (done === undefined) {
    return stale ? [facts, steers, MAY_BE_STALE] : [facts, steers];
  }
  return stale ? [facts, steers, done, MAY_BE_STALE] : [facts, steers, done];
}

/**
 * Order the Queue by currency. Move every card that looks answered, opens an ask the owner already ruled on, or carries a
 * word of the owner's filed to it since it reached them, to the check-ins, drawn last: off the waiting count and the
 * sidebar badge, and never opened as something still theirs. Not
 * hidden — a reply the owner sent does not settle the row and a ruling does not mark its step done, the chair does
 * (`handover settle <slug> --as answered --witness <reply link>`, `hand done`), and until then the owner can still see it.
 *
 * And inside each tier the fresh cards lead, so the owner can start with the fresh ones,
 * each tier's own order kept among the fresh and among the rest.
 *
 * The tier is read and written structurally, as a string, so this module imports no queue-row type; `./cardCurrency.ts`
 * remains the import-free base.
 *
 * @param rows every row the registers made, tier-first
 * @param reading the last recorded reading, or `undefined` when none has arrived
 * @returns the rows, fresh first in each tier, a looks-answered, ruled or reacted one re-tiered and moved to the end
 */
export function currencyOrdered<T extends CurrencyCard & { readonly tier: string }>({
  rows,
  reading,
}: {
  rows: readonly T[];
  reading: CurrencyReading | undefined;
}): readonly T[] {
  const marked = rows.map((row) => ({ mark: cardCurrencyOf({ ageOf: () => "", card: row, reading }), row }));
  const answered = ({ mark }: { mark: CardCurrency }): boolean =>
    mark.kind === "looks-answered" || mark.kind === "ruled" || mark.kind === "reacted";
  const waiting = marked.filter((each) => !answered(each));
  const tiers = [...new Set(waiting.map((each) => each.row.tier))];
  const ordered = tiers.flatMap((tier) => {
    const inTier = waiting.filter((each) => each.row.tier === tier);
    return [...inTier.filter((each) => each.mark.fresh), ...inTier.filter((each) => !each.mark.fresh)];
  });
  const out = [
    ...ordered.map((each) => each.row),
    ...marked.filter((each) => answered(each)).map((each) => ({ ...each.row, tier: "check-in" })),
  ];
  // The same rows in the same order keep their identity, so a page comparing snapshots stores none (`useQueueRows`).
  if (out.every((row, index) => row === rows[index])) {
    return rows;
  }
  return out;
}
