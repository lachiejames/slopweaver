/**
 * Durable I/O for the merge hold's journal — an append-only `hold-ledger.jsonl` beside the hold document.
 *
 * Every decision about a row is a pure function in `./holdLedger.ts`; this module appends and reads bytes.
 *
 * The append is `fsync`'d for the reason `live/listen/supervise/store.ts` gives about the arm journal: this
 * is the record that outlives the session that wrote it, so a kill that takes the whole process tree must
 * not take the last row with it. It is an APPEND rather than a replace — the opposite of `./mergeHoldStore`,
 * deliberately: the document says what is held now, this says what has ever been held.
 *
 * The read goes through {@link readJsonlLines} because the file is a `.jsonl`, which the `whole-file-json`
 * gate refuses to see read whole, and rightly: an append-only journal's size is set by how much this install
 * has held, never by the code. Only the last {@link HOLD_LEDGER_DEFAULT_LIMIT} rows are kept in memory — a
 * reader wants the recent shift, and the whole file would defeat the streaming read that produced it.
 *
 * A missing file is the ordinary starting state and reads as an empty journal, never an error — a home that
 * has never placed a hold is the common case, and `--history` there should say so rather than fail.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { slopweaverHome } from "../../config.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type HoldLedgerRow, holdLedgerLine, parseHoldLedgerRow } from "./holdLedger.js";
import { HOLD_LEDGER_DEFAULT_LIMIT } from "./holdLedgerLimits.js";

/** Owner-only, matching the hold document it sits beside: it names the sessions running on this machine. */
const DIR_MODE = 0o700;

/**
 * Where the hold journal lives.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute path to the journal
 */
export function holdLedgerPath({ home = slopweaverHome() }: { home?: string } = {}): string {
  return stateHomePaths({ home }).live.github.holdLedgerJsonl;
}

/**
 * Append one transition to the journal.
 *
 * @param row the transition to record
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns ok, or the one-line reason the append failed
 */
export function appendHoldLedgerRow({
  row,
  home = slopweaverHome(),
}: {
  row: HoldLedgerRow;
  home?: string;
}): Result<void> {
  const path = holdLedgerPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ durable: true, path, text: `${holdLedgerLine({ row })}\n` });
  } catch (error: unknown) {
    return err([`could not append to the hold ledger at ${path}: ${String(error)}`]);
  }
  return ok(undefined);
}

/**
 * The most recent journalled transitions, oldest first.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param limit how many rows to keep, counting back from the end of the file
 * @returns the decodable rows in file order, or none at all when the journal is absent or unreadable
 */
export function readHoldLedgerRows({
  home = slopweaverHome(),
  limit = HOLD_LEDGER_DEFAULT_LIMIT,
}: {
  home?: string;
  limit?: number;
} = {}): readonly HoldLedgerRow[] {
  const path = holdLedgerPath({ home });
  if (limit <= 0 || !existsSync(path)) {
    return [];
  }
  const kept: HoldLedgerRow[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const row = parseHoldLedgerRow({ line });
        if (row === undefined) {
          return;
        }
        kept.push(row);
        if (kept.length > limit) {
          kept.shift();
        }
      },
      path,
    });
  } catch {
    return kept;
  }
  return kept;
}
