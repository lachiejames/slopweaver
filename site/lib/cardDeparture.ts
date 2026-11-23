/**
 * Why a card the owner has OPEN left their list, and who took it — pure: the open key and the page's own readings in,
 * the departure out.
 *
 * A card must not vanish while the owner is still reacting to it, and the owner must be able to tell whether the voice,
 * the supervisor or a session acted. Measured on one call's ledger: an aside about the bot, said with a card open,
 * landed on it through the transcript; a mouth noise landed on another card; and a relay of the owner's words on that
 * card collapsed it, which closed the panel. Neither the supervisor nor a recorder re-check touched either card, and
 * the page said none of it — its gone note guessed "it was sent or dropped" over a register that still held the draft.
 *
 * So an open card stays drawn until the owner leaves it (`../components/console/QueuePanels.tsx`), and this module
 * names the cause from the same readings the page filtered by — never a generic sentence where one of those
 * readings says something more exact. A card no register holds any more is `register`: its panel keeps its own
 * register's word, and says no ledger it reads names who did it.
 */

import type { CardLanding, CardLandingSource, CardLandings } from "../components/live/readCardLandings";
import type { LiveState } from "../components/live/useLive";
import { isAlignmentRow } from "./alignment";
import { rowForOpen, rowOpensAs } from "./queueOpen";
import type { QueueRow } from "./queueRows";
import { placementWaits } from "./registerPlacement";
import type { SteerOverlay } from "./steeredCards";

/** How much of the owner's words a departure quotes: enough to recognise an aside or a mouth noise, never the whole. */
const WORDS_CLIP = 160;

/** One of the owner's utterances holding the card off their list. */
export interface DepartureHold {
  /** Who put the words on the card, in the page's own words. */
  readonly who: string;
  readonly words: string;
  /** When it took the card off — the landing's write instant. */
  readonly atIso: string;
  /** The board row a session acts on the owner's words through. */
  readonly workSlug: string;
}

/** Why an open card left the owner's list. */
export type CardDeparture =
  /** The owner's words landed on it; the first hold is the one that took it off, the rest hold it too. */
  | { readonly kind: "words"; readonly holds: readonly DepartureHold[] }
  /** The owner's words landed on it, but the steer carrying them came back: no session picked it up, and it stays off. */
  | { readonly kind: "unpicked"; readonly hold: DepartureHold }
  /** A steer this browser sent over it collapsed it before the landing reading caught up. */
  | {
      readonly kind: "steer";
      readonly heard: string;
      readonly sentAtIso: string;
      readonly relaySlug: string | undefined;
    }
  /** Its register's latest read failed, so the page drew the rest from an earlier reading. Nobody took it. */
  | { readonly kind: "kept" }
  /** It waits on the board to be placed. Nobody took it. */
  | { readonly kind: "placing" }
  /** A register still holds it and none of the page's readings says why it is not drawn. */
  | { readonly kind: "held" }
  /** An act: the Alignment page draws it, never the Queue. Nobody took it. */
  | { readonly kind: "alignment" }
  /** No register holds it any more: its panel keeps the register's own word, and no ledger the page reads names who. */
  | { readonly kind: "register" };

/**
 * Who a landing's source names.
 *
 * @param source the landing's source
 * @returns the words the panel opens its line with
 */
export function landingWho({ source }: { source: CardLandingSource }): string {
  if (source === "transcript") {
    return "Your words, heard by the voice with this card open";
  }
  if (source === "relay") {
    return "Your words, relayed by the voice";
  }
  if (source === "intake") {
    return "Your words over the card the voice opened, recorded by the chair";
  }
  return "A session, landing your words from another card";
}

/**
 * The owner's words, clipped to what a line can carry.
 *
 * @param words the owner's words, whole
 * @returns at most {@link WORDS_CLIP} characters, an ellipsis marking a cut
 */
export function clippedWords({ words }: { words: string }): string {
  const trimmed = words.trim();
  if (trimmed.length <= WORDS_CLIP) {
    return trimmed;
  }
  return `${trimmed.slice(0, WORDS_CLIP - 1).trimEnd()}…`;
}

/**
 * One card's landings, earliest written first, split by the page's own rule (`./cardLandings.ts` `unlandedRows`):
 * those whose steer is still in flight, and those carrying a steer that came back on THIS card. Neither while a steer
 * that came back draws the card again.
 *
 * @param landings the `talk cards` reading's landings
 * @param key the open card
 * @param steers the steers that came back, and the cards one draws again
 * @returns the landings holding it, and those whose steer was not picked up
 */
export function landingsOn({
  landings,
  key,
  steers,
}: {
  landings: readonly CardLanding[];
  key: string;
  steers: Pick<SteerOverlay, "cameBack" | "revealed">;
}): { readonly holding: readonly CardLanding[]; readonly unpicked: readonly CardLanding[] } {
  if (steers.revealed.has(key)) {
    return { holding: [], unpicked: [] };
  }
  const failed = new Set(steers.cameBack.filter((one) => one.cardKey === key).map((one) => `talk:${one.turnId}`));
  const onCard = landings
    .filter((landing) => landing.cardKey === key)
    .toSorted((one, other) => Date.parse(one.atIso) - Date.parse(other.atIso));
  const cameBack = (landing: CardLanding): boolean =>
    failed.has(landing.anchor) || landing.laterAnchors?.some((anchor) => failed.has(anchor)) === true;
  return { holding: onCard.filter((landing) => !cameBack(landing)), unpicked: onCard.filter(cameBack) };
}

/**
 * A landing as the line the panel draws.
 *
 * @param landing the landing
 * @returns the hold
 */
function holdOf({ landing }: { landing: CardLanding }): DepartureHold {
  return {
    atIso: landing.atIso,
    who: landingWho({ source: landing.source }),
    words: clippedWords({ words: landing.words }),
    workSlug: landing.workSlug,
  };
}

/**
 * The steer hiding a card, by the page's own rule: only while the newest steer on it is collapsed, and then that one
 * — never the first in storage order, nor one an earlier steer left behind.
 *
 * @param key the card
 * @param steers the steers' overlay
 * @returns the newest collapsed steer on the card, or `undefined` when no steer hides it
 */
function hidingSteer({
  key,
  steers,
}: {
  key: string;
  steers: Pick<SteerOverlay, "collapsed" | "hidden">;
}): SteerOverlay["collapsed"][number] | undefined {
  if (!steers.hidden.has(key)) {
    return undefined;
  }
  return steers.collapsed
    .filter((row) => row.cardKey === key)
    .toSorted((one, other) => Date.parse(other.sentAtIso) - Date.parse(one.sentAtIso))[0];
}

/**
 * Why the open card is not in the list the page draws, from the readings the page filtered by, most exact first:
 * the owner's words while a landing still holds it — whether or not a register still does, so a session settling the
 * row after the owner's words landed never erases who took it — then a steer still hiding it.
 *
 * @param key the open card's key
 * @param held the row a register holds under that key NOW, or `undefined` when none does
 * @param spoken the `talk cards` reading
 * @param steers the steers' overlay
 * @param board the board reading a hand step's or act's placement joins
 * @param kept the row kinds the page drew from an earlier reading over a failed poll
 * @returns the departure — `register` when no register holds the card and no reading names who took it
 */
export function cardDeparture({
  key,
  held,
  spoken,
  steers,
  board,
  kept,
}: {
  key: string;
  held: { readonly kind: QueueRow["kind"]; readonly record: { readonly kind: string } } | undefined;
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed">;
  board: LiveState<unknown>;
  kept: readonly QueueRow["kind"][];
}): CardDeparture {
  let unpicked: readonly CardLanding[] = [];
  if (spoken.phase === "ready") {
    const split = landingsOn({ key, landings: spoken.value.landings, steers });
    if (split.holding.length > 0) {
      return { holds: split.holding.map((landing) => holdOf({ landing })), kind: "words" };
    }
    unpicked = split.unpicked;
  }
  const steer = hidingSteer({ key, steers });
  if (steer !== undefined) {
    return {
      heard: clippedWords({ words: steer.heard }),
      kind: "steer",
      relaySlug: steer.relaySlug,
      sentAtIso: steer.sentAtIso,
    };
  }
  // Only landings whose steer came back hold it: name the newest, which holds it now whatever took it off first.
  const newest = unpicked.at(-1);
  if (newest !== undefined) {
    return { hold: holdOf({ landing: newest }), kind: "unpicked" };
  }
  if (held === undefined) {
    return { kind: "register" };
  }
  if (isAlignmentRow({ row: held })) {
    return { kind: "alignment" };
  }
  if (placementWaits({ board, row: held })) {
    return { kind: "placing" };
  }
  if (kept.includes(held.kind)) {
    return { kind: "kept" };
  }
  return { kind: "held" };
}

/**
 * The row an open panel draws once the list no longer does: its snapshot while that still answers to the key, else —
 * reloaded, or deep-linked to a card already off the list — the row a register holds in this work context.
 *
 * @param open the key `?open=` names
 * @param snapshot the row the panel last drew
 * @param held the row a register holds under the key now
 * @param shows whether this work context draws a row
 * @returns the row to draw gone, or `undefined` when there is none this context may draw
 */
export function departedRow({
  open,
  snapshot,
  held,
  shows,
}: {
  open: string;
  snapshot: QueueRow | undefined;
  held: QueueRow | undefined;
  shows: (row: QueueRow) => boolean;
}): QueueRow | undefined {
  if (snapshot !== undefined && rowOpensAs({ open, row: snapshot })) {
    return snapshot;
  }
  if (held !== undefined && shows(held)) {
    return held;
  }
  return undefined;
}

/**
 * The row the open panel draws, live or gone — what the voice reads as the open card, so it never hears of a card
 * other than the one on the owner's screen, nor of none while a panel is drawn.
 *
 * @param open the key `?open=` names, or `null`
 * @param live the row the list still draws under that key
 * @param snapshot the row the panel last drew
 * @param every every row every register holds
 * @param shows whether this work context draws a row
 * @returns the row, or `undefined` when no panel draws one
 */
export function panelRow({
  open,
  live,
  snapshot,
  every,
  shows,
}: {
  open: string | null;
  live: QueueRow | undefined;
  snapshot: QueueRow | undefined;
  every: readonly QueueRow[];
  shows: (row: QueueRow) => boolean;
}): QueueRow | undefined {
  if (live !== undefined || open === null) {
    return live;
  }
  return departedRow({ held: rowForOpen({ open, rows: every }), open, shows, snapshot });
}

/**
 * What the voice's reading says of the open card when the page draws it from its snapshot: why it left and who took
 * it, or `undefined` while it is still in the list (or nothing is open).
 *
 * @param open the key `?open=` names, or `null`
 * @param live the row the list still draws under that key
 * @param snapshot the row the panel last drew
 * @param every every row every register holds
 * @param shows whether this work context draws a row — the panel's own test, so the voice and the panel agree
 * @returns the sentence, or `undefined`
 */
export function openLeftSentence({
  open,
  live,
  snapshot,
  every,
  shows,
  spoken,
  steers,
  board,
  kept,
}: {
  open: string | null;
  live: QueueRow | undefined;
  snapshot: QueueRow | undefined;
  every: readonly QueueRow[];
  shows: (row: QueueRow) => boolean;
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed">;
  board: LiveState<unknown>;
  kept: readonly QueueRow["kind"][];
}): string | undefined {
  if (open === null || live !== undefined) {
    return undefined;
  }
  const held = rowForOpen({ open, rows: every });
  const shown = departedRow({ held, open, shows, snapshot });
  if (shown === undefined) {
    return undefined;
  }
  return departureSentence({ departure: cardDeparture({ board, held, kept, key: shown.key, spoken, steers }) });
}

/**
 * The departure as one plain sentence, for the voice's reading of the open card — so it never asks the owner to rule on
 * a card their words already took off the list. Addressed to the owner, as the voice will say it. It dates the words
 * that hold the card, never the instant it left: words said on a panel already off the list would claim a later one.
 *
 * @returns the sentence
 */
export function departureSentence({ departure }: { departure: CardDeparture }): string {
  if (departure.kind === "register") {
    return "No register holds this card any more; unless your own press did it, nothing the page reads names who removed it.";
  }
  if (departure.kind === "alignment") {
    return "It is an act, which the Alignment page draws rather than the Queue; nobody took it.";
  }
  if (departure.kind === "words") {
    const first = departure.holds[0];
    return `Off your list, held there by ${first.who.toLowerCase()} at ${first.atIso} ("${first.words}"), and a session acts on it as ${first.workSlug}. It stays open until you close it.`;
  }
  if (departure.kind === "unpicked") {
    const { hold } = departure;
    return `Off your list, held there by ${hold.who.toLowerCase()} at ${hold.atIso} ("${hold.words}"), which no session picked up. It stays open until you close it.`;
  }
  if (departure.kind === "steer") {
    return `Off your list, held there by your words, relayed by the voice at ${departure.sentAtIso} ("${departure.heard}"). It stays open until you close it.`;
  }
  if (departure.kind === "kept") {
    return "Its register's latest read failed, so it is drawn from an earlier reading; nobody took it.";
  }
  if (departure.kind === "placing") {
    return "It waits on the board to be placed; nobody took it.";
  }
  return "A register still holds it, and nothing the page reads says why it is not in the list.";
}
