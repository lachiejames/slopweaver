/**
 * The bronze writer's freshness rule, one record at a time: whether a record joins bronze, and what an
 * already-stored one teaches the dedup index. The index's shape and its digest live with the writer
 * (`corpusWriter.ts`); the caller hands each record's digest in, so this module needs neither at run time.
 *
 * "Not older than what's stored" is judged on the record's VERSION stamp (`./recordVersion.ts`), the same clock
 * the latest view orders by: a diary row's modification time rather than its start, so an event moved to an
 * earlier time is a newer version, never a stale one.
 */
import type { BronzeDedupIndex } from "./bronzeDedupIndex.js";
import {
  laterRecordVersion,
  ordersByModification,
  type RecordVersion,
  recordVersion,
  sameRecordVersion,
} from "./recordVersion.js";
import type { CorpusRecord, CorpusSource } from "./types.js";

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

/** The newest version stamp the index holds for `sourceId`, or `undefined` when nothing is stored for it. */
function storedVersion({ index, sourceId }: { index: BronzeDedupIndex; sourceId: string }): RecordVersion | undefined {
  const tsIso = index.newestTs.get(sourceId);
  if (tsIso === undefined) {
    return undefined;
  }
  return { basis: index.fallbackVersion.has(sourceId) ? "fallback" : "authoritative", tsIso };
}

/**
 * Where `offered` sits against `stored`: positive when it is the later version, negative when the older, zero when
 * the same. A diary's stamps order exactly as the latest view orders them ({@link laterRecordVersion}: basis, then
 * instant), so the writer never refuses the version the view would serve. Every other source compares its `tsIso`
 * as strings, exactly as this rule always has, so no source but the diaries changes what it writes.
 */
function versionOrder({
  offered,
  stored,
  source,
}: {
  offered: RecordVersion;
  stored: RecordVersion;
  source: CorpusSource;
}): number {
  if (sameRecordVersion({ candidate: offered, incumbent: stored })) {
    return 0;
  }
  if (ordersByModification({ source })) {
    return laterRecordVersion({ candidate: offered, incumbent: stored }) ? 1 : -1;
  }
  return offered.tsIso > stored.tsIso ? 1 : -1;
}

/** Record `version` as the newest stored for the record's id when it outranks what the index holds. */
function noteVersion({
  index,
  record,
  version,
}: {
  index: BronzeDedupIndex;
  record: CorpusRecord;
  version: RecordVersion;
}): void {
  const sourceId = record.sourceId;
  const stored = storedVersion({ index, sourceId });
  if (stored !== undefined && versionOrder({ offered: version, source: record.source, stored }) <= 0) {
    return;
  }
  index.newestTs.set(sourceId, version.tsIso);
  if (version.basis === "fallback") {
    index.fallbackVersion.add(sourceId);
  } else {
    index.fallbackVersion.delete(sourceId);
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
  noteVersion({ index, record, version: recordVersion({ record }) });
}

/**
 * Whether `record` should be written: a new digest for its id (or, for a {@link REVERTIBLE_SOURCES} record, one that
 * is not the digest written last for it) AND not an older version than what's stored. Accepting it updates the index.
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
  const version = recordVersion({ record });
  const stored = storedVersion({ index, sourceId: record.sourceId });
  if (stored !== undefined) {
    const reverts = REVERTIBLE_SOURCES.has(record.source) && index.latestDigest.get(record.sourceId) !== digest;
    if ((index.seen.has(digest) && !reverts) || versionOrder({ offered: version, source: record.source, stored }) < 0) {
      return false;
    }
  }
  index.seen.add(digest);
  noteLatest({ digest, index, record });
  noteVersion({ index, record, version });
  return true;
}
