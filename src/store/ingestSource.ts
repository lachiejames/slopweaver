/**
 * The whole of ONE source into the store — every bronze file it has, in the order bronze must be read.
 *
 * ## Why this is a composition rather than a loader
 *
 * {@link ./ingestJsonl.ingestJsonl} already reads one file whole, in `--limit`-sized slices, resuming by byte
 * offset. What it could not do was find the files: `store ingest` took exactly one `--file`, and a source
 * has a canonical `compact.jsonl` plus every window file written since the last compaction. So the missing
 * piece is enumeration and ORDER, and both already exist — {@link ../corpus/bronzeStorage.listBronzeFiles}
 * lists a source's files recursively, in the order {@link ../corpus/corpusPaths.sortBronzeEntries} defines, and
 * `./protectedBronze.ts` lists them the same way through the owner's protect list. Nothing here walks a
 * directory or invents an ordering rule.
 *
 * ## The order is the correctness, and it is not ours to choose
 *
 * `content` upserts on `(source, source_id)` and a later capture supersedes COMPLETELY, so whichever file
 * is written LAST decides what the row holds. There is no capture timestamp on a `CorpusRecord` to sort by
 * — `tsIso` is when the event happened, not when it was fetched — so the winner is decided by position,
 * exactly as it is for every other bronze reader. `sortBronzeEntries` is that position: the compacted file
 * first, then window files by name, because compaction folds the OLD files into the canonical one and every
 * window written afterwards is NEWER.
 *
 * That rule was learned expensively rather than reasoned out, and the measurement is in
 * `corpusPaths.sortBronzeEntries`: a plain sort put `compact.jsonl` last, and 60 of 60 re-projected meeting
 * transcripts resolved to their superseded versions with nothing reporting it. Reading this file's order
 * from anywhere else — an mtime sort, a window-name-only sort — would reintroduce that class in the store
 * while bronze's own readers stayed right, and the two would then disagree about what the corpus says.
 *
 * ## What it deliberately does NOT do
 *
 * No cursor is persisted between invocations. `compact` stages a new canonical file and renames it into
 * place, which invalidates every byte offset into that source at once, so a stored cursor would be a number
 * that is silently wrong after an ordinary maintenance run ({@link ./ingestJsonl} carries the same reasoning for
 * the single-file case). What makes a re-run cheap instead is that every write upserts, so repeating a
 * source is idempotent — and `--from-file` starts at a named file for the case where a long run died and
 * the operator knows which files already landed.
 */
import type { BronzeFileStat } from "../corpus/bronzeStorage.js";
import type { CorpusSource } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors, type StoreRowRefusedError } from "./errors.js";
import type { IngestReport } from "./ingest.js";
import { ingestJsonl } from "./ingestJsonl.js";
import { MAX_RETAINED_REFUSALS } from "./ingestRead.js";

/**
 * What one file of a source's bronze contributed, kept per file so a multi-gigabyte run reports progress.
 *
 * @internal
 */
export interface SourceFileReport {
  readonly path: string;
  readonly bytes: number;
  readonly report: IngestReport;
}

/** What a whole-source pass did, per file and in total. */
export interface SourceIngestReport {
  readonly source: CorpusSource;
  /** Every file the pass read, in the order it read them. */
  readonly files: readonly SourceFileReport[];
  /** Files listed but skipped because `--from-file` named a later one. */
  readonly skipped: readonly string[];
  readonly recordsStored: number;
  readonly linesRead: number;
  readonly bytesRead: number;
  readonly slices: number;
  readonly duplicatesCollapsed: number;
  /** Exact across every file, however few examples were kept. */
  readonly refusalsCounted: number;
  /** Retained EXAMPLES across the whole pass, capped the same way one file's are. */
  readonly refusals: readonly StoreRowRefusedError[];
  /** Whether every file read reached its own end, as opposed to stopping on a ceiling. */
  readonly reachedEnd: boolean;
  readonly elapsedMs: number;
}

/**
 * Read a source's bronze into the store, file by file, in the order it was handed them.
 *
 * The file LIST is the caller's, because choosing it is a refusable decision — a mistyped `--from-file`
 * has to be refused at the usage edge with the real basenames beside it, not turned into a database error
 * by the loader. {@link planSourceFiles} is that decision, pure and checkable; this is the effect.
 *
 * @param client the open store
 * @param source which source these files belong to, carried through to the report
 * @param files the source's files to read, already in bronze read order
 * @param limit the per-SLICE record ceiling, which is the heap bound — never a ceiling on the pass
 * @param wholeFile whether each file is read to its end (a whole-source load) or one slice deep (a cheap
 *   pass over every file, for finding out what a source's bronze will refuse before spending hours on it)
 * @param skipped the files `--from-file` dropped, reported so a resumed run says what it did not read
 * @param protection the owner's protect-list entries, forwarded so every file is judged again however the
 *   caller built its list
 * @returns what the pass did, or the first protect-list refusal or database failure — fatal in a way a
 *   per-row refusal is not
 */
export async function ingestSource({
  client,
  source,
  files: planned,
  limit,
  protection,
  wholeFile = false,
  skipped = [],
  home,
}: {
  client: StoreClient;
  source: CorpusSource;
  files: readonly BronzeFileStat[];
  limit: number;
  protection: readonly ProtectedPath[];
  wholeFile?: boolean;
  skipped?: readonly string[];
  home?: string;
}): Promise<Result<SourceIngestReport, StoreError>> {
  const started = Date.now();
  const files: SourceFileReport[] = [];
  const refusals: StoreRowRefusedError[] = [];
  for (const file of planned) {
    const report = await ingestJsonl({
      client,
      limit,
      path: file.path,
      protection,
      wholeFile,
      ...(home === undefined ? {} : { home }),
    });
    if (report.isErr()) {
      return err(report.error);
    }
    for (const refusal of report.value.refusals) {
      if (refusals.length < MAX_RETAINED_REFUSALS) {
        refusals.push(refusal);
      }
    }
    files.push({ bytes: file.bytes, path: file.path, report: report.value });
  }

  return ok({
    bytesRead: total({ files, of: (report) => report.bytesRead }),
    duplicatesCollapsed: total({ files, of: (report) => report.duplicatesCollapsed }),
    elapsedMs: Date.now() - started,
    files,
    linesRead: total({ files, of: (report) => report.linesRead }),
    reachedEnd: files.every((file) => file.report.reachedEnd),
    recordsStored: total({ files, of: (report) => report.recordsStored }),
    refusals,
    refusalsCounted: total({ files, of: (report) => report.refusalsCounted }),
    skipped,
    slices: total({ files, of: (report) => report.slices }),
    source,
  });
}

/**
 * Sum one counter across every file a pass read.
 *
 * @param files the per-file reports
 * @param of which counter to take from each
 * @returns the total
 */
function total({ files, of }: { files: readonly SourceFileReport[]; of: (report: IngestReport) => number }): number {
  return files.reduce((sum, file) => sum + of(file.report), 0);
}

/** Which of a source's files a pass will read, and which `--from-file` skipped. */
export interface SourceFilePlan {
  readonly read: readonly BronzeFileStat[];
  readonly skipped: readonly string[];
}

/**
 * Split a source's files at `--from-file`, preserving the read order exactly.
 *
 * Pure, and separate from the pass so the one property that decides correctness — that resuming never
 * reorders the files, only drops a prefix of them — is checkable with no database and no corpus.
 *
 * A `fromFile` that matches nothing is REFUSED rather than read as "start at the beginning": an operator
 * resuming an 8 GB load from a mistyped basename would otherwise silently re-read every file before it,
 * and the only symptom would be the run taking hours longer than they expected.
 *
 * @param files the source's files, already in bronze read order
 * @param fromFile a path or basename to start at; matched as a suffix so either spelling works
 * @returns the files to read and the ones skipped, or the refusal naming what was available
 */
export function planSourceFiles({
  files,
  fromFile,
}: {
  files: readonly BronzeFileStat[];
  fromFile?: string;
}): Result<SourceFilePlan, StoreError> {
  if (fromFile === undefined) {
    return ok({ read: files, skipped: [] });
  }
  const at = files.findIndex((file) => file.path === fromFile || file.path.endsWith(`/${fromFile}`));
  if (at < 0) {
    const available = files.map((file) => file.path.slice(file.path.lastIndexOf("/") + 1));
    return err(StoreErrors.fromFileUnknown({ available, fromFile }));
  }
  return ok({ read: files.slice(at), skipped: files.slice(0, at).map((file) => file.path) });
}
