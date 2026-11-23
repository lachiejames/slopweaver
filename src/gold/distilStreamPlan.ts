/**
 * The distil batch plan, cut from a corpus CENSUS and hashed one batch at a time — so planning the whole
 * corpus never holds the whole corpus.
 *
 * {@link ./distilGroup.groupForDistil} needs every record in heap: it buckets them, cuts each container, then
 * hashes each batch's prompted bodies. Only the hash reads a body. So the plan here cuts the same batches from
 * `corpus/corpusCensus.CensusEntry`s ({@link ./distilGroup.cutBatches} reads four fields, all of which an
 * entry carries), then reads each batch's records back by pointer, hashes them, and lets them go. Peak heap is
 * the census plus one batch of at most `1.5 × target` records, whatever the corpus weighs on disk.
 *
 * The batches, their order and their hashes are {@link ./distilGroup.groupForDistil}'s over
 * `latestRecords(records)` — the collapse the census performs — which a unit test pins on a corpus built to
 * exercise every tie class. That equivalence is what keeps a digest cache paid for under the old reader
 * valid under this one.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { CensusRowUnreadableError } from "../corpus/corpusCensus.errors.js";
import type { CensusEntry, CorpusCensus } from "../corpus/corpusCensus.js";
import { readCensusRecords } from "../corpus/corpusCensusRead.js";
import { identityOf } from "../corpus/latestRecords.js";
import { type RowReader } from "../corpus/rowReader.js";
import type { CorpusRecord, CorpusSource } from "../corpus/types.js";

import { cutBatches, type DistilBatch, hashBatch } from "./distilGroup.js";

/** One batch of the plan: its cache key, and the census entries whose records it will read back on demand. */
export interface PlannedDistilBatch {
  readonly source: CorpusSource;
  readonly container: string;
  readonly hash: string;
  readonly members: readonly CensusEntry[];
}

/**
 * The projection a planned batch's records are read back under. `retrieval` keeps every field the prompt,
 * the brief and the digest validator read, and drops `raw`, which none of them reads.
 */
const BATCH_PROJECTION = "retrieval";

/**
 * Cut and hash the whole plan from a census.
 *
 * @param census the corpus census, collapsed under the `bronze` tie projection distil has always read with
 * @param reader the open row reader each batch's records are read back through
 * @param promptVersion the distil contract fingerprint folded into every key
 * @param targetPerBatch the TARGET records per batch
 * @param topContainersPerSource keep only the busiest N containers per source
 * @param recentOnly take only the newest `targetPerBatch` records per container as one batch
 * @returns the planned batches in {@link ./distilGroup.groupForDistil}'s order, or the first batch whose
 *   rows could not be read back
 */
export function planDistilFromCensus({
  census,
  reader,
  promptVersion,
  targetPerBatch,
  topContainersPerSource,
  recentOnly,
}: {
  census: CorpusCensus;
  reader: RowReader;
  promptVersion: string;
  targetPerBatch?: number;
  topContainersPerSource?: number;
  recentOnly?: boolean;
}): Result<readonly PlannedDistilBatch[], CensusRowUnreadableError> {
  const cuts = cutBatches({
    members: [...census.winners.values()],
    ...(targetPerBatch !== undefined ? { targetPerBatch } : {}),
    ...(topContainersPerSource !== undefined ? { topContainersPerSource } : {}),
    ...(recentOnly !== undefined ? { recentOnly } : {}),
  });
  const planned: PlannedDistilBatch[] = [];
  for (const cut of cuts) {
    const records = readCensusRecords({ entries: cut.members, projection: BATCH_PROJECTION, reader });
    if (records.isErr()) {
      return err(records.error);
    }
    planned.push({
      container: cut.container,
      hash: hashBatch({ container: cut.container, promptVersion, records: records.value, source: cut.source }),
      members: cut.members,
      source: cut.source,
    });
  }
  return ok(planned);
}

/**
 * Read one planned batch's records back into the {@link DistilBatch} every prompt, brief and digest check
 * takes.
 *
 * @param batch the planned batch
 * @param reader the open row reader
 * @returns the batch with its records, or the reason a row could not be read back
 */
export function materialiseBatch({
  batch,
  reader,
}: {
  batch: PlannedDistilBatch;
  reader: RowReader;
}): Result<DistilBatch, CensusRowUnreadableError> {
  const records = readCensusRecords({ entries: batch.members, projection: BATCH_PROJECTION, reader });
  if (records.isErr()) {
    return err(records.error);
  }
  return ok({ container: batch.container, hash: batch.hash, records: records.value, source: batch.source });
}

/**
 * The census's records for a set of logical identities, read back by pointer — what a brief's pinned refs
 * resolve against. An identity the census does not hold is simply absent from the result, so the caller's
 * own resolution reports it exactly as it reported a record missing from a whole-corpus array.
 *
 * @param census the corpus census
 * @param refs the identities to read
 * @param reader the open row reader
 * @returns the records present, in `refs` order, or the reason a row could not be read back
 */
export function censusRecordsFor({
  census,
  refs,
  reader,
}: {
  census: CorpusCensus;
  refs: readonly { readonly source: string; readonly container: string; readonly sourceId: string }[];
  reader: RowReader;
}): Result<readonly CorpusRecord[], CensusRowUnreadableError> {
  const entries: CensusEntry[] = [];
  for (const ref of refs) {
    const entry = census.winners.get(identityOf(ref));
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return readCensusRecords({ entries, projection: BATCH_PROJECTION, reader });
}

/**
 * How many logical records each source holds — the per-source figure a source digest reports. Pure.
 *
 * @param census the corpus census
 * @returns the count per source
 */
export function censusCountsBySource({ census }: { census: CorpusCensus }): ReadonlyMap<CorpusSource, number> {
  const counts = new Map<CorpusSource, number>();
  for (const entry of census.winners.values()) {
    const prior = counts.get(entry.source);
    counts.set(entry.source, prior === undefined ? 1 : prior + 1);
  }
  return counts;
}
