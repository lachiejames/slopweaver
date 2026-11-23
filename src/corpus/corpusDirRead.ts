/*
 * How a DIRECTORY reads: every `.jsonl` under a corpus root, into records grouped by source, with the heap
 * guard running between chunks rather than once over the whole file.
 *
 * The top of the corpus reader, and the only module here that composes the other three. It streams through
 * `corpusStore.ts`, decodes through `corpusRowCore.ts` and counts through `corpusTallyCore.ts`, so the
 * order in which those three run is an import graph rather than a convention.
 *
 * A missing directory reads as `ok([])` WITH a warning. An unreadable one is recorded by path rather than
 * collapsed into the empty case, because a caller that must tell an absence from a failure needs both. A root the
 * owner's protect list refuses, or a protect list that cannot be read, is `CORPUS_PROTECTED` before anything is read.
 */

import { slopweaverHome } from "../config.js";
import { appendAll } from "../lib/arrays.js";
import { guardHeap, type HeapGuard, type HeapShortfall } from "../lib/heapBudget.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import type { OwnerProtectionResolver } from "./bronzeProtection.js";
import { type CorpusProjection, HEAP_BYTES_PER_DISK_BYTE } from "./corpusRowCore.js";
import { type CorpusStoreError, CorpusStoreErrors } from "./corpusStore.errors.js";
import {
  type JsonlFile,
  type JsonlScan,
  protectedSkipWarnings,
  READ_CHUNK_BYTES,
  readJsonlLines,
  scanCorpusRoot,
} from "./corpusStore.js";
import {
  accumulatorFor,
  type CorpusGroupTally,
  countRows,
  type GroupAccumulator,
  groupOfFile,
  tallyLine,
  tallySkips,
} from "./corpusTallyCore.js";
import { collapseRowWarnings, type RowWarning } from "./rowWarnings.js";
import { type CorpusRecord } from "./types.js";

/**
 * Parse JSONL content into records. Corrupt lines are skipped and surfaced as warnings, never fatal.
 *
 * @param content the raw JSONL text
 * @returns the parsed records (always `ok`; rejected lines become warnings)
 */
export function parseCorpusRecords({
  content,
}: {
  content: string;
}): Result<{ records: readonly CorpusRecord[]; warnings: readonly string[] }> {
  const counted = countRows({ content });
  return ok({ records: counted.records, warnings: counted.warnings });
}

/**
 * Read one file into its group's accumulator, recording an unreadable file rather than throwing.
 *
 * The heap guard runs BETWEEN CHUNKS, against the real isolate, projecting only the chunk about to be
 * consumed. It used to run once before the read, projecting the WHOLE file at the band's ceiling — and that
 * is the shape that refused a real corpus: the ceiling coefficient is `self`'s (its
 * text is two-byte in V8 and it carries no `raw`), so a Slack window of about 2 GiB projected nearly twice
 * its size in retained heap where it actually retains about half its size. A 3.5× over-projection is not a slightly early
 * refusal, it is a corpus read refusing a corpus that fits.
 *
 * A per-chunk projection needs no coefficient accuracy at all, because the quantity it projects is bounded
 * by {@link READ_CHUNK_BYTES} however big the file is. The overshoot between two checks can never exceed one
 * chunk's worth of retained records, which is orders of magnitude inside the collector reserve the guard
 * already keeps free. What the whole-file projection was for — refusing a hopeless load in milliseconds
 * rather than after reading gigabytes — is {@link readScannedFiles}'s preflight, and that still runs.
 */
function readFileInto({
  file,
  into,
  warnings,
  projection,
  heapGuard,
}: {
  file: JsonlFile;
  into: GroupAccumulator;
  warnings: string[];
  projection: CorpusProjection;
  heapGuard: HeapGuard;
}): { readonly shortfall: HeapShortfall; readonly bytesConsumed: number } | undefined {
  const chunkProjection = READ_CHUNK_BYTES * HEAP_BYTES_PER_DISK_BYTE[projection].ceiling;
  let shortfall: HeapShortfall | undefined;
  // How far into THIS file the read got. The whole-corpus extrapolation a refusal reports is only as good
  // as the disk figure it divides by, and on the real corpus one file is most of a source: counting only
  // whole files would have thrown away everything read since the last boundary.
  let bytesConsumed = 0;
  const fileWarnings: RowWarning[] = [];
  const read = safeFs({
    execute: () => {
      readJsonlLines({
        onChunk: ({ bytesConsumed: consumed }) => {
          bytesConsumed = consumed;
          const verdict = heapGuard({ projectedBytes: chunkProjection });
          if (verdict.fits) {
            return true;
          }
          shortfall = verdict;
          return false;
        },
        onLine: ({ index, line }) => {
          tallyLine({
            index,
            into,
            line,
            projection,
            warnings: fileWarnings,
          });
        },
        path: file.path,
      });
    },
    operation: "readCorpusDir.read",
    path: file.path,
  });
  if (read.isErr()) {
    into.unreadable.push(file.path);
    warnings.push(`${file.path}: unreadable (${read.error.message})`);
    return undefined;
  }
  appendAll({
    from: collapseRowWarnings({ warnings: fileWarnings }).map((w) => `${file.path}: ${w}`),
    into: warnings,
  });
  return shortfall === undefined ? undefined : { bytesConsumed, shortfall };
}

/**
 * Read every scanned file into its group, under the heap guard: a whole-corpus preflight at the band's FLOOR
 * (so a hopeless load refuses in milliseconds, and one that might fit is never refused here), then a live
 * per-chunk check inside each file's read (see {@link readFileInto}). Returns the typed refusal, or
 * `undefined` when everything read.
 */
function readScannedFiles({
  dir,
  scan,
  groups,
  warnings,
  projection,
  heapGuard,
}: {
  dir: string;
  scan: JsonlScan;
  groups: Map<string, GroupAccumulator>;
  warnings: string[];
  projection: CorpusProjection;
  heapGuard: HeapGuard;
}): CorpusStoreError | undefined {
  const diskBytes = scan.files.reduce((sum, file) => sum + file.bytes, 0);
  const fileCount = scan.files.length;
  const band = HEAP_BYTES_PER_DISK_BYTE[projection];
  const preflight = heapGuard({ projectedBytes: diskBytes * band.floor });
  if (!preflight.fits) {
    return CorpusStoreErrors.heapCeiling({ band, dir, diskBytes, fileCount, readBytes: 0, shortfall: preflight });
  }
  let readBytes = 0;
  for (const file of scan.files) {
    const into = accumulatorFor({ group: groupOfFile({ file: file.path, root: dir }), groups });
    const refused = readFileInto({ file, heapGuard, into, projection, warnings });
    if (refused !== undefined) {
      return CorpusStoreErrors.heapCeiling({
        band,
        dir,
        diskBytes,
        fileCount,
        readBytes: readBytes + refused.bytesConsumed,
        shortfall: refused.shortfall,
      });
    }
    readBytes += file.bytes;
  }
  return undefined;
}

/**
 * Read a corpus dir into per-group tallies — the honest reader. Every row is accounted for: it either
 * becomes a record or lands in a counted skip class, and a file that could not be read is named rather than
 * silently contributing nothing.
 *
 * @param dir the corpus root to read
 * @param projection which fields each record retains — `bronze` (everything) unless the caller is the
 *   retrieval path, which never reads `raw` and must not pay to hold it
 * @param heapGuard the guard consulted before any file is read — the real isolate in production, a plain
 *   fake in tests; a load that would cross the ceiling is a typed `CORPUS_HEAP_CEILING` error, never a fatal
 * @param home the Slopweaver home whose protect list applies, beside the account's own; `dir` may sit outside it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns one tally per group, or an error when the root itself is not a readable directory, the owner's protect
 *   list refuses part of it (`CORPUS_PROTECTED`), or the corpus would not fit under this process's heap ceiling
 */
export function readCorpusTally({
  dir,
  projection = "bronze",
  heapGuard = guardHeap,
  home = slopweaverHome(),
  protection,
}: {
  dir: string;
  projection?: CorpusProjection;
  heapGuard?: HeapGuard;
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<{ tallies: readonly CorpusGroupTally[]; warnings: readonly string[] }, CorpusStoreError> {
  // Judged before the root is even statted, so a protected root, or an unreadable protect list, reads nothing.
  const scanned = scanCorpusRoot({ dir, home, protection, statOperation: "readCorpusDir.stat" });
  if (scanned.isErr()) {
    return err(scanned.error);
  }
  if ("empty" in scanned.value) {
    return ok({ tallies: [], warnings: [scanned.value.empty] });
  }
  const { scan } = scanned.value;
  const groups = new Map<string, GroupAccumulator>();
  const warnings: string[] = [...protectedSkipWarnings({ scan })];
  const refused = readScannedFiles({ dir, groups, heapGuard, projection, scan, warnings });
  if (refused !== undefined) {
    return err(refused);
  }
  for (const unreadableDir of scan.unreadableDirs) {
    accumulatorFor({ group: groupOfFile({ file: unreadableDir, root: dir }), groups }).unreadable.push(unreadableDir);
    warnings.push(`${unreadableDir}: directory could not be listed`);
  }
  const tallies = [...groups].map(([group, acc]) => ({
    group,
    records: acc.records,
    rows: acc.rows,
    skipped: tallySkips({ reasons: acc.reasons }),
    unreadable: acc.unreadable,
  }));
  return ok({ tallies, warnings });
}

/**
 * Read every record under a corpus dir (recursing source subdirs). Missing dir ⇒ `ok([])` + warning. A thin
 * flattening of {@link readCorpusTally} for the readers that only want the records.
 *
 * ## `unreadable` is returned, not merely warned about
 *
 * A file that could not be read AT ALL — a permission bit, an `EIO`, a file removed mid-read — contributes
 * an unknown number of records, and this reader keeps going rather than aborting. That is right for a
 * reader and dangerous for a caller, because the difference between "this source holds nothing" and "this
 * source could not be read" is invisible in `records` alone. It used to be visible only as a string among
 * the `warnings`, which every caller in the repo dropped: the writer's dedup index came back EMPTY on a
 * read failure and would have re-appended a whole source it already held, and `derive` and `identity` would
 * have built durable artefacts from a partial corpus without saying so.
 *
 * So the paths are in the RETURN TYPE. A caller that builds durable state from this read has to look at
 * them to compile, and the ones that do now refuse. `readCorpusTally` already carried the same fact per
 * group; this is the flattened reader catching up with it.
 *
 * A corrupt LINE is deliberately not this: it is skipped, warned about, and the file still counts as read,
 * because the loss there is bounded and named. Only a whole file nobody could open lands here.
 *
 * @param dir the directory to read
 * @param home the Slopweaver home whose protect list applies, beside the account's own; `dir` may sit outside it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the records, the paths that could not be read at all, and a warning per corrupt line, unreadable
 *   file, or treated-as-empty missing dir
 */
export function readCorpusDir({
  dir,
  projection,
  home = slopweaverHome(),
  protection,
}: {
  dir: string;
  /** Which fields to retain — `bronze` (everything) unless a reader can prove it needs less. */
  projection?: CorpusProjection;
  home?: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<
  { records: readonly CorpusRecord[]; unreadable: readonly string[]; warnings: readonly string[] },
  CorpusStoreError
> {
  const tally = readCorpusTally({ dir, home, protection, ...(projection !== undefined ? { projection } : {}) });
  if (tally.isErr()) {
    return err(tally.error);
  }
  const records: CorpusRecord[] = [];
  const unreadable: string[] = [];
  for (const group of tally.value.tallies) {
    appendAll({ from: group.records, into: records });
    appendAll({ from: group.unreadable, into: unreadable });
  }
  return ok({ records, unreadable, warnings: tally.value.warnings });
}
