/**
 * The cards talk has found are not the owner's: an append-only file beside the card-landing ledger, one row per card,
 * named {@link CARDS_NOT_OWNER_FILE}.
 *
 * A `CARD_NOT_HIS` refusal writes no landing, so the utterance stays unlanded and every later transcript batch, call
 * open and `talk land` judges it again — under an instant that can move, since a late segment moves an utterance's
 * start and a relay line splits one in two. Re-judged against a reading that no longer lists their pull request, it
 * landed on the colleague's card after all. Who opened a pull request never changes, so
 * the first verdict is recorded and every later judgement of the same card reads it instead of recomputing it.
 *
 * Written under the card-landing lock its caller already holds (`./cardLandingStore.ts`), beside that ledger, with
 * the same `0700`/`0600` modes. A line that does not parse is counted, never fatal: a lost row can only let a card be
 * judged afresh, which is the behaviour before this file existed.
 */
import { chmodSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { ensureDirectory } from "#lib/writeAtomic.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";

import { type CardLandingError, CardLandingErrors } from "./cardLandingErrors.js";

/** The `$SLOPWEAVER_HOME/talk` file holding the cards found not the owner's. */
export const CARDS_NOT_OWNER_FILE = "cards-not-owner.jsonl";

/** One card found not the owner's, and the sentence the refusal printed when it was. */
export interface CardNotOwnersRow {
  readonly cardKey: string;
  readonly why: string;
  readonly recordedAtIso: string;
}

/** What a read of the file found. */
export interface CardsNotOwnersRead {
  /** The recorded verdict per card key, the first recorded row winning. */
  readonly byCard: ReadonlyMap<string, CardNotOwnersRow>;
  /** 1-based line numbers that did not parse. */
  readonly unreadable: readonly number[];
}

/** Where the file lives: beside the card-landing ledger. */
function cardsNotOwnersPath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), CARDS_NOT_OWNER_FILE);
}

/** A parsed line as a row, or `undefined` when it is not one. */
function rowOf({ value }: { value: unknown }): CardNotOwnersRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { cardKey, why, recordedAtIso } = value;
  if (typeof cardKey !== "string" || typeof why !== "string" || typeof recordedAtIso !== "string") {
    return undefined;
  }
  return { cardKey, recordedAtIso, why };
}

/**
 * Read every recorded verdict, the first row per card winning. A home that never refused a card reads as none.
 *
 * @param home the Slopweaver home
 * @returns the verdicts by card key and the lines that would not parse, or why the file could not be read
 */
export function readCardsNotOwners({ home }: { home: string }): Result<CardsNotOwnersRead, CardLandingError> {
  const path = cardsNotOwnersPath({ home });
  const byCard = new Map<string, CardNotOwnersRow>();
  const unreadable: number[] = [];
  if (!existsSync(path)) {
    return ok({ byCard, unreadable });
  }
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        let row: CardNotOwnersRow | undefined;
        try {
          row = rowOf({ value: safeJsonParse({ label: "card not the owner's", text: line }) });
        } catch {
          row = undefined;
        }
        if (row === undefined) {
          unreadable.push(index + 1);
        } else if (!byCard.has(row.cardKey)) {
          byCard.set(row.cardKey, row);
        }
      },
      path,
    });
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path }));
  }
  return ok({ byCard, unreadable });
}

/**
 * What `talk land` prints for lines that would not parse.
 *
 * @param read the unreadable line numbers
 * @returns one diagnostic when any line would not parse, none when every line parsed
 */
export function cardsNotOwnersUnreadableLines({
  read,
}: {
  read: Pick<CardsNotOwnersRead, "unreadable">;
}): readonly string[] {
  if (read.unreadable.length === 0) {
    return [];
  }
  return [
    `talk land: ${basename(CARDS_NOT_OWNER_FILE, ".jsonl")} lines ${read.unreadable.join(", ")} do not parse; those cards are judged afresh`,
  ];
}

/**
 * Record one card's verdict, making the directory `0700` and the file `0600` on first write.
 *
 * @param home the Slopweaver home
 * @param row the verdict to keep
 * @returns the file's path, or why it could not be written
 */
export function appendCardNotOwners({
  home,
  row,
}: {
  home: string;
  row: CardNotOwnersRow;
}): Result<string, CardLandingError> {
  const path = cardsNotOwnersPath({ home });
  try {
    ensureDirectory({ directory: dirname(path) });
    chmodSync(dirname(path), 0o700);
    const line = safeJsonStringify({ label: "card not the owner's", value: row });
    appendLines({ durable: true, mode: 0o600, path, text: `${line}\n` });
  } catch (cause) {
    return err(CardLandingErrors.ledgerIo({ cause, path }));
  }
  return ok(path);
}
