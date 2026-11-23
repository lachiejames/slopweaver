/**
 * The `slopweaver claude reset` claims journal on disk — the intent row written BEFORE a claim is sent and the
 * outcome or close after, so a retry settles the SAME attempt (`./resetAttempt.ts`).
 *
 * An ABSENT journal is an empty read — no claim was ever attempted here. A journal that exists and will not read is
 * a failure, never an empty one: reading it as empty would mint a fresh request id for an attempt still open, which
 * is the one way this journal can let a second reset spend. `home` is REQUIRED, never defaulted, so a test cannot
 * write into the operator's own journal.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type ClaudeResetJournalRow, parseClaudeResetJournalLine } from "./resetAttempt.js";
import { type ClaudeResetError, ClaudeResetErrors } from "./resetErrors.js";

/** Owner-only permissions, matching the other journals under the state home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The failure's message, whatever was thrown. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every row the journal holds, in file order. A line that does not parse fails the whole read.
 *
 * @param home the state home to read under
 * @returns the rows, or why the journal could not be read
 */
export function readClaudeResetJournal({
  home,
}: {
  home: string;
}): Result<readonly ClaudeResetJournalRow[], ClaudeResetError> {
  const path = stateHomePaths({ home }).claudeResetClaimsJsonl;
  const rows: ClaudeResetJournalRow[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseClaudeResetJournalLine({ line });
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
    return err(ClaudeResetErrors.journalFailed({ cause: messageOf({ error }), operation: `reading ${path}` }));
  }
  if (problems.length > 0) {
    return err(ClaudeResetErrors.journalFailed({ cause: problems.join("; "), operation: `reading ${path}` }));
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
export function appendClaudeResetJournal({
  home,
  row,
}: {
  home: string;
  row: ClaudeResetJournalRow;
}): Result<undefined, ClaudeResetError> {
  const path = stateHomePaths({ home }).claudeResetClaimsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(row)}\n` });
  } catch (error) {
    return err(ClaudeResetErrors.journalFailed({ cause: messageOf({ error }), operation: `appending to ${path}` }));
  }
  return ok(undefined);
}
