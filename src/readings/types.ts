/**
 * The readings ledger's record shape — one row of `readings/index.jsonl`.
 *
 * A READING is one verb's complete `--json` document, kept as the bytes it printed, with who took it and
 * when it was true. The ledger exists so a page never has to take a slow read itself: it shows the last
 * reading and says whose it was and how old it is. It closes one failure — a board
 * that said a pull request was green, read by a poll nobody watched — and is a
 * ledger every actor appends to (the supervisor tick, a seat, the pull-requests page's own refresh) rather than a page that reads
 * the tick row alone.
 *
 * The document is NOT on the row. One `github landing` document is tens of kilobytes, and an index that
 * carried every document would be the `.jsonl`-read-whole shape `whole-file-json` refuses. The row names
 * the file under `readings/<producer slug>/` holding the bytes, and `./store.ts` is the only reader of both.
 */

/** The longest `producer` a row may carry — a verb line, never a paragraph. */
export const READING_PRODUCER_MAX = 200;

/** The longest `by` a row may carry — a tick label, a session, a button name. */
export const READING_BY_MAX = 300;

/** One row of the index. */
export interface ReadingRecord {
  /** `<recordedAtIso>-<producer slug>` — unique per append, and what `reading last --json` prints. */
  readonly readingId: string;
  /** The verb line that produced the document, as a caller types it: `github landing`, never a slug. */
  readonly producer: string;
  /** Who took it — `tick-12`, a session id, `sync-now`. The name a page prints after "read N ago by". */
  readonly by: string;
  /** When the document was TRUE of the world — the producer's own instant when it published one. */
  readonly observedAtIso: string;
  /** When this row was appended. Orders the ledger, and names the file. */
  readonly recordedAtIso: string;
  /** The document's path relative to the `readings/` directory. */
  readonly file: string;
  /** The document's size on disk. */
  readonly bytes: number;
}

/** What `reading record` answers with: the row, and where its two writes landed. */
export interface ReadingReceipt {
  readonly record: ReadingRecord;
  /** The absolute path of the document file. */
  readonly documentPath: string;
  /** The absolute path of the index the row was appended to. */
  readonly indexPath: string;
}

/** What `reading last` answers with: the row and the document it names, parsed. */
export interface Reading {
  readonly record: ReadingRecord;
  readonly document: unknown;
}
