/**
 * Group the corpus into distil batches — one LLM call's worth of records, bucketed by `source + container`
 * and cut at CONTENT-DEFINED boundaries. Pure, deterministic. Each batch carries a **content hash**
 * (`sha256(promptVersion + source+container + each record's sourceId + its PROMPTED body).slice(0,16)`)
 * that is the cache key: it changes iff the batch's records, the text distil actually PROMPTS with, or the
 * distil contract change — never on an edit outside the slice the prompt never reads — so a re-run only
 * re-calls the model for batches that are genuinely stale. That slice is a share of a per-BATCH budget
 * rather than a fixed 1,200 characters (see `recordBody.promptBodies`), so a record's own hashed text can
 * move when a record BESIDE it changes length. That is correct: the prompt changed, so the digest is stale.
 *
 * `promptVersion` is in the key as of PR5.4. Without it, changing the `SYSTEM` prompt or the digest schema
 * left every cached digest still hitting, so old output was served under a new contract with nothing marking
 * the boundary. It is a REQUIRED parameter rather than a defaulted one so the two call sites (`distil` and
 * `audit`, which must agree or `audit` would report every batch uncached) cannot silently drift apart.
 *
 * ## Why boundaries ride on record identity, not position
 *
 * Batches used to be sorted newest-first and sliced into fixed 40-record chunks. A chunk boundary was a
 * POSITION, so one new record at the front shifted every downstream boundary and re-hashed *every* batch in
 * the container — making an ordinary `refresh` a silent mass re-spend. Measured on a real container of over
 * ten thousand records (hundreds of batches), inserting one record changed a mean of **about half** the batches.
 *
 * Sorting the other way does NOT fix it. Ascending order only helps records that append at the newest end,
 * and **18.3% of real records arrive out of chronological order** — a GitHub or Linear record's `tsIso` is
 * its creation time while `refresh` fetches by update time, so an old item that just got a comment lands
 * mid-history. Measured, ascending scored the same mean 148.
 *
 * So a boundary is placed by the RECORD rather than by its position: cut after any record whose `sourceId`
 * hash lands in a 1-in-`targetPerBatch` slice, clamped to `[target/2, target*1.5]`. An insertion then
 * perturbs only the region between two surviving boundaries, because the next gated record re-synchronises
 * the cut — measured mean **1.9**, max **6** batches changed. The clamps keep the token profile tight
 * (p50 37 / p95 60 / max 60 records), which protects digest grounding: a batch far larger than the target
 * yields fewer points per record and thinner citations.
 *
 * The gate hash is `node:crypto` SHA-256 over the `sourceId` — a fixed, unseeded, standardised function, so
 * boundaries are byte-identical across processes, machines, and Node versions. Anything per-run seeded here
 * (a V8 string hash, a clock, a random) would move every boundary on every invocation and collapse the whole
 * scheme into a permanent cache miss.
 */
import { createHash } from "node:crypto";

import type { CorpusRecord, CorpusSource } from "../corpus/types.js";
import { compareStrings } from "../lib/compare.js";
import { promptBodies } from "./recordBody.js";

/**
 * The TARGET records per batch — the mean the content-defined boundaries aim for, not a hard ceiling. The
 * hard ceiling is 1.5x this (60 at the default 40).
 */
export const DEFAULT_TARGET_PER_BATCH = 40;

/** A batch is never cut below half the target — stops the gate producing runts. */
const MIN_BATCH_FRACTION = 0.5;

/** A batch is force-cut at 1.5x the target — bounds the token size of any single call. */
const MAX_BATCH_FRACTION = 1.5;

/**
 * The batching scheme's identity, folded into the distil contract fingerprint. A change to the algorithm or
 * to either clamp moves every boundary, so it must invalidate the cache LOUDLY — through PR5.4's refusal —
 * rather than silently re-hashing behind the user's back. Derived from the constants so it cannot drift.
 */
export const BATCHING_SCHEME = `cdc-sha256-v1 ${String(MIN_BATCH_FRACTION)} ${String(MAX_BATCH_FRACTION)}`;

/**
 * The fields a batch CUT reads off a record — which container it is in, where it sits in time, and the id
 * its boundary gate hashes. A record satisfies it, and so does a `corpus/corpusCensus.CensusEntry` standing
 * in for one: the cut never reads a body, only the HASH does, which is what lets the streaming planner cut
 * the whole corpus from a census and read records back one batch at a time.
 */
export interface BatchMember {
  readonly source: CorpusSource;
  readonly container: string;
  readonly sourceId: string;
  readonly tsIso: string;
}

/** One batch as CUT, before anything has read its members' bodies. */
export interface BatchCut<T extends BatchMember> {
  readonly source: CorpusSource;
  readonly container: string;
  readonly members: readonly T[];
}

export interface DistilBatch {
  readonly source: CorpusSource;
  readonly container: string;
  readonly records: readonly CorpusRecord[];
  readonly hash: string;
}

/**
 * The content hash for a batch of records (the cache key) — scoped to the distil contract it was produced
 * under. Exported (not just internal to grouping) because `distil answer` recomputes it at grounding time:
 * given the pinned refs a brief named, this is how it proves the corpus still produces the same batch
 * before spending the visible session's answer on it.
 *
 * Hashes what is actually PROMPTED (`promptBodies`) rather than a record's full `text`. Hashing the full
 * text let an edit entirely outside the slice `buildDigestPrompt` sends invalidate an already-paid batch for
 * no reason the prompt could ever see — the opposite defect, a real one still hashing a slice deeper than
 * what was prompted, is not possible here because both call the identical expression.
 *
 * That shared call now matters more than it did. A record's slice is no longer a fixed 1,200 characters: the
 * batch budget is spent across its records together, so what one record keeps depends on the others. Two
 * sites each writing `.slice(0, DISTIL_RECORD_CHARS)` used to agree by coincidence; two sites each calling
 * `promptBodies` agree by construction, which is why the allowance lives there and not here.
 *
 * @param source the batch's source
 * @param container the batch's container
 * @param records the batch's records, in the order they were grouped
 * @param promptVersion the distil contract fingerprint the batch was cut under
 * @returns the 16-hex-char content hash
 */
export function hashBatch({
  source,
  container,
  records,
  promptVersion,
}: {
  source: CorpusSource;
  container: string;
  records: readonly CorpusRecord[];
  promptVersion: string;
}): string {
  const hash = createHash("sha256");
  hash.update(`${promptVersion} ${source} ${container}`);
  const bodies = promptBodies({ records });
  for (const [index, record] of records.entries()) {
    hash.update(` ${record.sourceId} ${bodies[index]!.body}`);
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Oldest-first within a container: `tsIso` asc, `sourceId` asc tiebreak.
 *
 * A TOTAL order, deliberately. Two records sharing a timestamp must always land the same way round, or a
 * boundary — and therefore a cache key — would depend on the order records happened to be read off disk.
 * Non-determinism in a cache key is a silent re-spend, the same defect class this module exists to close.
 */
function byChronology({ a, b }: { a: BatchMember; b: BatchMember }): number {
  return compareStrings({ a: a.tsIso, b: b.tsIso }) || compareStrings({ a: a.sourceId, b: b.sourceId });
}

/**
 * Busiest first, then by key. A TOTAL order — the key tiebreak means two equal-sized containers can never
 * swap depending on how the corpus was read off disk.
 *
 * One function rather than two identical comparators because {@link keepTopContainers} and {@link rankedKeys}
 * MUST agree: `--top-containers` computing one ranking while emission used another is exactly the defect
 * this shape closes.
 */
function byBusiest(
  x: { key: string; records: readonly BatchMember[] },
  y: { key: string; records: readonly BatchMember[] },
): number {
  return y.records.length - x.records.length || (x.key < y.key ? -1 : 1);
}

/** Group the container buckets by their source, so a per-source ranking can be taken. */
function bucketsBySource<T extends BatchMember>({
  buckets,
}: {
  buckets: Map<string, T[]>;
}): Map<CorpusSource, { key: string; records: T[] }[]> {
  const bySource = new Map<CorpusSource, { key: string; records: T[] }[]>();
  for (const [key, records] of buckets) {
    const source = records[0]?.source ?? "github";
    const list = sourceContainers({ bySource, source });
    list.push({ key, records });
    bySource.set(source, list);
  }
  return bySource;
}

/** The containers listed for a source so far, or a fresh empty list for a source not seen yet. */
function sourceContainers<T>({ bySource, source }: { bySource: Map<CorpusSource, T[]>; source: CorpusSource }): T[] {
  const list = bySource.get(source);
  if (list === undefined) {
    return [];
  }
  return list;
}

/** Keep only the busiest `n` containers per source (drops the low-signal long tail). */
function keepTopContainers<T extends BatchMember>({
  buckets,
  n,
}: {
  buckets: Map<string, T[]>;
  n: number;
}): Map<string, T[]> {
  const kept = new Map<string, T[]>();
  for (const list of bucketsBySource({ buckets }).values()) {
    for (const { key, records } of list.toSorted(byBusiest).slice(0, n)) {
      kept.set(key, records);
    }
  }
  return kept;
}

/**
 * The container keys in the order batches should be EMITTED: busiest container first within each source,
 * sources in their own stable order.
 *
 * This used to be `[...scoped.keys()].toSorted()` — plain alphabetical — which threw away the ranking
 * `--top-containers` had just computed. `distil brief` hands out the first uncached batch, so with a cold
 * cache that order IS the selection: measured on the real corpus, `--top-containers 5` handed a
 * session the 4th-ranked container first and the 1st-ranked one third, purely because of how the names sort.
 *
 * Cache keys do not move — `hashBatch` carries no position — so this re-orders what a session is offered
 * without invalidating anything already paid for.
 *
 * @param scoped the container buckets that survived scoping
 * @returns the keys, best-first per source
 */
function rankedKeys<T extends BatchMember>({ scoped }: { scoped: Map<string, T[]> }): readonly string[] {
  const bySource = bucketsBySource({ buckets: scoped });
  const keys: string[] = [];
  for (const source of [...bySource.keys()].toSorted()) {
    // `source` is one of `bySource`'s own keys, read back with nothing deleted between.
    for (const { key } of bySource.get(source)!.toSorted(byBusiest)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The batch-size clamps for a target. `min` floors at 1 and `max` never drops below `min`, so a degenerate
 * target (`--max-per-batch 1`) still produces one record per batch rather than an empty range.
 */
function clampsFor({ target }: { target: number }): { min: number; max: number } {
  const min = Math.max(1, Math.floor(target * MIN_BATCH_FRACTION));
  return { max: Math.max(min, Math.ceil(target * MAX_BATCH_FRACTION)), min };
}

/**
 * Is there a batch boundary after this record? Content-defined: the decision rides on a hash of the record's
 * own `sourceId`, so it is a property of the RECORD and independent of where the record sits in the
 * container. That positional independence is the whole point — see the module comment.
 */
function isBoundaryRecord({ sourceId, target }: { sourceId: string; target: number }): boolean {
  const gate = Number.parseInt(createHash("sha256").update(sourceId).digest("hex").slice(0, 8), 16);
  return gate % target === 0;
}

/**
 * Cut oldest-first records into content-defined batches, clamped to `[min, max]`.
 *
 * @param records the container's records, already in {@link byChronology} order
 * @param target the mean batch size the gate aims for
 * @returns the batches, oldest first
 */
function contentDefinedBatches<T extends BatchMember>({
  records,
  target,
}: {
  records: readonly T[];
  target: number;
}): readonly (readonly T[])[] {
  const { min, max } = clampsFor({ target });
  const batches: T[][] = [];
  let current: T[] = [];
  for (const record of records) {
    current.push(record);
    const gated = current.length >= min && isBoundaryRecord({ sourceId: record.sourceId, target });
    if (gated || current.length >= max) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    batches.push(current); // the trailing partial batch — the only one a pure append can disturb
  }
  return batches;
}

/**
 * The batches for one container.
 *
 * `recentOnly` takes the newest `target` records as a single batch. Otherwise the content-defined batches are
 * emitted NEWEST-FIRST: `distilBatches` caps fresh model calls by taking `uniqueMisses.slice(0, maxCalls)`,
 * so array order decides what a capped run spends on. Cutting from the oldest end but emitting newest-first
 * keeps stable boundaries AND the pre-existing "a capped run distils recent content" behaviour.
 *
 * @param bucket the container's records, in arbitrary read order
 * @param target the mean batch size
 * @param recentOnly take only the newest `target` records as one batch
 * @returns the batches for this container, newest first
 */
function batchesForContainer<T extends BatchMember>({
  bucket,
  target,
  recentOnly,
}: {
  bucket: readonly T[];
  target: number;
  recentOnly: boolean;
}): readonly (readonly T[])[] {
  const sorted = bucket.toSorted((a, b) => byChronology({ a, b }));
  return recentOnly ? [sorted.slice(-target)] : contentDefinedBatches({ records: sorted, target }).toReversed();
}

/** Bucket members by `source container`, in first-seen order. */
function bucketByContainer<T extends BatchMember>({ members }: { members: readonly T[] }): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const member of members) {
    const key = `${member.source} ${member.container}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [member]);
    } else {
      bucket.push(member);
    }
  }
  return buckets;
}

/**
 * Cut members into distil batches WITHOUT hashing them: bucket by `source + container`, scope to the busiest
 * containers when asked, and cut each container at its content-defined boundaries.
 *
 * Split from {@link groupForDistil} because the cut reads only {@link BatchMember}'s four fields while the
 * hash reads bodies. The streaming planner (`cli/commands/distil/plan.ts`) cuts the whole corpus from a census
 * that holds no body at all, then reads each batch's records back to hash it — so the corpus is never in
 * heap at once, and the batches are the ones {@link groupForDistil} would have cut from the same records.
 *
 * @param members the members to cut — records, or census entries standing for them
 * @param targetPerBatch the TARGET members per batch; the hard ceiling is 1.5x this
 * @param topContainersPerSource keep only the busiest N containers per source (optional)
 * @param recentOnly take only the newest `targetPerBatch` members per container as one batch
 * @returns the cuts, busiest container first within each source, newest batch first within each container
 */
export function cutBatches<T extends BatchMember>({
  members,
  targetPerBatch = DEFAULT_TARGET_PER_BATCH,
  topContainersPerSource,
  recentOnly = false,
}: {
  members: readonly T[];
  targetPerBatch?: number;
  topContainersPerSource?: number;
  recentOnly?: boolean;
}): readonly BatchCut<T>[] {
  const buckets = bucketByContainer({ members });
  const scoped =
    topContainersPerSource !== undefined ? keepTopContainers({ buckets, n: topContainersPerSource }) : buckets;

  const cuts: BatchCut<T>[] = [];
  for (const key of rankedKeys({ scoped })) {
    const bucket = scoped.get(key);
    const first = bucket?.[0];
    if (bucket === undefined || first === undefined) {
      continue;
    }
    for (const slice of batchesForContainer({ bucket, recentOnly, target: targetPerBatch })) {
      if (slice.length > 0) {
        cuts.push({ container: first.container, members: slice, source: first.source });
      }
    }
  }
  return cuts;
}

/**
 * Group records into distil batches: {@link cutBatches}, then {@link hashBatch} over each cut's records.
 *
 * @param records the corpus records
 * @param promptVersion the distil contract fingerprint (`DISTIL_PROMPT_FINGERPRINT`) folded into every key
 * @param targetPerBatch the TARGET records per batch (default {@link DEFAULT_TARGET_PER_BATCH}); the hard
 *   ceiling is 1.5x this, since boundaries are content-defined rather than a fixed slice
 * @param topContainersPerSource keep only the busiest N containers per source (optional)
 * @param recentOnly take only the newest `targetPerBatch` records per container as one batch (bounded first run)
 * @returns the batches, sorted by `source container`, newest batch first within each container
 */
export function groupForDistil({
  records,
  promptVersion,
  targetPerBatch,
  topContainersPerSource,
  recentOnly,
}: {
  records: readonly CorpusRecord[];
  promptVersion: string;
  targetPerBatch?: number;
  topContainersPerSource?: number;
  recentOnly?: boolean;
}): readonly DistilBatch[] {
  const cuts = cutBatches({
    members: records,
    ...(targetPerBatch !== undefined ? { targetPerBatch } : {}),
    ...(topContainersPerSource !== undefined ? { topContainersPerSource } : {}),
    ...(recentOnly !== undefined ? { recentOnly } : {}),
  });
  return cuts.map(({ source, container, members }) => ({
    container,
    hash: hashBatch({ container, promptVersion, records: members, source }),
    records: members,
    source,
  }));
}
