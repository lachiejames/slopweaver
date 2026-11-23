/**
 * The `writeId` every line of a console-voice call carries: the page mints one as it queues a line and keeps it
 * through every retry, so a batch the route answered 503 after the verb had appended it — killed on its bound while
 * a loaded machine starved it — is posted again with the same ids and goes in once.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CallEntry } from "./callRecord.js";

/** Why a batch repeating a write id is refused. */
export const REPEATED_WRITE_ID = "two lines carry the same writeId";

/**
 * Whether two lines of one batch carry the same `writeId`. Each id is minted once as the page queues its line, so
 * a repeat is a malformed batch, never a retry: refused whole rather than folded, which would drop a distinct line
 * the file does not hold — by the batch reader, so the route answers 422, and by the append itself,
 * so no other caller writes one.
 *
 * @param entries the batch
 * @returns whether an id repeats
 */
export function repeatsWriteId({ entries }: { entries: readonly CallEntry[] }): boolean {
  const ids = entries.flatMap((entry) => (entry.writeId === undefined ? [] : [entry.writeId]));
  return new Set(ids).size !== ids.length;
}

/**
 * The lines of a batch the call file does not already hold, by their write ids. A line with no id (written by hand,
 * or by a page from before the ids) is always appended, and so is one whose earlier copy was torn, since a torn line
 * has no readable id. The file is read only when some line carries an id.
 *
 * @param entries the batch, in order
 * @param held reads the lines the call file holds, none when it does not exist yet
 * @returns the entries to append, in order, or why the file could not be read
 */
export function unwrittenEntries({
  entries,
  held,
}: {
  entries: readonly CallEntry[];
  held: () => Result<readonly CallEntry[], unknown>;
}): Result<readonly CallEntry[], unknown> {
  if (!entries.some((entry) => entry.writeId !== undefined)) {
    return ok(entries);
  }
  const read = held();
  if (read.isErr()) {
    return err(read.error);
  }
  return ok(entriesNotHeld({ entries, held: read.value }));
}

/**
 * The lines of a batch whose write id the held lines do not already carry — what an append of it will actually
 * write, so a check run before the append judges those lines rather than the batch as posted.
 *
 * @param entries the batch, in order
 * @param held the lines the call file already holds
 * @returns the entries an append would write, in order
 */
export function entriesNotHeld({
  entries,
  held,
}: {
  entries: readonly CallEntry[];
  held: readonly CallEntry[];
}): readonly CallEntry[] {
  const seen = new Set(held.flatMap((entry) => (entry.writeId === undefined ? [] : [entry.writeId])));
  return entries.filter((entry) => entry.writeId === undefined || !seen.has(entry.writeId));
}
