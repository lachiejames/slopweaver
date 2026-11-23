/**
 * The Codex reset claims journal on disk — the intent row written BEFORE a consume exchange and the outcome row
 * after, so a retry reuses the attempt's idempotency key (`./resetConsume.ts` § One attempt, however many runs).
 *
 * An ABSENT journal is an empty read — no reset was ever attempted here. A journal that exists and will not read
 * is a failure, never an empty one: reading it as empty would mint a fresh key for an attempt still open, which is
 * the one way this journal can let a second reset spend. `home` is REQUIRED, never defaulted, so a test cannot
 * write into the operator's own journal.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type CodexResetJournalRow, parseCodexResetJournalLine } from "./resetConsume.js";
import { type CodexResetError, CodexResetErrors } from "./resetErrors.js";

/** Owner-only permissions, matching the other journals under the state home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The failure's message, whatever was thrown. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every row the journal holds, in file order.
 *
 * A line that does not parse fails the whole read: an unreadable intent row could be the open attempt, and
 * skipping it would mint a second key for it.
 *
 * @param home the state home to read under
 * @returns the rows, or why the journal could not be read
 */
export function readCodexResetJournal({
  home,
}: {
  home: string;
}): Result<readonly CodexResetJournalRow[], CodexResetError> {
  const path = stateHomePaths({ home }).codexResetClaimsJsonl;
  const rows: CodexResetJournalRow[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseCodexResetJournalLine({ line });
        if (parsed.isErr()) {
          problems.push(parsed.error.message);
          return;
        }
        rows.push(parsed.value);
      },
      path,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok([]);
    }
    return err(CodexResetErrors.journalFailed({ cause: messageOf({ error }), operation: `reading ${path}` }));
  }
  if (problems.length > 0) {
    return err(CodexResetErrors.journalFailed({ cause: problems.join("; "), operation: `reading ${path}` }));
  }
  return ok(rows);
}

/**
 * Append one row.
 *
 * @param home the state home to write under
 * @param row the row to append
 * @returns nothing, or why the append failed — an intent nobody recorded is an attempt a retry cannot settle
 */
export function appendCodexResetJournal({
  home,
  row,
}: {
  home: string;
  row: CodexResetJournalRow;
}): Result<undefined, CodexResetError> {
  const path = stateHomePaths({ home }).codexResetClaimsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(row)}\n` });
  } catch (error) {
    return err(CodexResetErrors.journalFailed({ cause: messageOf({ error }), operation: `appending to ${path}` }));
  }
  return ok(undefined);
}
