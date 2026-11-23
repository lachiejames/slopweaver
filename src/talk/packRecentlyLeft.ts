/**
 * The talk pack's half of "a card that left the owner's Queue is still found": the cards that left it in the last
 * day, each marked removed with when and why. Split out of `./contextPack.ts` (the file-size ratchet) along that
 * seam; the section that renders them stays there with the others.
 *
 * The rule: something that is in the queue but was removed must still be visible to the voice. Pure: every input is
 * already read. No filesystem, no clock.
 */

import { waitsOnOwner } from "../handover/ownerWait.js";
import { carriesMachineId } from "../pages/machineIds.js";
import { type CardLandedRow, type CardLandingSource, cardKeyParts } from "./cardLanding.js";
import type { CardMovedOnRow } from "./cardMoveLedger.js";
import { clip, withinLookback } from "./packText.js";

/** One card that left the owner's Queue in the last day, marked removed — history the voice can still find, never an ask. */
export interface PackRecentlyLeft {
  readonly key: string;
  /** What the card was about, when the register that dated its removal still says. */
  readonly about: string | undefined;
  /** When it left — the earliest event a register evidences took it off. */
  readonly removedIso: string;
  readonly why: string;
}

/** Where the owner's words and a settle's witness are cut, in characters. */
const WHY_CHARS = 300;

/** Who a landing's source names, as the recently-left line says it. */
const LANDED_BY: Readonly<Record<CardLandingSource, string>> = {
  intake: "the owner's words over the card the voice opened, recorded by the chair,",
  relay: "the owner's words, relayed by the voice,",
  session: "a session, landing the owner's words from another card,",
  transcript: "the owner's words, heard by the voice with this card open,",
};

/** One board row as `handover list --json` publishes it, the fields this half reads. */
interface LeftRow {
  readonly slug: string;
  readonly kind: string;
  readonly ownerWait: string;
  readonly problem: string | undefined;
  readonly summary: string | undefined;
  readonly question: string | undefined;
  readonly settlement: string | undefined;
  readonly settlementWitness: string | undefined;
  readonly settledIso: string | undefined;
  readonly ruledBeforeSettleIso: string | undefined;
  readonly ruledBeforeSettleWords: string | undefined;
  readonly ruledSinceQuestionIso: string | undefined;
  /** The rest of the decision shape the card draws, read only to judge whether the card gate refused it. */
  readonly options?: readonly { readonly option: string; readonly tradeoff: string }[];
  readonly lean?: string | undefined;
  readonly examples?: readonly string[];
  readonly exampleGap?: string | undefined;
}

/**
 * What a row's card was about: its summary, else the question it asked — the card the console draws from the same
 * row says the same (`site/lib/recentQueueDepartures.ts`).
 *
 * @param row the board row
 * @returns the text, or `undefined` when the row carries neither
 */
function aboutOfRow({ row }: { row: Pick<LeftRow, "question" | "summary"> }): string | undefined {
  if (row.summary !== undefined) {
    return row.summary;
  }
  return row.question;
}

/**
 * Whether an ask was ever the owner's card: it carries the decision shape, or its run still has its question open — the
 * console's own test (`site/lib/recentQueueDepartures.ts` `wasOwners`).
 *
 * @param row the board row
 * @returns true for an ask that was the owner's
 */
function wasOwners({ row }: { row: Pick<LeftRow, "ownerWait" | "problem"> }): boolean {
  return row.problem !== undefined || row.ownerWait === "settled";
}

/**
 * How an ask that was the owner's left their Queue by the board alone: ruled and not yet settled, by that ruling;
 * settled, by the ruling the owner made first when they made one, since a ruled ask is off it before a session
 * settles it, else by the settle.
 *
 * Only an ask that WAS the owner's: one carrying the decision shape, or one whose run still has its question open. A
 * voice relay row is neither and was never a card, so settling one removes nothing from the Queue.
 *
 * @param row the board row
 * @returns the removal, or `undefined` for a row that is no settled ask of the owner's, or whose settle is undated
 */
function settledRemoval({ row }: { row: LeftRow }): PackRecentlyLeft | undefined {
  const { settlement, settlementWitness, settledIso, ruledBeforeSettleIso, ruledBeforeSettleWords } = row;
  const drawnAsAsk = row.kind === "ask" || row.question !== undefined;
  if (drawnAsAsk && row.ownerWait === "already-ruled" && row.ruledSinceQuestionIso !== undefined) {
    // Ruled and not yet settled: off the owner's Queue from the ruling, since it waits on a session now — a run of any
    // kind whose question the Queue drew as the owner's ask included.
    return {
      about: aboutOfRow({ row }),
      key: `ask:${row.slug}`,
      removedIso: row.ruledSinceQuestionIso,
      why: "the owner ruled on it; it waits on a session to execute that",
    };
  }
  // Any kind that was the owner's card: a run that ended carrying the owner's question settled that card off.
  if (!wasAskCard({ row }) || !wasOwners({ row })) {
    return undefined;
  }
  if (settlement === undefined || settlementWitness === undefined || settledIso === undefined) {
    return undefined;
  }
  const key = `ask:${row.slug}`;
  const settled = `settled ${settlement}: ${clip({ max: WHY_CHARS, text: settlementWitness })}`;
  // A ruling instant that does not parse never displaces the settle's.
  const ruled = ruledBeforeSettleIso === undefined ? Number.NaN : Date.parse(ruledBeforeSettleIso);
  if (ruledBeforeSettleIso === undefined || ruledBeforeSettleWords === undefined || Number.isNaN(ruled)) {
    return { about: aboutOfRow({ row }), key, removedIso: settledIso, why: settled };
  }
  const words = clip({ max: WHY_CHARS, text: ruledBeforeSettleWords });
  return {
    about: aboutOfRow({ row }),
    key,
    removedIso: ruledBeforeSettleIso,
    why: `the owner ruled on it ("${words}"), then it ${settled}`,
  };
}

/**
 * Whether a board row was ever the owner's ask card. An ask is a card only by its board row, as the console draws one
 * only from it: a voice relay row — open or settled, no decision shape, no question, nothing waiting on the owner —
 * was never one, and neither is an ask the board carries no row for, so no landing on either left the owner's Queue.
 * Any row of any kind waiting on the owner with a question is drawn as one, as `site/lib/ownerAsks.ts` `ownerAsksOf`
 * does, and stays one once the owner has ruled on that question or the run ended still carrying it.
 *
 * @param row the board row
 * @returns true for a row the console drew, or would have drawn, as the owner's ask
 */
function wasAskCard({ row }: { row: LeftRow }): boolean {
  const askedWait =
    waitsOnOwner({ ownerWait: row.ownerWait }) || row.ownerWait === "already-ruled" || row.ownerWait === "settled";
  const drawnAsOwners = askedWait && row.question !== undefined;
  const settledNotOwners = row.settlement !== undefined && !wasOwners({ row });
  const openNotOwners = row.problem === undefined && row.question === undefined && row.ownerWait === "not-waiting";
  return drawnAsOwners || (row.kind === "ask" && !settledNotOwners && !openNotOwners);
}

/**
 * Whether the console's card gate refused this row's card, judged on every line of prose the board row carries for
 * it (`site/lib/machineIdForm.ts`): a refused card is held off the owner's Queue (`site/lib/queueWithholding.ts`), so it never
 * left it and is never listed as having left.
 *
 * @param row the board row
 * @returns true when any of its card's prose names something by a raw machine id
 */
function refusedCard({ row }: { row: LeftRow }): boolean {
  const texts: (string | undefined)[] = [row.summary, row.question, row.problem, row.lean, row.exampleGap];
  if (row.options !== undefined) {
    texts.push(...row.options.flatMap((option) => [option.option, option.tradeoff]));
  }
  if (row.examples !== undefined) {
    texts.push(...row.examples);
  }
  return texts.some((text) => text !== undefined && carriesMachineId({ text }));
}

/**
 * The cards that left the owner's Queue in the last day, each marked removed with when and why: a card the owner's
 * words still hold off it, a card the Queue walk moved on from, and an ask that was the owner's settled off it. A card
 * several registers evidence is named once, by the EARLIEST — the event that actually took it off — so a landing
 * written after a settle never takes the settle's place, nor the reverse. Only what a ledger evidences: a sent draft
 * or a done step the owner's words landed on before this build is here though the console has no row left to draw.
 *
 * The ledgers as they stood at build, and no more: a steer the console page collapsed and then saw come back draws
 * the card again (`site/lib/steeredCards.ts`), and only that page holds it. So no line says a session is acting on
 * the card, and the section sends the voice to `read_card`, which resolves a card back on the Queue as live.
 *
 * @param landings the landings still holding a card off the owner's Queue (`./cardLanding.ts` `activeCardLandings`)
 * @param moves the Queue walk's moves still holding a card off it (`./cardMoveLedger.ts` `activeCardMoves`)
 * @param rows the board's rows, as `handover list --json` publishes them
 * @param nowIso the end of the look-back window
 * @returns the departed cards, newest removal first
 */
export function packRecentlyLeftOf({
  landings,
  moves,
  rows: allRows,
  nowIso,
}: {
  landings: readonly Pick<CardLandedRow, "atIso" | "cardKey" | "source" | "words" | "workSlug">[];
  moves: readonly Pick<CardMovedOnRow, "atIso" | "cardKey" | "toCardKey" | "words">[];
  rows: readonly LeftRow[];
  nowIso: string;
}): readonly PackRecentlyLeft[] {
  // A refused card was held off the owner's Queue, so neither its settle nor a landing on it took it off.
  const rows = allRows.filter((row) => !refusedCard({ row }));
  const aboutOf = new Map<string, string | undefined>(rows.map((row) => [`ask:${row.slug}`, aboutOfRow({ row })]));
  const askCards = new Set(rows.filter((row) => wasAskCard({ row })).map((row) => `ask:${row.slug}`));
  // An ask key the board never drew as the owner's card never left the owner's Queue.
  const drawn = ({ cardKey }: { cardKey: string }): boolean =>
    cardKeyParts({ cardKey })?.kind !== "ask" || askCards.has(cardKey);
  // Settles first, so a landing at the settle's own instant does not take its place: a landing is the why only when
  // it came BEFORE, as the console holds. The Queue walk's moves come last, and
  // the earliest departure still wins, as every other register's does.
  const settles = rows.flatMap((row) => {
    const removal = settledRemoval({ row });
    return removal === undefined ? [] : [removal];
  });
  const landed = landings
    .filter((landing) => drawn({ cardKey: landing.cardKey }))
    .map((landing) => ({
      about: aboutOf.get(landing.cardKey),
      key: landing.cardKey,
      removedIso: landing.atIso,
      why: `${LANDED_BY[landing.source]} landed on it ("${clip({ max: WHY_CHARS, text: landing.words })}"); handed to ${landing.workSlug}`,
    }));
  const moved = moves
    .filter((move) => drawn({ cardKey: move.cardKey }))
    .map((move) => ({
      about: aboutOf.get(move.cardKey),
      key: move.cardKey,
      removedIso: move.atIso,
      why: movedWhy({ move }),
    }));
  return inTheDay({ entries: earliestPerKey({ entries: [...settles, ...landed, ...moved] }), nowIso }).toSorted(
    (one, other) => Date.parse(other.removedIso) - Date.parse(one.removedIso),
  );
}

/**
 * Why a card the Queue walk moved on from left, with the owner's words over it when they said any.
 *
 * @param move the move
 * @returns the line
 */
function movedWhy({ move }: { move: Pick<CardMovedOnRow, "toCardKey" | "words"> }): string {
  if (move.words === undefined) {
    return `moved on to ${move.toCardKey} during the Queue walk`;
  }
  return `moved on to ${move.toCardKey} during the Queue walk after saying "${clip({ max: WHY_CHARS, text: move.words })}"`;
}

/**
 * One removal per card, the earliest; on a tie the one given first stays. An instant that does not parse never
 * displaces one that does, as the console's `isEarlier` holds.
 *
 * @param entries the removals, in precedence order
 * @returns one per card, in the order the cards were first given
 */
function earliestPerKey({ entries }: { entries: readonly PackRecentlyLeft[] }): readonly PackRecentlyLeft[] {
  const out = new Map<string, PackRecentlyLeft>();
  for (const left of entries) {
    const before = out.get(left.key);
    if (before === undefined || isEarlier({ at: left.removedIso, than: before.removedIso })) {
      out.set(left.key, left);
    }
  }
  return [...out.values()];
}

/**
 * Whether one instant is strictly earlier than another, an unparseable instant never earlier than a parseable one.
 *
 * @param at the instant that would win
 * @param than the instant it would displace
 * @returns whether it wins
 */
function isEarlier({ at, than }: { at: string; than: string }): boolean {
  const atMs = Date.parse(at);
  const thanMs = Date.parse(than);
  return !Number.isNaN(atMs) && (Number.isNaN(thanMs) || atMs < thanMs);
}

/**
 * The entries removed inside the day ending at `nowIso`, each instant canonical — `Date.parse` rolls a date no
 * calendar has (`02-30`) into a real one, so a line says the instant measured, never the text a hand-edited doc or a
 * stored pack carried.
 *
 * @param entries the removals to judge
 * @param nowIso the end of the day
 * @returns the removals inside it, in their given order
 */
export function inTheDay({
  entries,
  nowIso,
}: {
  entries: readonly PackRecentlyLeft[];
  nowIso: string;
}): readonly PackRecentlyLeft[] {
  return entries
    .filter((left) => withinLookback({ atIso: left.removedIso, nowIso }))
    .map((left) => ({ ...left, removedIso: new Date(Date.parse(left.removedIso)).toISOString() }));
}
