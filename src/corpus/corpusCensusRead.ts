/**
 * Reading a census's entries back as whole records — the half of {@link ./corpusCensus} that runs after the
 * walk, a batch at a time, through the {@link RowReader} the census's pointers name. The census itself never
 * holds a body; this is where a caller that needs one gets it.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { CensusRowUnreadableError } from "./corpusCensus.errors.js";
import type { CensusEntry } from "./corpusCensus.js";
import type { CorpusProjection } from "./corpusRowCore.js";
import type { RowReader } from "./rowReader.js";
import type { CorpusRecord } from "./types.js";

/**
 * Read a list of entries' records back, in the order given.
 *
 * @param reader an open row reader
 * @param entries the entries whose rows to read
 * @param projection which fields each record retains
 * @returns the records, or the first row that could not be read back
 */
export function readCensusRecords({
  reader,
  entries,
  projection,
}: {
  reader: RowReader;
  entries: readonly CensusEntry[];
  projection: CorpusProjection;
}): Result<readonly CorpusRecord[], CensusRowUnreadableError> {
  const records: CorpusRecord[] = [];
  for (const entry of entries) {
    const record = reader.record({ pointer: entry.pointer, projection });
    if (record.isErr()) {
      return err(record.error);
    }
    records.push(record.value);
  }
  return ok(records);
}
