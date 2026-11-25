/**
 * The bronze DEDUP INDEX the writer (`./corpusWriter.ts`) consults before every append: the digest a record is keyed
 * by, and the streaming build that walks one source's stored rows into it without retaining a record.
 *
 * It is its own module because it is the one half of the write path `compact`, `audit` and `dev dedup-index` reach
 * without writing anything: they key and measure exactly as the writer does, through this file, and never through the
 * committer.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { slopweaverHome } from "../config.js";
import { guardHeap, type HeapGuard, type HeapShortfall } from "../lib/heapBudget.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { absorbStoredRecord } from "./bronzeFreshness.js";
import { type CorpusWalkJudge, protectedBronzeRefusal } from "./bronzeProtection.js";
import { bronzeSourceDir } from "./corpusPaths.js";
import { parseRow } from "./corpusRowCore.js";
import { type JsonlScan, readJsonlLines, scanJsonl, scanJsonlGuarded } from "./corpusStore.js";
import { recordContentFingerprint } from "./recordSerialisation.js";
import type { CorpusRecord, CorpusSource } from "./types.js";

/**
 * The corpus DEDUP KEY: a record's `sourceId` paired with its content fingerprint. The `\u0000`
 * separator is escaped (never a literal NUL byte in the source) and cannot occur inside a `sourceId`, so
 * two different `(id, fingerprint)` pairs can never concatenate into the same key.
 *
 * The compactor and `slopweaver audit` must key EXACTLY as the writer does, so they key through
 * {@link recordDedupDigest}, which hashes this — one implementation and no drift.
 *
 * @param record the record to key
 * @returns the dedup key
 */
function corpusDedupKey({ record }: { record: CorpusRecord }): string {
  return `${record.sourceId}\u0000${recordContentFingerprint({ record })}`;
}

/**
 * The bronze DEDUP INDEX: everything the writer needs to know about what is already on disk, and nothing
 * else.
 *
 * ## Why it holds digests rather than records
 *
 * This index used to be built by reading every stored record back into memory (`readCorpusDir`) and keying
 * a `Set<string>` on the full {@link recordContentFingerprint} — which is the canonical serialisation of the
 * record, so the index cost MORE than the corpus it indexed. On a real home that stopped working:
 * `bronze/slack` held several GiB across a couple of dozen window files, most of it in one, and the reader's heap guard
 * refused the load. The writer then saw an unreadable source and — correctly, per the refusal in the committer
 * (`BronzeCommitter`, `./corpusWriter.ts`) — declined to write. **Every live Slack refresh had been a silent no-op** and
 * nothing on any surface said so.
 *
 * So the index keys on a fixed-width DIGEST of {@link corpusDedupKey} and never retains a record at all.
 * Two consequences worth stating, because they are the whole design:
 *
 *  - **The cost per record is constant**, independent of how big the record is. A 40 KiB Slack row with a
 *    `raw` payload and a 200-byte `self` row cost the same to index. That is what makes
 *    {@link DEDUP_INDEX_BYTES_PER_RECORD} a per-ROW constant rather than a per-byte coefficient of the kind
 *    `HEAP_BYTES_PER_DISK_BYTE` has to be.
 *  - **`seen` is keyed on the pair, so it needs no per-`sourceId` nesting.** {@link corpusDedupKey} already
 *    concatenates the id and the fingerprint under a separator neither can contain, so one flat set is
 *    exactly as discriminating as a map of sets and costs one object instead of one per id.
 *
 * `newestTs` stays a full string rather than a digest because it is COMPARED, not matched — the
 * newer-than-stored rule reads it with `<`/`>`.
 *
 * @internal — consumers get one from {@link emptyBronzeDedupIndex} or {@link buildBronzeDedupIndex} and
 * pass it straight back; nothing outside the bronze write path needs the shape by name.
 */
export interface BronzeDedupIndex {
  /** {@link recordDedupDigest} for every record already stored, and every one accepted since. */
  readonly seen: Set<string>;
  /** The time of the newest version stamp stored per `sourceId` (`./recordVersion.ts`): a diary's modification time. */
  readonly newestTs: Map<string, string>;
  /**
   * The `sourceId`s whose newest stored stamp is a FALLBACK — a diary row with no modification time, ordered by
   * its start. A set of the exceptions rather than a basis per entry, so a source with none pays one empty set.
   */
  readonly fallbackVersion: Set<string>;
  /** For a source whose records can revert (`bronzeFreshness.ts`), the digest written LAST per `sourceId`. */
  readonly latestDigest: Map<string, string>;
}

/**
 * How many hex characters of the sha256 the dedup digest keeps — 128 bits.
 *
 * A truncated digest trades collision probability for heap, and a collision here is silent data loss (a
 * genuinely new record read as already-stored), so the bound is stated rather than assumed. At 128 bits the
 * birthday probability over a source of about two million rows is ~n²/2^129, about
 * 6e-27 — and it stays negligible at every size this design will see, because the bound grows with the
 * SQUARE of the row count against a 39-digit denominator. Keeping all 64 characters would double the
 * index's string cost to buy nothing measurable.
 *
 * Count the rows it is bracketed against with `wc -l ~/.slopweaver/corpus/bronze/slack/*.jsonl`.
 */
const DEDUP_DIGEST_HEX_CHARS = 32;

/**
 * Live heap bytes the index retains per record — the quantity {@link buildBronzeDedupIndex}'s guard projects.
 *
 * Measured with `slopweaver dev dedup-index --source <source>` against the real corpus (post-GC live heap,
 * never RSS); that verb's exit code says whether the number below still covers what the index retains.
 * Re-measure with it whenever the index's shape changes.
 *
 * It is a per-ROW constant rather than a coefficient of disk bytes, and the measurement is what says so:
 *
 * | source | bytes/record | bytes/disk byte |
 * | ------ | ------------ | --------------- |
 * | linear |          220 |           0.062 |
 * | notion |          235 |           0.073 |
 * | slack  |          259 |           0.067 |
 * | gmail  |          294 |           0.132 |
 * | github |          264 |           0.024 |
 * | self   |          346 |           0.266 |
 *
 * Each source measured ran from thousands to over a million rows.
 *
 * Per record the spread is 1.6×, across sources whose mean row is 90× apart on disk; per disk byte it is
 * 11×. So one number covers every source here, where a per-byte coefficient would need the same band
 * `HEAP_BYTES_PER_DISK_BYTE` carries — the index holds one digest, one `sourceId` key and one `tsIso` per
 * record whatever the record weighs. `self` is the ceiling because its `sourceId` is a file path, which is
 * the longest key any source stores.
 *
 * 400 is that ceiling plus 16%, so an ordinary drift in key length does not need a code change to stay
 * covered — and over-projecting here is cheap, because the guard's projection is one 100k-row interval
 * (~38 MiB), never the whole index.
 */
export const DEDUP_INDEX_BYTES_PER_RECORD = 400;

/**
 * How many rows the build absorbs between heap checks. The overshoot past a refusal can never exceed this
 * many rows' worth of index — ~38 MiB at the constant above, orders of magnitude inside the collector
 * reserve `HEAP_RESERVE_FRACTION` already keeps free.
 */
const DEDUP_GUARD_EVERY_ROWS = 100_000;

/**
 * A record's dedup digest: a fixed-width hash of {@link corpusDedupKey}.
 *
 * @param record the record to key
 * @returns the digest, {@link DEDUP_DIGEST_HEX_CHARS} lowercase hex characters
 */
export function recordDedupDigest({ record }: { record: CorpusRecord }): string {
  return createHash("sha256").update(corpusDedupKey({ record }), "utf8").digest("hex").slice(0, DEDUP_DIGEST_HEX_CHARS);
}

/**
 * An index with nothing in it — a source with no bronze on disk yet.
 *
 * @returns the empty index
 */
export function emptyBronzeDedupIndex(): BronzeDedupIndex {
  return {
    fallbackVersion: new Set<string>(),
    latestDigest: new Map<string, string>(),
    newestTs: new Map<string, string>(),
    seen: new Set<string>(),
  };
}

/**
 * What a streaming index build found, and — the load-bearing half — what it could not read.
 *
 * @internal — {@link buildBronzeDedupIndex} returns it, and the writer and `./commitRefusal.ts` read it; no
 * consumer outside the bronze write path names the shape.
 */
export interface BronzeDedupIndexBuild {
  readonly index: BronzeDedupIndex;
  /** Rows absorbed. Reported so a measurement verb can divide live heap by it. */
  readonly rows: number;
  /** Bytes of `.jsonl` walked. */
  readonly diskBytes: number;
  /** Files walked. */
  readonly fileCount: number;
  /**
   * Paths that could not be read at all. NOT diagnostic — see the committer's refusal (`./corpusWriter.ts`): an
   * incomplete index does not degrade the writer's guarantee, it inverts it.
   */
  readonly unreadable: readonly string[];
  /**
   * The heap shortfall that stopped the build, when one did. Kept SEPARATE from `unreadable` because the
   * two have completely different fixes and the writer names them differently: an unreadable path is a
   * `chmod`, a shortfall is a corpus this process cannot index at its ceiling. Collapsing them is exactly
   * what made a Slack outage read as a permissions problem for five days.
   */
  readonly shortfall: HeapShortfall | undefined;
}

/** One build's running state, carried across files so the guard interval does not restart at each one. */
interface DedupIndexRun {
  readonly index: BronzeDedupIndex;
  rows: number;
  /** Rows since the last heap check — see {@link DEDUP_GUARD_EVERY_ROWS}. */
  sinceCheck: number;
  /** Set once the guard refuses; every later line and file is then skipped. */
  shortfall: HeapShortfall | undefined;
}

/**
 * Stream one file's rows into the run's index, stopping at the first chunk after the guard refuses.
 *
 * Throws only what {@link readJsonlLines} throws (an unopenable or unreadable file), which the caller wraps
 * into the typed `unreadable` list.
 */
function absorbFile({ path, run, heapGuard }: { path: string; run: DedupIndexRun; heapGuard: HeapGuard }): void {
  readJsonlLines({
    onLine: ({ line }) => {
      if (run.shortfall !== undefined || line.trim().length === 0) {
        return;
      }
      const parsed = parseRow({ line, projection: "retrieval" });
      // A corrupt line is SKIPPED, exactly as the reader skips it. It is not in the corpus a reader sees, so
      // a writer that indexed it would dedup against a record nobody can read.
      if ("record" in parsed) {
        const record = parsed.record;
        absorbStoredRecord({ digest: recordDedupDigest({ record }), index: run.index, record });
      }
      run.rows += 1;
      run.sinceCheck += 1;
      if (run.sinceCheck < DEDUP_GUARD_EVERY_ROWS) {
        return;
      }
      run.sinceCheck = 0;
      const verdict = heapGuard({ projectedBytes: DEDUP_GUARD_EVERY_ROWS * DEDUP_INDEX_BYTES_PER_RECORD });
      if (!verdict.fits) {
        run.shortfall = verdict;
      }
    },
    // A line callback cannot stop the read mid-chunk, so the chunk seam is what actually ends it.
    onChunk: () => run.shortfall === undefined,
    path,
  });
}

/**
 * Build one source's dedup index by STREAMING every stored row, and say what could not be read while
 * building it.
 *
 * The second half is load-bearing rather than diagnostic. This index IS the writer's dedup guarantee: a
 * record whose digest is already in it is not written again. A read that silently returned fewer records
 * than the source holds therefore does not degrade the guarantee, it INVERTS it — the writer concludes
 * nothing is stored and re-appends work it already had. On the corpus this was written against that would
 * have meant re-writing well over a million Slack records into a fresh window because one old window file
 * had the wrong permission bit.
 *
 * It used to call `readCorpusDir` and key on the whole fingerprint, which retains the entire source. See
 * {@link BronzeDedupIndex} for what that cost and why it stopped working.
 *
 * Rows are parsed in the RETRIEVAL projection deliberately: {@link recordContentFingerprint} drops `raw`
 * before it serialises, so a row's digest is identical either way, and the retrieval projection never
 * materialises the `raw` object at all — on Slack bronze that is most of every line.
 *
 * @param source the corpus source to index
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param heapGuard the guard consulted every {@link DEDUP_GUARD_EVERY_ROWS} rows — the real isolate in
 *   production, a plain fake in tests
 * @returns the index, what it walked, and either the unreadable paths or the heap shortfall that stopped it
 */
export function buildBronzeDedupIndex({
  source,
  home = slopweaverHome(),
  heapGuard = guardHeap,
}: {
  source: CorpusSource;
  home?: string;
  heapGuard?: HeapGuard;
}): BronzeDedupIndexBuild {
  const dir = bronzeSourceDir({ home, source });
  const absent = absentSourceBuild({ dir });
  if (absent !== undefined) {
    return absent;
  }
  return indexScan({ heapGuard, scan: scanJsonl({ dir }) });
}

/**
 * {@link buildBronzeDedupIndex} as the committer runs it: the source directory judged as a search before it is even
 * statted, and the walk judged entry by entry (`scanJsonlGuarded`), so a protected tree is refused before one byte of
 * it is read.
 *
 * The writer is the one walker that REFUSES a covered entry rather than skipping it. A dedup index missing a file
 * re-appends every record that file holds, and the window file it then writes sits in the very tree the owner covered,
 * so the search refuses any entry under the source, and a skip the walk still reports (a symlink resolving into a
 * protected tree elsewhere) refuses too.
 *
 * @param source the corpus source to index
 * @param home the Slopweaver home
 * @param heapGuard the guard the build consults
 * @param walk refuses a step the owner's protect list covers, and names what the walk skipped
 * @returns the index build, or the refusal line
 */
export function buildGuardedDedupIndex({
  source,
  home,
  heapGuard = guardHeap,
  walk,
}: {
  source: CorpusSource;
  home: string;
  heapGuard?: HeapGuard;
  walk: CorpusWalkJudge;
}): Result<BronzeDedupIndexBuild> {
  const dir = bronzeSourceDir({ home, source });
  const searched = walk.judge({ access: "search", path: dir });
  if (searched.isErr()) {
    return err(searched.error);
  }
  const absent = absentSourceBuild({ dir });
  if (absent !== undefined) {
    return ok(absent);
  }
  return scanJsonlGuarded({ dir, walk }).andThen((scan) => {
    const [skipped] = scan.protectedSkipped;
    if (skipped !== undefined) {
      return err([protectedBronzeRefusal({ access: "search", entry: skipped.entry, path: skipped.path, source })]);
    }
    return ok(indexScan({ heapGuard, scan }));
  });
}

/**
 * The empty build for a source with no directory to scan, or `undefined` when there is one.
 *
 * ENOENT is "never ingested", not a failure — the same call the reader makes, for the same reason; any other stat
 * failure is an unreadable path, which the committer refuses on.
 *
 * @param dir the source's bronze directory
 * @returns the empty build, or `undefined` when the directory is there to scan
 */
function absentSourceBuild({ dir }: { dir: string }): BronzeDedupIndexBuild | undefined {
  const statted = safeFs({ execute: () => statSync(dir).isDirectory(), operation: "dedupIndex.stat", path: dir });
  if (statted.isOk() && statted.value) {
    return undefined;
  }
  const unreadable = statted.isErr() && statted.error.code !== "ENOENT" ? [dir] : [];
  return { diskBytes: 0, fileCount: 0, index: emptyBronzeDedupIndex(), rows: 0, shortfall: undefined, unreadable };
}

/**
 * Stream every file a scan found into one dedup index, stopping at the first heap shortfall.
 *
 * @param scan the files the walk found, and the directories it could not list
 * @param heapGuard the guard consulted as rows are absorbed
 * @returns the index build
 */
function indexScan({ scan, heapGuard }: { scan: JsonlScan; heapGuard: HeapGuard }): BronzeDedupIndexBuild {
  const run: DedupIndexRun = { index: emptyBronzeDedupIndex(), rows: 0, shortfall: undefined, sinceCheck: 0 };
  const unreadable: string[] = [...scan.unreadableDirs];
  for (const file of scan.files) {
    if (run.shortfall !== undefined) {
      break;
    }
    const read = safeFs({
      execute: () => {
        absorbFile({ heapGuard, path: file.path, run });
      },
      operation: "dedupIndex.read",
      path: file.path,
    });
    if (read.isErr()) {
      unreadable.push(file.path);
    }
  }
  return {
    diskBytes: scan.files.reduce((sum, file) => sum + file.bytes, 0),
    fileCount: scan.files.length,
    index: run.index,
    rows: run.rows,
    shortfall: run.shortfall,
    unreadable,
  };
}
