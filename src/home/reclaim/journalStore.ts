/**
 * Reading and appending the reclaim ledger.
 *
 * Mirrors `../../sweep/journalStore.ts`, including the part that reads like over-engineering and is not:
 * **an unreadable ledger is a failure, never an empty one.** `existsSync` cannot tell a fresh install from a
 * `ledgers/` this process cannot traverse, and the two answers point opposite ways — a read that says
 * "nothing has been reclaimed" tells the caller it is safe to reclaim, which is exactly wrong when the truth
 * is that the record of what was already deleted is unreachable.
 *
 * Read line by line through `readJsonlLines`, never as one string: its length is decided by how much
 * reclaiming has happened rather than by the code that shaped it.
 */
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import { type HomeReclaimError, HomeReclaimErrors } from "./errors.js";
import type { ReclaimJournalRow } from "./journalRow.js";

/**
 * The ledger's absolute path.
 *
 * @param home the state home, defaulting to the resolved one
 * @returns the path to `ledgers/home-reclaim.jsonl`
 */
export function reclaimLedgerPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).homeReclaimLedgerJsonl;
}

/** Whether the ledger is there, genuinely absent, or present-but-unreachable. */
function presence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "ENOENT" ? "absent" : "unreachable";
  }
}

/**
 * Whether a parsed value carries every field a reclaim row needs.
 *
 * Every field the rail depends on is required: a row that cannot say what was removed, or whether the
 * witness held, is not the rail, and reading one as if it were would make the ledger claim more than it
 * holds. `survivingDigests` is deliberately not checked — see `./journalRow.ts` for why it outlived the
 * class that wrote it.
 *
 * @param value one parsed line
 * @returns true when it is a complete row
 */
function isReclaimRow(value: unknown): value is ReclaimJournalRow {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["atIso"] === "string" &&
    typeof value["root"] === "string" &&
    typeof value["takes"] === "string" &&
    typeof value["removedEntries"] === "number" &&
    typeof value["freedBytes"] === "number" &&
    typeof value["witnessHeld"] === "boolean" &&
    typeof value["session"] === "string"
  );
}

/**
 * Read every act the reclaim ledger holds, oldest first.
 *
 * @param path the ledger file
 * @returns the rows, or the typed failure when the ledger exists and cannot be read
 */
export function readReclaimLedger({ path }: { path: string }): Result<readonly ReclaimJournalRow[], HomeReclaimError> {
  const state = presence({ path });
  if (state === "absent") {
    return ok([]);
  }
  if (state === "unreachable") {
    return err(HomeReclaimErrors.scanFailed({ cause: new Error("ledger present but unreadable"), path }));
  }
  const rows: ReclaimJournalRow[] = [];
  let corrupt: number | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (corrupt !== undefined || line.trim().length === 0) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = safeJsonParse({ label: "a reclaim ledger row", text: line });
        } catch {
          corrupt = index + 1;
          return;
        }
        if (!isReclaimRow(parsed)) {
          corrupt = index + 1;
          return;
        }
        rows.push(parsed);
      },
      path,
    });
  } catch (cause: unknown) {
    return err(HomeReclaimErrors.scanFailed({ cause, path }));
  }
  if (corrupt !== undefined) {
    return err(
      HomeReclaimErrors.scanFailed({
        cause: new Error(`line ${String(corrupt)} is not a complete reclaim row`),
        path,
      }),
    );
  }
  return ok(rows);
}

/**
 * Append one act to the ledger, creating `ledgers/` when this is the first.
 *
 * @param path the ledger file
 * @param row what the run did
 * @returns nothing on success, or the typed failure
 */
export function appendReclaimRow({
  path,
  row,
}: {
  path: string;
  row: ReclaimJournalRow;
}): Result<true, HomeReclaimError> {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendLines({ path, text: `${safeJsonStringify({ label: "a reclaim ledger row", value: row })}\n` });
    return ok(true);
  } catch (error: unknown) {
    return err(HomeReclaimErrors.applyFailed({ cause: error, path }));
  }
}
