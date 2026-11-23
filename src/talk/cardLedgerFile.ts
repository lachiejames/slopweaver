/**
 * The one on-disk shape both card ledgers share — the card-landing ledger (`./cardLandingStore.ts`) and the moved-on
 * ledger (`./cardMoveStore.ts`): append-only JSONL under the home's `talk/` directory, the directory `0700` and the
 * file `0600` because a row can repeat the owner's transcribed words, and a line that does not parse COUNTED, never silently
 * dropped — a partial reading would put a card the owner already steered back in front of them.
 *
 * ## A refused line is a gap only where the card it names is read
 *
 * Every refused line is also described by what it still says of itself: the card key and write instant it recorded,
 * when it decodes to an object carrying them. A surface reading one card, or a window of time, judges the gap with
 * that ({@link unreadableCardLinesForKeys}, {@link unreadableCardLinesSince}): a line with no key it can recover is a
 * gap everywhere; a key that is no card key at all names no card any surface can draw, so it is a gap nowhere; a real
 * key is a gap only where that card is read. MEASURED on a home carried through a one-off sanitiser that rewrote names
 * into numbered placeholders with a space in them: 18 lines stopped parsing (13 card keys with a space, 2 moves whose
 * target key had one, 3 moved-on quotes pushed past their cap), none about the card the voice was reading, and the
 * voice told the owner "some recorded steers were unreadable" over every card it read. Repro: `slopweaver talk cards`
 * lists each refused line and its key.
 */
import { chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { ensureDirectory } from "../lib/writeAtomic.js";

import { CARD_KEY } from "./cardKey.js";
import { type CardLandingError, CardLandingErrors } from "./cardLandingErrors.js";

/** One line a card ledger's parser refused, with what the line still says of itself. */
export interface CardLedgerUnreadableLine {
  /** 1-based. */
  readonly lineNumber: number;
  /** The `cardKey` the line recorded, verbatim and unvalidated; `undefined` when it carries no string one. */
  readonly cardKey: string | undefined;
  /** The `atIso` the line recorded, verbatim and unvalidated; `undefined` when it carries no string one. */
  readonly atIso: string | undefined;
}

/** What a read of one card ledger found. */
export interface CardLedgerRead<T> {
  readonly path: string;
  /** Every row that parsed, in file order. */
  readonly rows: readonly T[];
  /** 1-based line numbers that did not parse. */
  readonly unreadable: readonly number[];
  /** The same refused lines, each with the card key and instant it recorded, in file order. */
  readonly unreadableLines: readonly CardLedgerUnreadableLine[];
}

/**
 * What a refused line still says of itself: its recorded card key and instant, when it decoded to an object carrying
 * string ones.
 *
 * @param lineNumber the line's 1-based number
 * @param value the line's decoded JSON, `undefined` when it did not decode
 * @returns the line's description
 */
function unreadableLineOf({ lineNumber, value }: { lineNumber: number; value: unknown }): CardLedgerUnreadableLine {
  if (!isRecord(value)) {
    return { atIso: undefined, cardKey: undefined, lineNumber };
  }
  const cardKey = value["cardKey"];
  const atIso = value["atIso"];
  return {
    atIso: typeof atIso === "string" ? atIso : undefined,
    cardKey: typeof cardKey === "string" ? cardKey : undefined,
    lineNumber,
  };
}

/**
 * The refused lines that bear on a surface reading exactly these cards: every line naming no key it can recover, and
 * every line naming one of them. A line whose recorded key is no card key names no card a surface could draw, so it
 * bears on none.
 *
 * @param lines the refused lines, from {@link readCardLedger}
 * @param cardKeys the cards the surface reads or draws
 * @returns the lines that may hold one of those cards, in their order
 */
export function unreadableCardLinesForKeys({
  lines,
  cardKeys,
}: {
  lines: readonly CardLedgerUnreadableLine[];
  cardKeys: ReadonlySet<string>;
}): readonly CardLedgerUnreadableLine[] {
  return lines.filter(
    (line) => line.cardKey === undefined || (CARD_KEY.test(line.cardKey) && cardKeys.has(line.cardKey)),
  );
}

/**
 * The refused lines that bear on a surface reading every card: every line naming no key it can recover, and every
 * line naming a real card key. A line whose recorded key is no card key is no landing any reader could ever have
 * bound, so it bears on none.
 *
 * @param lines the refused lines, from {@link readCardLedger}
 * @returns the lines that may hold some card, in their order
 */
export function unreadableCardLinesOfAnyCard({
  lines,
}: {
  lines: readonly CardLedgerUnreadableLine[];
}): readonly CardLedgerUnreadableLine[] {
  return lines.filter((line) => line.cardKey === undefined || CARD_KEY.test(line.cardKey));
}

/**
 * The refused lines that bear on a surface reading every card written at or after an instant: every line naming no key
 * it can recover, and every line naming a real card key unless its recorded instant reads and is strictly before
 * `sinceIso`. An instant that does not read, or one in the future, proves nothing, so that line still bears.
 *
 * @param lines the refused lines, from {@link readCardLedger}
 * @param sinceIso the surface's look-back floor
 * @returns the lines that may fall inside the window, in their order
 */
export function unreadableCardLinesSince({
  lines,
  sinceIso,
}: {
  lines: readonly CardLedgerUnreadableLine[];
  sinceIso: string;
}): readonly CardLedgerUnreadableLine[] {
  const floor = Date.parse(sinceIso);
  return lines.filter((line) => {
    if (line.cardKey === undefined) {
      return true;
    }
    if (!CARD_KEY.test(line.cardKey)) {
      return false;
    }
    const at = line.atIso === undefined ? Number.NaN : Date.parse(line.atIso);
    return Number.isNaN(at) || Number.isNaN(floor) || at >= floor;
  });
}

/**
 * Read a whole card ledger. A file that is not there reads as an empty ledger, not a failure.
 *
 * @param path the ledger file
 * @param label what a row is, for the JSON parser's own error
 * @param parse the ledger's row parser, `undefined` for a line that is not a row
 * @returns the rows and the lines that would not parse, or why the file could not be read
 */
export function readCardLedger<T>({
  path,
  label,
  parse,
}: {
  path: string;
  label: string;
  parse: (input: { value: unknown }) => T | undefined;
}): Result<CardLedgerRead<T>, CardLandingError> {
  if (!existsSync(path)) {
    return ok({ path, rows: [], unreadable: [], unreadableLines: [] });
  }
  const rows: T[] = [];
  const unreadable: number[] = [];
  const unreadableLines: CardLedgerUnreadableLine[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        let value: unknown;
        let row: T | undefined;
        try {
          value = safeJsonParse({ label, text: line });
          row = parse({ value });
        } catch {
          row = undefined;
        }
        if (row === undefined) {
          unreadable.push(index + 1);
          unreadableLines.push(unreadableLineOf({ lineNumber: index + 1, value }));
        } else {
          rows.push(row);
        }
      },
      path,
      // A row's words are quoted verbatim, so a byte that is not UTF-8 makes its line unreadable, never repaired.
      strictUtf8: true,
    });
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path }));
  }
  return ok({ path, rows, unreadable, unreadableLines });
}

/**
 * Why a card ledger would refuse this row — it does not round-trip through the ledger's own parser — or `undefined`
 * when it would take it.
 *
 * @param path the ledger file the refusal names
 * @param label what a row is, for the JSON parser's own error
 * @param row the row about to be written
 * @param parse the ledger's row parser
 * @returns the refusal, or `undefined`
 */
export function refusedCardLedgerRow<T>({
  path,
  label,
  row,
  parse,
}: {
  path: string;
  label: string;
  row: T;
  parse: (input: { value: unknown }) => T | undefined;
}): CardLandingError | undefined {
  return refusedLine({ label, line: safeJsonStringify({ label, value: row }), parse, path });
}

/** Why a card ledger would refuse this exact serialised line, or `undefined` when its parser reads it back. */
function refusedLine<T>({
  path,
  label,
  line,
  parse,
}: {
  path: string;
  label: string;
  line: string;
  parse: (input: { value: unknown }) => T | undefined;
}): CardLandingError | undefined {
  if (parse({ value: safeJsonParse({ label, text: line }) }) !== undefined) {
    return undefined;
  }
  return CardLandingErrors.ledgerIo({ cause: new Error(`the row does not read back: ${line}`), path });
}

/**
 * Append one row, serialised ONCE and that exact line round-tripped through the ledger's parser before it is written,
 * so the ledger never holds a line its reader would refuse; the directory is made `0700` and the file `0600` on first
 * write. Every byte is written and fsynced (`appendLines`, durable), and a tail an earlier append left unterminated
 * gets its newline first: the row would otherwise fuse onto it, and the retry after a torn append would never read
 * back.
 *
 * @param path the ledger file
 * @param label what a row is, for the JSON serialiser's own error
 * @param row the row to append
 * @param parse the ledger's row parser
 * @returns the ledger's path, or why it could not be written
 */
export function appendCardLedgerRow<T>({
  path,
  label,
  row,
  parse,
}: {
  path: string;
  label: string;
  row: T;
  parse: (input: { value: unknown }) => T | undefined;
}): Result<string, CardLandingError> {
  const line = safeJsonStringify({ label, value: row });
  const refused = refusedLine({ label, line, parse, path });
  if (refused !== undefined) {
    return err(refused);
  }
  try {
    ensureDirectory({ directory: dirname(path) });
    chmodSync(dirname(path), 0o700);
    appendLines({ durable: true, mode: 0o600, path, text: `${line}\n` });
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path }));
  }
  return ok(path);
}
