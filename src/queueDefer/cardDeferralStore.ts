/**
 * The card-deferral ledger on disk: `$SLOPWEAVER_HOME/queue/card-deferrals.jsonl`, append-only, one press per line.
 *
 * A line that does not parse is COUNTED and reported, never silently dropped, so the page can say its order is
 * drawn from a partial ledger rather than present it as whole. No lock, unlike the card-landing ledger beside the
 * talk files: a press appends one row and decides nothing off what it read, and two presses racing each append
 * their own row, the later `pressedIso` winning and a restore winning a tie — so a call's come-back, dated when the owner
 * said it, loses to a press at or after that instant however late its retry appends (`./cardDeferral.ts`).
 */
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { ensureDirectory } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type CardDeferralRow, cardDeferralRowOf } from "./cardDeferral.js";
import { type CardDeferralError, CardDeferralErrors } from "./cardDeferralErrors.js";

/** What a read of the ledger found. */
export interface CardDeferralsRead {
  readonly path: string;
  /** Every row that parsed, in file order. */
  readonly rows: readonly CardDeferralRow[];
  /** 1-based line numbers that did not parse. */
  readonly unreadable: readonly number[];
}

/**
 * Where the ledger lives.
 *
 * @param home the Slopweaver home
 * @returns the ledger's path
 */
export function cardDeferralsPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).queue, "card-deferrals.jsonl");
}

/**
 * Read the whole ledger. A home where the owner has never deferred a card reads as an empty ledger, not a failure.
 *
 * @param home the Slopweaver home
 * @returns the rows and the lines that would not parse, or why the file could not be read
 */
export function readCardDeferrals({ home }: { home: string }): Result<CardDeferralsRead, CardDeferralError> {
  const path = cardDeferralsPath({ home });
  if (!existsSync(path)) {
    return ok({ path, rows: [], unreadable: [] });
  }
  const rows: CardDeferralRow[] = [];
  const unreadable: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        let row: CardDeferralRow | undefined;
        try {
          row = cardDeferralRowOf({ value: safeJsonParse({ label: "card deferral", text: line }) });
        } catch {
          row = undefined;
        }
        if (row === undefined) {
          unreadable.push(index + 1);
        } else {
          rows.push(row);
        }
      },
      path,
    });
  } catch (cause) {
    return err(CardDeferralErrors.ledgerIo({ cause, path }));
  }
  return ok({ path, rows, unreadable });
}

/**
 * Append one press, making the directory `0700` and the file `0600` on first write. The row is round-tripped
 * through its own parser first, so the ledger never holds a line its reader would refuse, and a tail an earlier
 * append left unterminated gets its newline first.
 *
 * @param home the Slopweaver home
 * @param row the press to record
 * @returns the ledger's path
 */
export function appendCardDeferral({
  home,
  row,
}: {
  home: string;
  row: CardDeferralRow;
}): Result<string, CardDeferralError> {
  const path = cardDeferralsPath({ home });
  const line = safeJsonStringify({ label: "card deferral", value: row });
  if (cardDeferralRowOf({ value: safeJsonParse({ label: "card deferral", text: line }) }) === undefined) {
    return err(CardDeferralErrors.ledgerIo({ cause: new Error(`the row does not read back: ${line}`), path }));
  }
  try {
    ensureDirectory({ directory: dirname(path) });
    chmodSync(dirname(path), 0o700);
    appendLines({ durable: true, mode: 0o600, path, text: `${line}\n` });
  } catch (cause) {
    return err(CardDeferralErrors.ledgerIo({ cause, path }));
  }
  return ok(path);
}
