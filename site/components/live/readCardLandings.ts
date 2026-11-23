/**
 * The reader for `talk cards --json` — the cards the owner's own spoken words are holding off the owner's queue
 * (`src/talk/cardLanding.ts`).
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never DROP a row. What is different is that the whole reading is used as a FILTER, not drawn, so a
 * landing that does not read refuses the reading rather than being skipped: a skipped landing is a card the owner
 * already steered, drawn in front of the owner again as if the owner never had.
 */

import { type Bag, bags, isBag, str, strings } from "../../lib/bag";
import { type TriageLabel, type TriageVerdict, triageLabelOf, triageVerdictOf } from "../../lib/triageWords";

/**
 * Who landed the words: the transcript at write time, a relay the voice made, a session closing a second card, or the
 * chair's intake mark on a card the voice had open (`src/talk/intakeCardLandings.ts`).
 */
export type CardLandingSource = "transcript" | "relay" | "session" | "intake";

/** The sources `talk cards` publishes; any other value does not read. */
const SOURCES: readonly CardLandingSource[] = ["transcript", "relay", "session", "intake"];

/** One card the owner's words are holding off the queue. */
export interface CardLanding {
  readonly cardKey: string;
  readonly anchor: string;
  readonly words: string;
  readonly decidedIso: string;
  /** When the landing was written — the instant the card left the owner's list. */
  readonly atIso: string;
  /** Who landed the words — what the open panel names as having taken the card off (`../../lib/cardDeparture.ts`). */
  readonly source: CardLandingSource;
  /** The board row acting on the owner's words. */
  readonly workSlug: string;
  /** The anchors of the same utterance's later segments, which this landing also holds the card for. */
  readonly laterAnchors?: readonly string[];
  /**
   * The owner's triage verdict, and inbox-zero label when the owner gave one, when the relay this landing's work row names carried a
   * ruling (`src/talk/cardLandingTriage.ts`): a park draws the card parked rather than gone. Absent on every other landing.
   */
  readonly triage?: TriageMark;
}

/** The owner's triage ruling as a landing carries it: the verdict, and the label when the owner gave one. */
export interface TriageMark {
  readonly verdict: TriageVerdict;
  readonly label?: TriageLabel;
}

/**
 * One card the Queue walk moved on from (`src/talk/cardMoveLedger.ts`), off the owner's queue until a restore: a queue card is dropped when the walk moves on to the next one, unless the owner says to come back to it.
 * It carries no work row: the walk moved, nobody was handed anything.
 */
export interface CardMove {
  readonly cardKey: string;
  readonly anchor: string;
  /** The card the walk moved to. */
  readonly toCardKey: string;
  /** When the walk moved. */
  readonly decidedIso: string;
  /** When the move was first written — the instant the card left the owner's list. */
  readonly atIso: string;
  /** The owner's words over the card, as the call file holds them; absent when the owner said nothing over it. */
  readonly words?: string;
}

/**
 * One ledger line the verb could not read, with the card key and instant it recorded, verbatim and unvalidated — absent
 * when it recorded no string one (`src/talk/cardLedgerFile.ts`).
 */
export interface CardLedgerGap {
  readonly lineNumber: number;
  readonly cardKey: string | undefined;
  readonly atIso: string | undefined;
}

/** What the queue filters by. */
export interface CardLandings {
  readonly landings: readonly CardLanding[];
  /** The Queue walk's moves still holding a card off. */
  readonly moves: readonly CardMove[];
  /** How many ledger lines the verb could not read, in either ledger — a partial overlay the page says it is. */
  readonly unreadable: number;
  /** Those same lines, landings' then moves', each with the card it recorded: a gap only where that card is read. */
  readonly unreadableLines: readonly CardLedgerGap[];
  /**
   * How many relay ledger lines the verb could not read — any of which may be the only record of a park, so a card the owner
   * parked may be drawn as gone, which the page says it is.
   */
  readonly triageUnreadable: number;
}

/**
 * A landing's triage mark: absent on a landing whose relay carried no ruling.
 *
 * @param row the landing
 * @returns `absent`, the mark, or `undefined` when the field is there and does not read
 */
function triageOf({ row }: { row: Bag }): TriageMark | "absent" | undefined {
  if (!("triage" in row)) {
    return "absent";
  }
  const triage = row["triage"];
  if (!isBag(triage)) {
    return undefined;
  }
  const verdict = triageVerdictOf({ value: triage["verdict"] });
  if (verdict === undefined) {
    return undefined;
  }
  if (!("label" in triage)) {
    return { verdict };
  }
  const label = triageLabelOf({ value: triage["label"] });
  if (label === undefined) {
    return undefined;
  }
  return { label, verdict };
}

/**
 * A landing's later-segment anchors: absent on a one-segment utterance, which carries none.
 *
 * @param row the landing
 * @returns the anchors, an empty list when the field is absent, or `undefined` when it is there and does not read
 */
function laterAnchorsOf({ row }: { row: Bag }): readonly string[] | undefined {
  if (!("laterAnchors" in row)) {
    return [];
  }
  return strings({ bag: row, key: "laterAnchors" });
}

/**
 * The walk's moves: every one must read, as every landing must, since a skipped move is a card the owner moved on from
 * drawn in front of the owner again.
 *
 * @param payload the verb's parsed stdout
 * @returns the moves, or `undefined` when the list is missing or any move in it does not read
 */
function movesOf({ payload }: { payload: Bag }): readonly CardMove[] | undefined {
  const rows = bags({ bag: payload, key: "moves" });
  if (rows === undefined) {
    return undefined;
  }
  const moves: CardMove[] = [];
  for (const row of rows) {
    const cardKey = str({ bag: row, key: "cardKey" });
    const anchor = str({ bag: row, key: "anchor" });
    const toCardKey = str({ bag: row, key: "toCardKey" });
    const decidedIso = str({ bag: row, key: "decidedIso" });
    const atIso = str({ bag: row, key: "atIso" });
    const spoke = "words" in row;
    const words = str({ bag: row, key: "words" });
    if (
      cardKey === undefined ||
      anchor === undefined ||
      toCardKey === undefined ||
      decidedIso === undefined ||
      atIso === undefined ||
      (spoke && words === undefined)
    ) {
      return undefined;
    }
    const move: CardMove = { anchor, atIso, cardKey, decidedIso, toCardKey };
    moves.push(words === undefined ? move : { ...move, words });
  }
  return moves;
}

/**
 * A ledger's refused lines: every one must read, since a dropped one is a gap the page would stop naming.
 *
 * @param payload the verb's parsed stdout
 * @param key the field the ledger's lines sit under
 * @returns the lines, or `undefined` when the list is missing or any entry in it does not read
 */
function ledgerGapsOf({ payload, key }: { payload: Bag; key: string }): readonly CardLedgerGap[] | undefined {
  const entries = bags({ bag: payload, key });
  if (entries === undefined) {
    return undefined;
  }
  const gaps: CardLedgerGap[] = [];
  for (const entry of entries) {
    const lineNumber = entry["lineNumber"];
    const cardKey = entry["cardKey"];
    const atIso = entry["atIso"];
    if (
      typeof lineNumber !== "number" ||
      !Number.isInteger(lineNumber) ||
      lineNumber < 1 ||
      (cardKey !== undefined && typeof cardKey !== "string") ||
      (atIso !== undefined && typeof atIso !== "string")
    ) {
      return undefined;
    }
    gaps.push({ atIso, cardKey, lineNumber });
  }
  return gaps;
}

/** Whether a ledger's described lines are exactly the line numbers it counted, in the same order. */
function describesEveryLine({
  counted,
  gaps,
}: {
  counted: readonly unknown[];
  gaps: readonly CardLedgerGap[];
}): boolean {
  return counted.length === gaps.length && counted.every((line, index) => line === gaps[index].lineNumber);
}

/**
 * Project `talk cards --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the landings, or `undefined` when the payload or any landing in it does not read
 */
export function readCardLandings(payload: unknown): CardLandings | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "landings" });
  const moves = movesOf({ payload });
  const unreadable = payload["unreadable"];
  const movesUnreadable = payload["movesUnreadable"];
  const triageUnreadable = payload["triageUnreadable"];
  const landingGaps = ledgerGapsOf({ key: "unreadableLines", payload });
  const moveGaps = ledgerGapsOf({ key: "movesUnreadableLines", payload });
  if (
    rows === undefined ||
    moves === undefined ||
    landingGaps === undefined ||
    moveGaps === undefined ||
    !Array.isArray(movesUnreadable) ||
    !Array.isArray(unreadable) ||
    typeof triageUnreadable !== "number" ||
    !Number.isInteger(triageUnreadable) ||
    triageUnreadable < 0
  ) {
    return undefined;
  }
  // A refused line counted but not described would be a gap no surface names, so the two must name the same lines
  // in the same order.
  if (
    !describesEveryLine({ counted: unreadable, gaps: landingGaps }) ||
    !describesEveryLine({ counted: movesUnreadable, gaps: moveGaps })
  ) {
    return undefined;
  }
  const landings: CardLanding[] = [];
  for (const row of rows) {
    const cardKey = str({ bag: row, key: "cardKey" });
    const anchor = str({ bag: row, key: "anchor" });
    const words = str({ bag: row, key: "words" });
    const decidedIso = str({ bag: row, key: "decidedIso" });
    const workSlug = str({ bag: row, key: "workSlug" });
    const atIso = str({ bag: row, key: "atIso" });
    const source = SOURCES.find((one) => one === str({ bag: row, key: "source" }));
    const laterAnchors = laterAnchorsOf({ row });
    const triage = triageOf({ row });
    if (
      cardKey === undefined ||
      anchor === undefined ||
      words === undefined ||
      decidedIso === undefined ||
      workSlug === undefined ||
      atIso === undefined ||
      source === undefined ||
      laterAnchors === undefined ||
      triage === undefined
    ) {
      return undefined;
    }
    const landing: CardLanding = { anchor, atIso, cardKey, decidedIso, laterAnchors, source, words, workSlug };
    landings.push(triage === "absent" ? landing : { ...landing, triage });
  }
  return {
    landings,
    moves,
    triageUnreadable,
    unreadable: unreadable.length + movesUnreadable.length,
    unreadableLines: [...landingGaps, ...moveGaps],
  };
}
