/**
 * The bounded READER — bronze JSONL off disk into projected rows, one slice at a time.
 *
 * Split out of {@link ./ingest} when that file crossed its size ratchet, along a seam that was already
 * real: nothing here touches the database. A slice is a synchronous file read, a parse, an admission
 * decision and a projection, and every property worth arguing about — the two ceilings, the resume cursor,
 * where the denylist is consulted — belongs to the read rather than to the write.
 *
 * ## The two ceilings, and why the second one exists
 *
 * A slice stops at `limit` PROJECTED records or `limit` examined non-blank lines, whichever comes first.
 * Reading only the projected one called a wholly-refused slice the end of the file: a file whose every line
 * is unstorable read to EOF in ONE slice and held a refusal object per line — 1,742,641 of them for
 * `slack/compact.jsonl`, which is exactly the shape the bound exists to prevent, reintroduced by the error
 * path. An EXCLUDED line counts against that ceiling too, for the same reason.
 */

import { statSync } from "node:fs";

import { parseRow } from "../corpus/corpusRowCore.js";
import { readJsonlLines } from "../corpus/corpusStore.js";

import { admitRecord, type StoreAdmission, scrubExcludedIdentities } from "./admission.js";
import { StoreErrors, type StoreRowRefusedError } from "./errors.js";
import { type ProjectedRecord, projectRecord } from "./project.js";

/**
 * How many refusals one run keeps, however many it counts.
 *
 * A whole-corpus pass over a source whose every row is unstorable would otherwise accumulate two million
 * error objects in the heap — the exact shape the bounded reader exists to prevent, reintroduced by the
 * reporting. The COUNT stays exact; only the retained examples are capped.
 */
export const MAX_RETAINED_REFUSALS = 200;

/** What one bounded read of a bronze file produced, before anything was written. */
export interface ReadSlice {
  readonly projected: readonly ProjectedRecord[];
  /** Retained EXAMPLES, capped at {@link MAX_RETAINED_REFUSALS} — never every refusal the slice produced. */
  readonly refusals: readonly StoreRowRefusedError[];
  /** How many refusals the slice produced, exactly, however few of them it kept. */
  readonly refusalCount: number;
  readonly linesRead: number;
  readonly bytesRead: number;
  /**
   * Where a resumed read must begin to lose nothing: one past the end of the last line this slice
   * ACCOUNTED FOR, whether it was projected or refused.
   *
   * ## Why this is not `bytesRead`, which is the trap
   *
   * `bytesRead` is the reader's own `bytesConsumed`, and the read stops at a CHUNK boundary rather than at
   * the limit — so the chunk that reached the ceiling has already delivered its remaining lines to
   * `onLine`, which skipped them. `bytesConsumed` counts those skipped lines as consumed. Resuming from it
   * would step over every record between the ceiling and the end of that 8 MiB chunk, silently, and the
   * store would simply never hold them. A Codex planning pass named this before a line was written.
   *
   * Measured from the line's own `byteOffset + byteLength`, plus the newline that terminated it.
   */
  readonly resumeByteOffset: number;
}

/**
 * Read up to `limit` storable records off a bronze file, stopping the read as soon as it has them.
 *
 * The stop is checked between CHUNKS rather than between lines, because that is the seam
 * `readJsonlLines` offers and it is the one that bounds the transient — a chunk is 8 MiB, so overshooting
 * by part of one is the price of never holding the file.
 *
 * @param path the bronze file to read
 * @param limit how many storable records to take
 * @param admission the run.s rule-D state, which this slice both reads and extends
 * @returns the projected records, the refusals, and how far the read actually got
 */
export function readSlice({
  path,
  limit,
  admission,
  from = 0,
}: {
  path: string;
  limit: number;
  admission: StoreAdmission;
  from?: number;
}): ReadSlice {
  // Clamped against the real size because the reader delivers a trailing EMPTY line after a final newline,
  // whose zero-length range sits AT end-of-file — adding a separator to it would report one byte more than
  // the file has and hand a caller a `--from` past the end.
  const fileBytes = statSync(path).size;
  const taken: SliceAccumulator = {
    bytesRead: 0,
    linesRead: 0,
    projected: [],
    refusalCount: 0,
    refusals: [],
    resumeByteOffset: from,
  };
  // TWO ceilings, and the second one is the fix for a heap bound that only ever bounded the successes. A
  // slice used to stop on projected records alone, so a file whose every line is unstorable read to EOF in
  // ONE slice and held a refusal object per line — 1,742,641 of them for `slack/compact.jsonl`, which is
  // exactly the shape the bound exists to prevent, reintroduced by the error path. A Codex planning pass
  // named it before this ran at corpus scale. So a slice examines at most `limit` non-blank lines as well
  // as taking at most `limit` records, and the retained refusals are capped where they are PRODUCED while
  // the count stays exact.
  const done = (): boolean => taken.projected.length >= limit || taken.linesRead >= limit;
  readJsonlLines({
    onChunk: ({ bytesConsumed }) => {
      taken.bytesRead = bytesConsumed;
      return !done();
    },
    onLine: ({ line, byteOffset, byteLength }) => {
      if (done()) {
        return;
      }
      // Advanced for a blank line too: a resumed read that stopped short of one would deliver it again,
      // forever, because a blank line never becomes a projected record and so never moves a cursor that
      // only counted records.
      taken.resumeByteOffset = Math.min(byteOffset + byteLength + 1, fileBytes);
      takeLine({ admission, line, taken });
    },
    path,
    startByteOffset: from,
  });
  return {
    bytesRead: taken.bytesRead,
    linesRead: taken.linesRead,
    projected: taken.projected,
    refusalCount: taken.refusalCount,
    refusals: taken.refusals,
    resumeByteOffset: taken.resumeByteOffset,
  };
}

/** What one slice has taken so far, extended in place by {@link takeLine}. */
interface SliceAccumulator {
  bytesRead: number;
  linesRead: number;
  refusalCount: number;
  resumeByteOffset: number;
  readonly projected: ProjectedRecord[];
  readonly refusals: StoreRowRefusedError[];
}

/**
 * Parse, project and account for ONE line, extending the slice in place.
 *
 * Split out of {@link readSlice} so that function stays under this repo's line cap, and because the three
 * outcomes a line can have — blank, refused at the parse, refused at the projection — are the part worth
 * reading on its own. The cursor is advanced by the caller, before this is reached, precisely because a
 * blank line must move it too.
 *
 * The denylist is consulted HERE, between the parse and the projection, for two reasons that are both
 * load-bearing. The projection is where the raw payload's `app_id`, `bot_id` and `thread_ts` stop being
 * reachable, so a filter below it could not see what it needs. And a denied row must not reach
 * {@link ./ingest.writeBatch}'s identity work, or an alert nobody wants still mints the person who "wrote" it.
 *
 * An excluded line still increments `linesRead` and still advances the cursor, because it was EXAMINED:
 * a slice whose every line is denied must consume its ceiling and move on, not read the file forever.
 *
 * @param line the raw line, already known to be inside both ceilings
 * @param taken the slice's accumulated records, refusals and counts
 * @param admission the run's rule-D state, extended in place across every slice
 */
function takeLine({
  line,
  taken,
  admission,
}: {
  line: string;
  taken: SliceAccumulator;
  admission: StoreAdmission;
}): void {
  if (line.trim().length === 0) {
    return;
  }
  taken.linesRead += 1;
  const parsed = parseRow({ line });
  if ("error" in parsed) {
    taken.refusalCount += 1;
    keepRefusal({
      into: taken.refusals,
      refusal: StoreErrors.rowRefused({
        reason: parsed.error,
        source: "unparsed",
        sourceId: `line ${String(taken.linesRead)}`,
      }),
    });
    return;
  }
  if (admitRecord({ admission, record: parsed.record }) !== "take") {
    return;
  }
  // The roster is narrowed AFTER the record is admitted and BEFORE it is projected: a phantom attendee
  // never justifies dropping a real meeting, and the projection is what turns `attrs` into indexed
  // metadata, so scrubbing here is what keeps the name out of every answer built from the store.
  const scrubbed = scrubExcludedIdentities({ exclusion: admission.identities, record: parsed.record });
  admission.identitiesScrubbed += scrubbed.removed;
  const row = projectRecord({ record: scrubbed.record });
  if (row.isErr()) {
    taken.refusalCount += 1;
    keepRefusal({ into: taken.refusals, refusal: row.error });
    return;
  }
  taken.projected.push(row.value);
}

/**
 * Keep one refusal as an example, up to the retention cap, and drop the rest.
 *
 * Applied where a refusal is PRODUCED rather than where a pass accumulates them, because the array inside
 * one slice is the one that grows with the data: a pass-level cap leaves a single slice free to hold a
 * refusal per line of the file it is reading.
 *
 * @param refusal the refusal just produced
 * @param into the retained examples, extended in place
 */
function keepRefusal({ refusal, into }: { refusal: StoreRowRefusedError; into: StoreRowRefusedError[] }): void {
  if (into.length < MAX_RETAINED_REFUSALS) {
    into.push(refusal);
  }
}
