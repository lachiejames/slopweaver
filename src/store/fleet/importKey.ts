/**
 * The import key every append-only ledger in this directory is keyed on.
 *
 * Lifted deliberately from `../../knowledge/importLessons.ts`, which minted the same key for the lessons
 * register, and stated once here so the three ledger tables cannot each invent a variant. Its whole
 * property is in that module's header and is repeated because it is the reason a re-import is safe:
 *
 * The key is the SHA-256 of ONE PHYSICAL LINE's bytes plus its 1-based line number, zero-padded so the
 * keys sort in source order as text. In an append-only file a line's position and its bytes never move, so
 * a file that has GROWN since the last apply produces the SAME key for every line already imported and a
 * new key only for the lines appended after them. Keying on the digest of the whole file — the shape this
 * replaced — makes a file with one line appended re-import every line it already held.
 *
 * Two identical lines in one file still import as two rows, because their line numbers differ, and an
 * append-only file's duplicated line IS two events.
 *
 * The grant journal and the autonomy register import ONCE, each line under this key (the autonomy one prefixed
 * `imported:`, `./autonomyEvent.ts`), and their tables are the ledgers from then on.
 *
 * Pure: no I/O, no clock.
 */
import { createHash } from "node:crypto";

/**
 * How many digits a padded line number keeps.
 *
 * Ten holds a file of 9,999,999,999 lines. `door.jsonl` is the largest here at 198,071, so this is a width
 * chosen once so the text sort never has to be re-reasoned about rather than a bound anybody will reach.
 */
const IMPORT_LINE_DIGITS = 10;

/**
 * The import key for one physical line of a ledger file.
 *
 * @param line the line's exact text, hashed so an edited line stops matching its old key
 * @param lineNumber the 1-based physical line number
 * @returns a key unique to that line at that position, zero-padded so keys sort in source order
 */
export function ledgerImportKey({ line, lineNumber }: { line: string; lineNumber: number }): string {
  const digest = createHash("sha256").update(line).digest("hex");
  return `${digest}:${String(lineNumber).padStart(IMPORT_LINE_DIGITS, "0")}`;
}
