/**
 * Corpus COMPACTION (PR4.9) — bronze's lifecycle. Every refresh appends a new per-source window file, so
 * a long-lived corpus accumulates overlapping windows forever: distil cost, retrieval, and `audit` all
 * scale with the TOTAL corpus, never the delta. Compaction merges a source's window files into ONE
 * canonical file, running the writer's OWN fingerprint-dedup ACROSS windows (which the per-write index
 * cannot do for records already on disk from a differently-scoped run), and optionally — only when asked
 * — drops records past an age horizon.
 *
 * Three properties make this safe to run on a corpus you care about:
 *
 *  1. **Lossless by default, for every WELL-FORMED record.** The only records dropped are exact
 *     `(sourceId, fingerprint)` duplicates — precisely the pair {@link ./recordSerialisation.recordContentFingerprint} says the
 *     writer would have collapsed. The writer's *newer-than-stored* rule is deliberately NOT applied: a
 *     superseded version already on disk is history, not a duplicate, and compaction never rewrites
 *     history. Age-pruning is a second, opt-in lossy mode behind an explicit `--older-than`. A row that was
 *     already invalid on disk (see point 2) is the one loss that is never opt-in, because keeping it would
 *     mean writing a canonical file the corpus's own reader refuses to count as a record. One thing IS
 *     rewritten, and it is spelling rather than history: a Notion row keyed on an undashed page id is
 *     re-keyed onto the dashed id the API writes (`notion/canonicalId.ts`), so the two spellings of one page
 *     become the one identity they always were. Content, `tsIso` and every version survive; the count is
 *     reported as `rekeyed`.
 *  2. **Fail-closed on UNPARSEABLE bytes, skip-and-count on a bad but well-formed row.** The reader
 *     ({@link ./corpusStore}) skips both kinds with a warning — right for reading, but rewriting a source
 *     that silently drops a row turns "skipped on read" into "deleted on disk" unless the drop is counted
 *     and reported. Two rejections read very differently: a line that isn't even JSON means the FILE is
 *     suspect, so the walk still ABORTS the whole source on one of those, discarding the staged file before
 *     anything is renamed. A line that parses but fails the reader's required-field gate (an empty `tsIso`
 *     on a CODEOWNERS-derived record with no natural timestamp; an empty `text` on a genuinely empty
 *     Notion page) is one bad ROW, not a suspect file — a single such row used to refuse compaction for the
 *     entire source, so it is skipped instead and tallied in `CompactPlan.rejected`, reported by count
 *     rather than silently.
 *  3. **Crash-safe by ordering, not by locking.** The canonical file is staged as a sibling temp file,
 *     fsynced, renamed into place, and only THEN are the superseded window files unlinked. A crash at
 *     any instant leaves a SUPERSET of the records on disk (old windows, or old windows + canonical, or
 *     canonical) — never a subset — and the next run collapses it again. Ordering covers a crash, not a
 *     second WRITER: a refresh appending to a window between its read and its unlink would lose rows, so
 *     the verb compacts each source only under that source's refresh slot (`./refreshSlot.ts`).
 *  4. **A KILLED run's staged file is swept by the next one.** The `catch` that discards a staged file runs
 *     only on a thrown error; a signal ends the process with no unwinding, so the temp outlives its writer.
 *     MEASURED: two scheduled runs launched in a supervisor's foreground command were
 *     killed at its ~150 s bound, leaving `compact.jsonl.48591.<uuid>.tmp` (7.2 GB) and
 *     `compact.jsonl.17469.<uuid>.tmp` (13.2 GB) beside the canonical file, which nothing ever removed. So
 *     before staging, a run unlinks every staged write of its canonical file whose writer pid no longer
 *     runs. The PID check is what makes that safe: a pid that reads alive — a recycled one, another user's,
 *     or a writer outside the slot such as `audit hygiene --scrub` rewriting the canonical file — is left
 *     alone. The source's slot only narrows who else could be staging one. The sweep is `./compactOrphanTemps.ts`.
 *
 * **It STREAMS, and that is what makes it run at all.** It used to read each window file into one
 * `readFileSync(path, "utf8")` string and compose the canonical file as one string too. Measured
 * through the real verb, against a live multi-GiB Slack window symlinked into a throwaway home:
 * `compact --source slack` printed `Cannot create a string longer than 0x1fffffe8 characters` and left the
 * source UNFINISHED. Bronze's one lifecycle verb refused the exact shape it exists for, and two refusal
 * messages elsewhere had to stop naming it as the fix. Now every line arrives through
 * {@link readJsonlLines} and leaves through {@link writeFileAtomicStream}, so neither side ever holds a
 * whole file.
 *
 * What the walk DOES retain is one {@link recordDedupDigest} per surviving record — 32 hex characters,
 * independent of the record's size, the same trade the writer's dedup index makes and for the same reason
 * (see {@link BronzeDedupIndex}). Measured on the owner's own corpus, through the real verb:
 * a couple of dozen Slack window files holding nearly two million rows across several GB (one of them
 * multi-GiB on its own) became one canonical file, collapsing a couple of thousand cross-window duplicates in
 * about a minute at a peak RSS under a gigabyte — inside V8's DEFAULT ceiling, with no
 * `--max-old-space-size` at all. Re-measure with
 * `/usr/bin/time -l slopweaver compact --source slack --home <throwaway home of symlinks> --json`.
 *
 * Watermarks, Slack thread cursors, and the GitHub per-repo cursors all live OUTSIDE `bronze/` and are
 * never read or written here, so resume is untouched: a compacted corpus refreshes from exactly the
 * cursor it had before.
 */

import { unlinkSync } from "node:fs";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";
import { slopweaverHome } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { recordDedupDigest } from "./bronzeDedupIndex.js";
import type { OwnerProtectionResolver } from "./bronzeProtection.js";
import { type BronzeFileStat, listBronzeFiles } from "./bronzeStorage.js";
import { type CompactError, CompactErrors } from "./compact.errors.js";
import { type OrphanTempSweep, type PidAlive, pidRuns, sweepOrphanTemps } from "./compactOrphanTemps.js";
import { compactWritePreflight } from "./compactProtection.js";
import { classifyForCompaction } from "./compactVerdict.js";
import { bronzeCompactFile } from "./corpusPaths.js";
import { parseRow } from "./corpusRowCore.js";
import { readJsonlLines } from "./corpusStore.js";
import { canonicalNotionRecord } from "./notion/canonicalId.js";
import { serialiseRecord } from "./recordSerialisation.js";
import type { CorpusSource } from "./types.js";

/** A corpus measure at one point in time: how many files, records, and bytes. */
interface CompactMeasure {
  readonly files: number;
  readonly records: number;
  readonly bytes: number;
}

/** What compaction did to one source. */
export interface CompactPlan {
  readonly source: CorpusSource;
  /** The single file every surviving record was written to. */
  readonly canonicalPath: string;
  /** The files to unlink AFTER the canonical rename lands. */
  readonly supersededPaths: readonly string[];
  readonly before: CompactMeasure;
  readonly after: CompactMeasure;
  /** Cross-window duplicates collapsed — records the writer's fingerprint says are the same content. */
  readonly duplicatesCollapsed: number;
  /** Records dropped by an explicit `--older-than` horizon (always 0 without one). */
  readonly pruned: number;
  /** Well-formed-JSON rows dropped for failing the required-field gate (never a JSON parse failure). */
  readonly rejected: number;
  /** Up to {@link MAX_REJECTED_SAMPLES} `path:line: reason` strings, for the first rejections seen. */
  readonly rejectedSamples: readonly string[];
  /** Staged writes a killed predecessor left beside the canonical file, swept before this run staged its own. */
  readonly orphanTemps: OrphanTempSweep;
  /** Rows whose undashed Notion page id was re-spelled to the canonical dashed form (`notion/canonicalId.ts`). */
  readonly rekeyed: number;
}

/** What one source's streaming walk counted. Mutable — it is filled in as the walk writes. */
interface CompactTally {
  parsed: number;
  kept: number;
  duplicates: number;
  pruned: number;
  rejected: number;
  /** `path:line: reason` for the first {@link MAX_REJECTED_SAMPLES} rejected rows. */
  rejectedSamples: string[];
  rekeyed: number;
  bytes: number;
}

/**
 * How many `path:line: reason` samples a rejected-rows tally keeps. A count alone tells an operator
 * something was dropped; a handful of locations is what lets them go find and mend the actual rows — which
 * is exactly how the two records this bound was sized for were found. Uncapped would turn a source with a
 * systemic bad-field bug into an unbounded in-memory list.
 */
const MAX_REJECTED_SAMPLES = 20;

/**
 * How many characters of survivors accumulate before one `write` call. A batch bounds the syscall count
 * (one per ~4 MiB instead of one per record) while staying orders of magnitude inside any heap the walk
 * already needs for its digest set.
 */
const WRITE_BATCH_CHARS = 4 * 1024 * 1024;

/**
 * One source's streaming walk: everything carried across its files, so the batch, the digest set and the
 * abort do not restart at each one.
 */
interface CompactWalk {
  /** The dedup digests of every record kept so far — the only thing the walk retains per record. */
  readonly seen: Set<string>;
  readonly tally: CompactTally;
  readonly olderThanIso: string | undefined;
  /** The staged file's sink, from {@link writeFileAtomicStream}. */
  readonly write: (args: { text: string }) => void;
  /** Survivors serialised but not yet handed to `write`. */
  batch: string[];
  batchChars: number;
  /** Set by the first FATAL failure (unparseable JSON, unreadable/unwritable file); every later line and
   *  file is then skipped. A rejected-but-parseable row never sets this — it is tallied and the walk
   *  continues. */
  aborted: CompactError | undefined;
}

/** Hand the batched survivors to the sink and count their bytes. */
function flushBatch({ walk }: { walk: CompactWalk }): void {
  if (walk.batch.length === 0) {
    return;
  }
  const text = walk.batch.join("");
  walk.tally.bytes += Buffer.byteLength(text, "utf8");
  walk.write({ text });
  walk.batch = [];
  walk.batchChars = 0;
}

/** Judge one line and, when it survives, queue its canonical serialisation. */
function absorbLine({
  walk,
  path,
  line,
  index,
}: {
  walk: CompactWalk;
  path: string;
  line: string;
  index: number;
}): void {
  if (walk.aborted !== undefined || line.trim().length === 0) {
    return;
  }
  const parsed = parseRow({ line });
  if ("error" in parsed) {
    if (parsed.reason === "invalid-json") {
      // Bytes that aren't even JSON put the FILE in question, not just this row — the walk still aborts.
      walk.aborted = CompactErrors.corruptLine({ line: index + 1, path, reason: parsed.error });
      return;
    }
    // Well-formed JSON that fails the required-field gate is one bad row, not a suspect file: skip it,
    // count it, and keep every OTHER survivor rather than refusing the whole source over one record.
    walk.tally.rejected += 1;
    if (walk.tally.rejectedSamples.length < MAX_REJECTED_SAMPLES) {
      walk.tally.rejectedSamples.push(`${path}:${String(index + 1)}: ${parsed.error}`);
    }
    return;
  }
  walk.tally.parsed += 1;
  // Re-keyed BEFORE the digest, so a row and its twin under the other spelling of the same Notion page id
  // dedup as the one identity they are, and differing versions survive under it for `latestRecords` to rank.
  const record = canonicalNotionRecord({ record: parsed.record });
  if (record !== parsed.record) {
    walk.tally.rekeyed += 1;
  }
  const digest = recordDedupDigest({ record });
  const verdict = classifyForCompaction({
    digest,
    olderThanIso: walk.olderThanIso,
    record,
    seen: walk.seen,
  });
  if (verdict === "pruned") {
    walk.tally.pruned += 1;
    return;
  }
  if (verdict === "duplicate") {
    walk.tally.duplicates += 1;
    return;
  }
  walk.seen.add(digest);
  walk.tally.kept += 1;
  const serialised = `${serialiseRecord({ record })}\n`;
  walk.batch.push(serialised);
  walk.batchChars += serialised.length;
  if (walk.batchChars >= WRITE_BATCH_CHARS) {
    flushBatch({ walk });
  }
}

/** Stream one window file's lines into the walk, recording the first failure rather than throwing it. */
function absorbFile({ walk, path }: { walk: CompactWalk; path: string }): void {
  try {
    readJsonlLines({
      // A line callback cannot stop the read mid-chunk, so the chunk seam is what actually ends it.
      onChunk: () => walk.aborted === undefined,
      onLine: ({ line, index }) => {
        absorbLine({ index, line, path, walk });
      },
      path,
    });
  } catch (error: unknown) {
    // A file the rewriter cannot read is a file whose records it cannot carry forward, so the source
    // aborts rather than writing a canonical file that silently omits them. A failure the walk already
    // recorded (a corrupt line earlier in this file) is the one reported, so this read failure leaves it.
    if (walk.aborted !== undefined) {
      return;
    }
    walk.aborted = CompactErrors.readFailed({ message: error instanceof Error ? error.message : String(error), path });
  }
}

/**
 * Stream every window file into the canonical file, keeping only one digest per survivor.
 *
 * @param files the source's window files, in the order the reader walks them
 * @param canonicalPath the single file the survivors occupy
 * @param olderThanIso an explicit age horizon, or `undefined` for the lossless default
 * @param tally filled in as the walk runs — the before/after measure is read off it
 * @returns nothing on success, or the first failure (the staged file is discarded, the corpus untouched)
 */
function streamCanonical({
  files,
  canonicalPath,
  olderThanIso,
  tally,
}: {
  files: readonly BronzeFileStat[];
  canonicalPath: string;
  olderThanIso: string | undefined;
  tally: CompactTally;
}): Result<null, CompactError> {
  let walk: CompactWalk | undefined;
  const written = safeFs({
    execute: () => {
      writeFileAtomicStream({
        path: canonicalPath,
        produce: ({ write }) => {
          walk = { aborted: undefined, batch: [], batchChars: 0, olderThanIso, seen: new Set(), tally, write };
          for (const file of files) {
            absorbFile({ path: file.path, walk });
            if (walk.aborted !== undefined) {
              // Unwind out of the sink so the staged file is discarded rather than renamed into place. The
              // message is never read: `safeFs` catches this and the recorded `walk.aborted` is what is returned.
              throw new Error("compaction aborted");
            }
          }
          flushBatch({ walk });
        },
      });
    },
    operation: "compact.writeCanonical",
    path: canonicalPath,
  });
  const aborted = walk?.aborted;
  if (aborted !== undefined) {
    return err(aborted);
  }
  return written.isErr()
    ? err(CompactErrors.writeFailed({ message: written.error.message, path: canonicalPath }))
    : ok(null);
}

/**
 * Unlink the superseded window files, AFTER the canonical file has landed. The order is the crash-safety
 * guarantee — every intermediate state holds a superset of the records.
 *
 * @param paths the superseded files
 * @returns nothing, or the failures — no data was lost, but the planned on-disk state was not reached
 */
function removeSuperseded({ paths }: { paths: readonly string[] }): Result<null, CompactError> {
  const failedPaths: string[] = [];
  const failureMessages: string[] = [];
  for (const path of paths) {
    const removed = safeFs({
      execute: () => {
        unlinkSync(path);
      },
      operation: "compact.unlink",
      path,
    });
    if (removed.isErr()) {
      failedPaths.push(path);
      failureMessages.push(`could not remove superseded file ${path}: ${removed.error.message}`);
    }
  }
  // No data was lost — the canonical file already holds every survivor — but the planned on-disk state was
  // NOT reached, and the measure would be a lie: `after.files` would undercount, and under `--older-than`
  // the "age-pruned" records are still sitting in the file the reader recurses into. So the source FAILS
  // (non-zero exit) rather than reporting a reduction that did not happen. The next run collapses it.
  return failedPaths.length > 0
    ? err(CompactErrors.unlinkFailed({ failures: failureMessages, paths: failedPaths }))
    : ok(null);
}

/** The plan for a source with no bronze on disk at all — nothing staged, nothing touched. Pure. */
function emptyCompactPlan(fields: Pick<CompactPlan, "canonicalPath" | "orphanTemps" | "source">): CompactPlan {
  return {
    ...fields,
    after: { bytes: 0, files: 0, records: 0 },
    before: { bytes: 0, files: 0, records: 0 },
    duplicatesCollapsed: 0,
    pruned: 0,
    rejected: 0,
    rejectedSamples: [],
    rekeyed: 0,
    supersededPaths: [],
  };
}

/** Assemble the finished plan from one source's completed walk. Pure. */
function finishedCompactPlan({
  files,
  tally,
  ...fields
}: Pick<CompactPlan, "canonicalPath" | "orphanTemps" | "source" | "supersededPaths"> & {
  files: readonly BronzeFileStat[];
  tally: CompactTally;
}): CompactPlan {
  return {
    ...fields,
    after: {
      bytes: tally.kept === 0 ? 0 : tally.bytes,
      files: tally.kept === 0 ? 0 : 1,
      records: tally.kept,
    },
    before: {
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      files: files.length,
      records: tally.parsed,
    },
    duplicatesCollapsed: tally.duplicates,
    pruned: tally.pruned,
    rejected: tally.rejected,
    rejectedSamples: tally.rejectedSamples,
    rekeyed: tally.rekeyed,
  };
}

/**
 * Compact ONE source end to end: list its bronze files, judge every one it will replace as a write
 * (`./compactProtection.ts`), stream them into the canonical file, unlink what the canonical file superseded.
 * It never touches a watermark, thread cursor, or repo cursor.
 *
 * @param source the corpus source to compact
 * @param olderThanIso an explicit age horizon (omit for the lossless default)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param isAlive whether a staged file's writer pid still runs (defaults to the process table) — the
 *   sweep of dead writers' staged files never touches one it reads alive
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns what it did, or an error — the source is then UNFINISHED, never partially lost: it either
 *   rewrote nothing (read/parse/write failure discards the staged file) or left a superset on disk (a
 *   post-canonical unlink failure)
 */
export function compactSource({
  source,
  olderThanIso,
  home = slopweaverHome(),
  isAlive = pidRuns,
  protection,
}: {
  source: CorpusSource;
  olderThanIso?: string;
  home?: string;
  isAlive?: PidAlive;
  protection?: OwnerProtectionResolver | undefined;
}): Result<CompactPlan, CompactError> {
  const listed = listBronzeFiles({ home, protection, source });
  if (listed.isErr()) {
    return err(CompactErrors.listRefused({ message: listed.error.message }));
  }
  const files = listed.value;
  const canonicalPath = bronzeCompactFile({ home, source });
  const judge = compactWritePreflight({ canonicalPath, files, home, protection, source });
  if (judge.isErr()) {
    return err(judge.error);
  }
  const orphanTemps = sweepOrphanTemps({ canonicalPath, isAlive, judge: judge.value });
  if (files.length === 0) {
    // A never-ingested source: staging a canonical file here would CREATE the source's bronze directory
    // just to delete an empty file out of it, which is how a source nothing ever wrote acquires a corpus.
    return ok(emptyCompactPlan({ canonicalPath, orphanTemps, source }));
  }
  const tally: CompactTally = {
    bytes: 0,
    duplicates: 0,
    kept: 0,
    parsed: 0,
    pruned: 0,
    rejected: 0,
    rejectedSamples: [],
    rekeyed: 0,
  };
  const streamed = streamCanonical({ canonicalPath, files, olderThanIso, tally });
  if (streamed.isErr()) {
    return err(streamed.error);
  }
  // When nothing survives, the canonical file itself is superseded — leaving an empty `.jsonl` behind is a
  // file `resolveCorpusDir` still counts as "a corpus exists".
  const others = files.map((file) => file.path).filter((path) => path !== canonicalPath);
  const supersededPaths = tally.kept === 0 ? [...others, canonicalPath] : others;
  const removed = removeSuperseded({ paths: supersededPaths });
  if (removed.isErr()) {
    return err(removed.error);
  }
  return ok(finishedCompactPlan({ canonicalPath, files, orphanTemps, source, supersededPaths, tally }));
}
