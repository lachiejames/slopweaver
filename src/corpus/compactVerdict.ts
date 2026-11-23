/**
 * What compaction does with one record: keep it, prune it past an explicit age horizon, or collapse it as a
 * duplicate of one already kept. The pure half of `compact.ts`, which streams the files and acts on it.
 */
import { parseIsoMs } from "../lib/date.js";
import type { CorpusRecord } from "./types.js";

/**
 * What a streaming compaction does with one record.
 *
 * @internal — {@link classifyForCompaction} returns it; nothing outside the compactor names the type.
 */
export type CompactVerdict = "keep" | "pruned" | "duplicate";

/**
 * True when a record falls strictly before the age horizon. A record whose `tsIso` is absent or
 * unparseable is NEVER pruned — an undateable record can't be proven old, and pruning is the one lossy
 * path, so it fails safe. Pure.
 */
function isPastHorizon({ record, olderThanIso }: { record: CorpusRecord; olderThanIso: string }): boolean {
  const recordMs = parseIsoMs({ tsIso: record.tsIso });
  const horizonMs = parseIsoMs({ tsIso: olderThanIso });
  return recordMs !== undefined && horizonMs !== undefined && recordMs < horizonMs;
}

/**
 * Decide one record's fate against the horizon and the digests already kept. PURE — it reads `seen` and
 * never writes it, so every rule (dedup semantics, the age horizon, their ORDER) is unit-testable without
 * a disk. The caller records a `keep` by adding its digest.
 *
 * The horizon is checked BEFORE the digest, never after. `recordContentFingerprint` is tsIso-BLIND,
 * so a stale copy and a fresh re-capture of the same content share a digest: dedup-first would collapse
 * the in-horizon copy into the out-of-horizon one and then prune the survivor, deleting a record that WAS
 * inside the horizon. A pruned record is therefore never added to `seen` either.
 *
 * @param digest the record's `recordDedupDigest`, computed once by the caller
 * @param record the record being judged
 * @param seen the digests of every record kept so far in this source's walk
 * @param olderThanIso an explicit age horizon, or `undefined` for the lossless default
 * @returns which of the three things happens to this record
 */
export function classifyForCompaction({
  digest,
  record,
  seen,
  olderThanIso,
}: {
  digest: string;
  record: CorpusRecord;
  seen: ReadonlySet<string>;
  olderThanIso: string | undefined;
}): CompactVerdict {
  if (olderThanIso !== undefined && isPastHorizon({ olderThanIso, record })) {
    return "pruned";
  }
  return seen.has(digest) ? "duplicate" : "keep";
}
