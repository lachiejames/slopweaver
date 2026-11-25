/**
 * The bronze write pipeline: **redact → fingerprint-dedup → append JSONL**. Redaction runs first so no
 * secret ever touches disk (and so the fingerprint is computed over the exact bytes we persist). Dedup
 * is per `sourceId`: a record is written only when its content fingerprint is NEW for that id AND its
 * version stamp (`./recordVersion.ts`: its `tsIso`, or a diary row's modification time) is at least the newest
 * already stored — which makes refresh idempotent (re-running writes nothing) and update-aware (a genuine edit
 * writes a new line, a stale re-fetch does not).
 *
 * The dedup index the writer consults, and the digest it keys on, are `./bronzeDedupIndex.ts`.
 */
import { slopweaverHome } from "../config.js";
import type { HeapGuard } from "../lib/heapBudget.js";
import { err, ok, type Result } from "../lib/result.js";
import { currentSyncRunObserver } from "../syncRun/observerScope.js";
import { appendBronzeLines, bucketRecordsBySource } from "./bronzeAppend.js";
import {
  type BronzeDedupIndex,
  type BronzeDedupIndexBuild,
  buildGuardedDedupIndex,
  recordDedupDigest,
} from "./bronzeDedupIndex.js";
import { isFreshRecord } from "./bronzeFreshness.js";
import {
  bronzeJudgeFor,
  type CorpusWalkJudge,
  type OwnerProtectionResolver,
  protectionResolver,
} from "./bronzeProtection.js";
import { commitRefusal } from "./commitRefusal.js";
import { bronzeFile } from "./corpusPaths.js";
import { canonicalNotionRecord } from "./notion/canonicalId.js";
import { serialiseRecord } from "./recordSerialisation.js";
import { redactRecord } from "./redactRecord.js";
import { excludeFromSync, lazyExclusion, type SyncExclusion } from "./syncExclusion.js";
import { type CorpusRecord, type CorpusSource, type ExportWindow } from "./types.js";

/**
 * The subset of a bucket that should be written — new digest AND not older than what's stored. Mutates
 * `index` (the caller's per-source dedup index) as it accepts records, so a duplicate within the same bucket
 * is caught too.
 *
 * @param bucket the records for one source
 * @param index the per-source dedup index (mutated)
 * @returns the fresh records, in input order
 */
export function freshRecordsForBucket({
  bucket,
  index,
}: {
  bucket: readonly CorpusRecord[];
  index: BronzeDedupIndex;
}): readonly CorpusRecord[] {
  return bucket.filter((record) => isFreshRecord({ digest: recordDedupDigest({ record }), index, record }));
}

export interface WriteResult {
  readonly written: number;
  readonly deduped: number;
  readonly bySource: Readonly<Record<string, number>>;
  /**
   * Records dropped before dedup because their author is on the install's sync denylist
   * ({@link ./syncExclusion}).
   *
   * Reported rather than merely applied, and counted SEPARATELY from `deduped`, because the two mean
   * opposite things to an operator: a deduped record is one bronze already holds, and an excluded one is a
   * record bronze will never hold. Collapsing them would make a denylist that silently matched too much
   * indistinguishable from an ordinary re-fetch.
   */
  readonly excluded: number;
}

/**
 * A bronze writer that keeps its per-source dedup index ACROSS commits.
 *
 * This is what makes a PER-CONTAINER commit affordable. {@link writeCorpusRecords} rebuilds the dedup index
 * by reading every record the source already holds — correct, and the right cost when a run writes once.
 * Measured, it is the wrong cost when a run writes hundreds of times: Slack bronze alone was hundreds of MB /
 * hundreds of thousands of records, so one index build per conversation would have cost hours of pure re-parsing, and the
 * durable-commit change would have paid for its own durability by never finishing.
 *
 * A committer builds each source's index at most ONCE and then carries its own writes forward in memory, so
 * the Nth commit costs the same as the first. Everything else — redaction, the fingerprint, the flat
 * per-window file — is the same single write path; only the index lifetime differs.
 */
export interface BronzeCommitter {
  /**
   * Redact, dedup and append one batch, returning its write stats. Every accepted record is on disk when
   * this returns — that is the whole point: a kill after commit N keeps containers 1..N.
   */
  readonly commit: (args: { records: readonly CorpusRecord[] }) => Result<WriteResult>;
}

/**
 * Append each source's fresh records to its window file, refusing before the first write on a bad index.
 *
 * Split out of the committer for length, and the split falls where it does because everything above it is
 * about WHICH records may be written and everything here is about getting them onto disk.
 *
 * Every source is judged against the owner's protect list first: its dedup walk inside `indexFor`, and its window
 * file as a write just before the append.
 *
 * @param redacted the admitted, redacted batch
 * @param indexFor the committer's per-source dedup index, held across commits
 * @param protection resolves the owner's protect-list entries
 * @param home the Slopweaver home the window files live under
 * @param window the export window naming the target file
 * @returns how many records reached disk, per source and in total, and which, or the refusal that stopped the write
 * @internal — reached only through {@link createBronzeCommitter}; nothing outside this file names it.
 */
function appendBuckets({
  redacted,
  indexFor,
  protection,
  home,
  window,
}: {
  redacted: readonly CorpusRecord[];
  indexFor: (args: { source: CorpusSource; walk: CorpusWalkJudge }) => Result<BronzeDedupIndexBuild>;
  protection: OwnerProtectionResolver;
  home: string;
  window: ExportWindow;
}): Result<{ bySource: Record<string, number>; written: number; fresh: readonly CorpusRecord[] }> {
  const bySource: Record<string, number> = {};
  let appended: readonly CorpusRecord[] = [];
  for (const [source, bucket] of bucketRecordsBySource({ records: redacted })) {
    const judged = bronzeJudgeFor({ protection, source }).andThen((walk) =>
      indexFor({ source, walk }).map((stored) => ({ judge: walk.judge, stored })),
    );
    if (judged.isErr()) {
      return err(judged.error);
    }
    const { judge, stored } = judged.value;
    // REFUSE rather than write, on either reason. A partial dedup index does not make the write slightly
    // worse, it makes it wrong in the expensive direction: every record the index missed is about to be
    // appended a second time.
    //
    // The two reasons are reported SEPARATELY because their fixes have nothing in common, and collapsing
    // them is what hid a Slack outage: a heap refusal inside the old reader surfaced here
    // as "path(s) could not be read", which reads as a permission bit, so five days of silently
    // no-op'd refreshes looked like a `chmod` nobody had got round to.
    const refusal = commitRefusal({ source, stored });
    if (refusal !== undefined) {
      return err([refusal]);
    }
    const fresh = freshRecordsForBucket({ bucket, index: stored.index });
    if (fresh.length === 0) {
      continue;
    }
    const file = bronzeFile({ home, source, window });
    const writable = judge({ access: "write", path: file });
    if (writable.isErr()) {
      return err(writable.error);
    }
    const lines = fresh.map((record) => serialiseRecord({ record }));
    const wrote = appendBronzeLines({ file, lines });
    if (wrote.isErr()) {
      return err(wrote.error);
    }
    bySource[source] = fresh.length;
    appended = appended.concat(fresh);
  }
  return ok({ bySource, fresh: appended, written: appended.length });
}

/**
 * The committer's per-source dedup index, built on a source's first commit and held for every later one.
 *
 * A refused walk is never held, so the next commit to that source is judged, and refused, again.
 *
 * @param home the Slopweaver home the window files live under
 * @param indices the committer's held builds, which a failed write clears
 * @param heapGuard the guard the dedup-index build consults — the real isolate unless a test injects one
 * @returns the lookup the append step asks for a source's index
 */
function heldIndexFor({
  home,
  indices,
  heapGuard,
}: {
  home: string;
  indices: Map<CorpusSource, BronzeDedupIndexBuild>;
  heapGuard?: HeapGuard;
}): (args: { source: CorpusSource; walk: CorpusWalkJudge }) => Result<BronzeDedupIndexBuild> {
  return ({ source, walk }) => {
    const existing = indices.get(source);
    if (existing !== undefined) {
      return ok(existing);
    }
    const built = buildGuardedDedupIndex({ home, source, walk, ...(heapGuard !== undefined ? { heapGuard } : {}) });
    if (built.isOk()) {
      indices.set(source, built.value);
    }
    return built;
  };
}

/**
 * Open a bronze committer over one window.
 *
 * @param window the export window (names the target file, shared by every commit)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param heapGuard the guard the dedup-index build consults — the real isolate unless a test injects one
 * @param protection the owner's protect-list entries; production reads both registries on the first commit
 * @returns the committer
 */
export function createBronzeCommitter({
  window,
  home = slopweaverHome(),
  heapGuard,
  exclusion,
  protection,
}: {
  window: ExportWindow;
  home?: string;
  heapGuard?: HeapGuard;
  /** Injected only by tests; production resolves it from `home` on the first commit. */
  exclusion?: SyncExclusion;
  protection?: OwnerProtectionResolver;
}): BronzeCommitter {
  const indices = new Map<CorpusSource, BronzeDedupIndexBuild>();
  const exclusionFor = lazyExclusion({ home, ...(exclusion !== undefined ? { exclusion } : {}) });
  const protectionFor = protectionResolver({ home, ...(protection !== undefined ? { protection } : {}) });
  const indexFor = heldIndexFor({ home, indices, ...(heapGuard !== undefined ? { heapGuard } : {}) });
  return {
    commit: ({ records }): Result<WriteResult> => {
      // Excluded BEFORE redaction and before dedup, so a denied author costs nothing downstream: it is
      // never fingerprinted, never held in the dedup index, and never reaches a window file. This is the
      // one place an ingest can admit a record to bronze, which is why the check lives here rather than in
      // each connector — a new connector inherits it by existing.
      const denylist = exclusionFor();
      if (denylist.isErr()) {
        return err(denylist.error);
      }
      const admitted = excludeFromSync({ exclusion: denylist.value, records });
      // Re-keyed here for the same reason: whichever path built it — a crawl, a heal, a load — a Notion page
      // is admitted under the one spelling of its id, so no writer can mint a second identity for it.
      const redacted = admitted.kept.map((record) => redactRecord({ record: canonicalNotionRecord({ record }) }));
      const appended = appendBuckets({ home, indexFor, protection: protectionFor, redacted, window });
      if (appended.isErr()) {
        // The index took this batch in before its append ran, so after a failed write it claims records
        // that never reached disk; the next commit rebuilds it from what is actually there.
        indices.clear();
        return err(appended.error);
      }
      const { bySource, written, fresh } = appended.value;
      // Told AFTER the append, so a ledger row never claims a record that did not reach disk; see
      // `../syncRun/observerScope.ts` for why the observer is read here rather than passed in.
      currentSyncRunObserver()?.commit({ offered: redacted, written: fresh });
      return ok({ bySource, deduped: admitted.kept.length - written, excluded: admitted.excluded, written });
    },
  };
}

/**
 * Redact, dedup, and append the fresh records to their per-source window file.
 *
 * One shot over a freshly built dedup index — the right shape for a caller that writes once. A caller that
 * commits container by container wants {@link createBronzeCommitter} instead, which is the same write path
 * with the index held open.
 *
 * @param records the records to persist
 * @param window the export window (names the target file)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param heapGuard the guard the dedup-index build consults — the real isolate unless a test injects one
 * @param exclusion the install's sync author denylist; defaults to excluding nothing
 * @param protection the owner's protect-list entries; production reads both registries
 * @returns the write stats: `written` (new lines), `deduped` (collapsed inputs), `excluded` (denied
 *   authors), `bySource`
 */
export function writeCorpusRecords({
  records,
  window,
  home = slopweaverHome(),
  heapGuard,
  exclusion,
  protection,
}: {
  records: readonly CorpusRecord[];
  window: ExportWindow;
  home?: string;
  heapGuard?: HeapGuard;
  exclusion?: SyncExclusion;
  protection?: OwnerProtectionResolver;
}): Result<WriteResult> {
  return createBronzeCommitter({
    home,
    window,
    ...(heapGuard !== undefined ? { heapGuard } : {}),
    ...(exclusion !== undefined ? { exclusion } : {}),
    ...(protection !== undefined ? { protection } : {}),
  }).commit({ records });
}
