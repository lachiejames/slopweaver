/**
 * Reading and appending the sweep ledger — the effectful half of the rail.
 *
 * Mirrors `../autonomy/importRegister.ts` deliberately, including the part that looks like over-engineering and is
 * not: **an unreadable ledger is a failure, never an empty one.** `existsSync` cannot tell a fresh install
 * from a `ledgers/` directory this process cannot traverse, and the two answers point opposite ways here — a
 * read that says "nothing has been swept" tells the caller it is safe to sweep, which is exactly wrong when
 * the truth is that the record of what was already deleted is unreachable. So presence is a `statSync` whose
 * `ENOENT` is the only answer that means absent.
 *
 * The ledger is read line by line through `readJsonlLines` rather than as one string, because its length is
 * decided by how much sweeping has happened rather than by the code that shaped it — the class
 * `.claude/rules/typescript-patterns.md` names as never letting a data-sized payload through one JS string.
 */
import { mkdirSync, statSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import { type SweepError, SweepErrors } from "./errors.js";
import type { SweepJournalRow } from "./journalRow.js";

/**
 * The ledger's absolute path.
 *
 * @param home the state home, defaulting to the resolved one
 * @returns the path to `ledgers/sweep.jsonl`
 */
export function sweepLedgerPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).sweepLedgerJsonl;
}

/**
 * Whether the ledger is there, genuinely absent, or present-but-unreachable.
 *
 * @param path the ledger file
 * @returns which of the three
 */
function presence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "ENOENT" ? "absent" : "unreachable";
  }
}

/**
 * Whether a parsed value carries every field a sweep row needs.
 *
 * Every field is required, which is the whole check: a row that cannot say which verb ran on what evidence is
 * not a rail, and reading one as if it were would make the ledger claim more than it holds.
 *
 * @param value one parsed line
 * @returns true when it is a complete row
 */
export function isJournalRow(value: unknown): value is SweepJournalRow {
  if (!isRecord(value)) {
    return false;
  }
  const required = ["id", "atIso", "slug", "path", "verdict", "act", "witness", "verbLine", "session"];
  return required.every((field) => typeof value[field] === "string");
}

/**
 * Every act the ledger holds, oldest first.
 *
 * @param path the ledger file
 * @returns every row, or the first failure
 */
export function readSweepLedger({ path }: { path: string }): Result<readonly SweepJournalRow[], SweepError> {
  const state = presence({ path });
  if (state === "unreachable") {
    return err(SweepErrors.ledgerUnreachable({ cause: "check its permissions", path }));
  }
  if (state === "absent") {
    return ok([]);
  }
  const rows: SweepJournalRow[] = [];
  let failure: SweepError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = safeJsonParse({ label: "a sweep ledger row", text: line });
        } catch {
          failure = SweepErrors.corruptLedgerRow({ lineNumber: index + 1, why: "not JSON" });
          return;
        }
        if (!isJournalRow(parsed)) {
          failure = SweepErrors.corruptLedgerRow({ lineNumber: index + 1, why: "a required field is missing" });
          return;
        }
        rows.push(parsed);
      },
      path,
    });
  } catch (cause) {
    return err(SweepErrors.ledgerUnreachable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(rows);
}

/**
 * Append one act to the ledger, creating `ledgers/` when this install has never written one.
 *
 * Appended rather than rewritten so a concurrent reader never sees a truncated file, and so the record of one
 * deletion cannot be lost to a failed write of an unrelated row.
 *
 * @param path the ledger file
 * @param row the act to record
 * @returns true, or the failure
 */
export function appendSweepRow({ path, row }: { path: string; row: SweepJournalRow }): Result<true, SweepError> {
  let encoded: string;
  try {
    encoded = safeJsonStringify({ label: "a sweep ledger row", value: { ...row } });
  } catch (cause) {
    return err(SweepErrors.ledgerUnreachable({ cause: errorMessage({ error: cause }), path }));
  }
  try {
    mkdirSync(stateHomePathsParent({ path }), { recursive: true });
    appendLines({ path, text: `${encoded}\n` });
    return ok(true);
  } catch (cause) {
    return err(SweepErrors.ledgerUnreachable({ cause: errorMessage({ error: cause }), path }));
  }
}

/**
 * The directory one ledger path sits in.
 *
 * Split out so the append's `mkdirSync` reads as one idea rather than as a path expression inside a try.
 *
 * @param path the ledger file
 * @returns its containing directory
 */
function stateHomePathsParent({ path }: { path: string }): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "." : path.slice(0, at);
}
