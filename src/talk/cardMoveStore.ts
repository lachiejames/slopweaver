/**
 * The moved-on ledger on disk: `$SLOPWEAVER_HOME/talk/card-moves.jsonl`, append-only, one row per line, beside the
 * card-landing ledger (`./cardLandingStore.ts`) and written under that ledger's own lock — `talk transcript` holds it
 * from its read of the call, so two batches of one call never write one move twice. The file's shape — modes,
 * counted unreadable lines, a durable append — is the one both card ledgers share (`./cardLedgerFile.ts`).
 */
import { dirname, join } from "node:path";

import type { Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type CardLandingError } from "./cardLandingErrors.js";
import { appendCardLedgerRow, type CardLedgerRead, readCardLedger } from "./cardLedgerFile.js";
import { type CardMovedOnRow, cardMovedOnRowOf } from "./cardMoveLedger.js";

/** What a read of the moved-on ledger found. */
export type CardMovesRead = CardLedgerRead<CardMovedOnRow>;

/**
 * Where the ledger lives: beside the card-landing ledger, under the home's own `talk/` directory.
 *
 * @param home the Slopweaver home
 * @returns the ledger's path
 */
function cardMovesPath({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "card-moves.jsonl");
}

/**
 * Read the whole ledger. A home whose walk has never moved on from a card reads as an empty ledger, not a failure.
 *
 * @param home the Slopweaver home
 * @returns the rows and the lines that would not parse, or why the file could not be read
 */
export function readCardMoves({ home }: { home: string }): Result<CardMovesRead, CardLandingError> {
  return readCardLedger({ label: "card move", parse: cardMovedOnRowOf, path: cardMovesPath({ home }) });
}

/**
 * Append one row. It is round-tripped through its own parser first, so the ledger never holds a line its reader would
 * refuse.
 *
 * @param home the Slopweaver home
 * @param row the row to append
 * @returns the ledger's path
 */
export function appendCardMove({ home, row }: { home: string; row: CardMovedOnRow }): Result<string, CardLandingError> {
  return appendCardLedgerRow({ label: "card move", parse: cardMovedOnRowOf, path: cardMovesPath({ home }), row });
}
