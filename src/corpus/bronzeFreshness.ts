/**
 * The bronze writer's freshness rule, one record at a time: whether a record joins bronze, and what an
 * already-stored one teaches the dedup index. The index's shape and its digest live with the writer
 * (`corpusWriter.ts`); the caller hands each record's digest in, so this module needs neither at run time.
 */
import type { BronzeDedupIndex } from "./bronzeDedupIndex.js";
import type { CorpusRecord } from "./types.js";

/**
 * Sources whose bronze latest view lets the later-written row win a tie (`latestRecords.ts`), and whose record can
 * go back to a version bronze already holds: a ChatGPT chat renamed and renamed back, or a reply switched to an
 * alternate and back to current, gives the message an older fingerprint at the same instant. Deduped as already
 * seen, that revert would never be written and the latest view would keep serving the version in between, so a
 * seen digest is written again when it is not the one written last for its id. Confined to `chatgpt`: it is the one
 * source whose export is known to carry a revert, and every other source keeps the one-row-per-fingerprint rule.
 */
const REVERTIBLE_SOURCES: ReadonlySet<string> = new Set(["chatgpt"]);

/** Note `digest` as the one written last for a {@link REVERTIBLE_SOURCES} record's id. */
function noteLatest({
  record,
  digest,
  index,
}: {
  record: CorpusRecord;
  digest: string;
  index: BronzeDedupIndex;
}): void {
  if (REVERTIBLE_SOURCES.has(record.source)) {
    index.latestDigest.set(record.sourceId, digest);
  }
}

/**
 * Absorb one ALREADY-STORED record into the index. Deliberately not {@link isFreshRecord}: a stored record is not
 * "fresh" or "stale", it is simply present, so the newer-than-stored rule has nothing to decide here.
 *
 * @param record the stored record
 * @param digest its dedup digest
 * @param index the index being built (mutated)
 */
export function absorbStoredRecord({
  record,
  digest,
  index,
}: {
  record: CorpusRecord;
  digest: string;
  index: BronzeDedupIndex;
}): void {
  index.seen.add(digest);
  noteLatest({ digest, index, record });
  const newest = index.newestTs.get(record.sourceId);
  if (newest === undefined || record.tsIso > newest) {
    index.newestTs.set(record.sourceId, record.tsIso);
  }
}

/**
 * Whether `record` should be written: a new digest for its id (or, for a {@link REVERTIBLE_SOURCES} record, one that
 * is not the digest written last for it) AND not older than what's stored. Accepting it updates the index.
 *
 * @param record the record offered
 * @param digest its dedup digest
 * @param index the source's dedup index (mutated on acceptance)
 * @returns whether to write it
 */
export function isFreshRecord({
  record,
  digest,
  index,
}: {
  record: CorpusRecord;
  digest: string;
  index: BronzeDedupIndex;
}): boolean {
  const newest = index.newestTs.get(record.sourceId);
  if (newest !== undefined) {
    const reverts = REVERTIBLE_SOURCES.has(record.source) && index.latestDigest.get(record.sourceId) !== digest;
    if ((index.seen.has(digest) && !reverts) || record.tsIso < newest) {
      return false;
    }
  }
  index.seen.add(digest);
  noteLatest({ digest, index, record });
  if (newest === undefined || record.tsIso > newest) {
    index.newestTs.set(record.sourceId, record.tsIso);
  }
  return true;
}
