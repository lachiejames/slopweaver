/**
 * The `self` source's ingest job — scan → date → project, wrapped in the ONE per-source seam
 * ({@link ../ingestJob.SourceIngestJob}) so it flows through the same write path, dedup and summary as every
 * other source. Deliberately not a second door into bronze: `refresh` stays the only writer.
 *
 * The job is `cursorless`. There is no network, no pagination and no rate limit, so a full re-scan is free and
 * idempotent, and there is nothing a cursor could resume from — see {@link ../ingestJob.SourceIngestJob}.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type ProfileReadError, readProfile } from "../../profileStore.js";
import type { SourceIngestJob } from "../ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { countTimeSources, gitFirstAddedDates, resolveEventTime, type SelfTimeSource } from "./eventTime.js";
import { type DatedSelfFile, projectSelfRecords } from "./project.js";
import { SELF_FILE_MAX_BYTES, type SelfFile, scanSelfCorpus } from "./scan.js";
import { ALLOW_LARGE_FILES, type SelfSkip, selfSkipIsFault, summariseSelfSkips } from "./skips.js";

/** The default persona a record is attributed to when no profile is there to name one. */
const DEFAULT_SELF_AUTHOR = "me";

/**
 * The persona every `self` record is attributed to: the profile's id, or `me` on an install with no profile.
 *
 * A profile that is there but corrupt is the read's own error, never `me`. Attributing a whole corpus to the
 * default because one file failed to parse would write every record under the wrong author, and a slice would
 * pin that wrong author as the truth. Shared by the ingest job and `slice capture`/`verify`, so the three
 * cannot disagree about who wrote a note.
 *
 * @param home the Slopweaver home holding `profile.json`
 * @returns the author id, or why the profile that is there cannot be trusted
 */
export function readSelfAuthor({ home }: { home: string }): Result<string, ProfileReadError> {
  return readProfile({ home }).map((profile) => {
    if (profile === null) {
      return DEFAULT_SELF_AUTHOR;
    }
    return profile.id;
  });
}

/**
 * Pair every scanned file with an event time, using one whole-history git query PER ROOT rather than one per
 * file. The git maps are injected so the pure resolution can be tested without a repository.
 *
 * @param files the scanned files
 * @param gitDatesByRoot per-root path → first-add ISO maps (an empty map for a root with no history)
 * @returns each file with its resolved instant and the evidence rung it came from
 */
export function dateSelfFiles({
  files,
  gitDatesByRoot,
}: {
  files: readonly SelfFile[];
  gitDatesByRoot: ReadonlyMap<string, ReadonlyMap<string, string>>;
}): readonly DatedSelfFile[] {
  return files.map((file) => {
    const resolved = resolveEventTime({
      gitIso: gitDatesByRoot.get(file.root)?.get(file.relPath),
      mtimeIso: file.mtimeIso,
      relPath: file.relPath,
      text: file.text,
    });
    return { file, timeSource: resolved.timeSource, tsIso: resolved.tsIso };
  });
}

/**
 * The lines `refresh` prints about this lane: how many files were read, and — the part that matters — how each
 * record's date was established.
 *
 * A run that dated most of its corpus from mtime has NOT dated it, and this is where that gets said out loud
 * instead of being inferable only by reading records back. A guessed date reading as measured is the defect
 * class this repo keeps finding. Pure.
 *
 * @param recordCount how many section records were projected
 * @param timeSources one entry per FILE read (a file has one event time; its sections inherit it)
 * @param skips every entry the walk saw and declined, each with its typed reason
 * @param controlBytesStripped how many control bytes were removed across the files that WERE read
 * @returns the note lines, in print order
 */
export function selfIngestNotes({
  recordCount,
  timeSources,
  skips,
  controlBytesStripped,
}: {
  recordCount: number;
  timeSources: readonly SelfTimeSource[];
  skips: readonly SelfSkip[];
  controlBytesStripped: number;
}): readonly string[] {
  const counts = countTimeSources({ timeSources });
  const breakdown = counts.map((entry) => `${entry.source} ${String(entry.count)}`).join(", ");
  const seen = timeSources.length + skips.length;
  return [
    // `seen` first, because it is the number the old output could not produce: a run that read 2 of 5 files
    // used to print only the 2, so the other 3 were invisible rather than merely uninteresting.
    `saw ${String(seen)} entr(ies): read ${String(timeSources.length)} file(s) into ${String(recordCount)} section record(s)`,
    ...summariseSelfSkips({ skips }),
    ...(controlBytesStripped > 0
      ? [`sanitised: ${String(controlBytesStripped)} control byte(s) stripped across the files read`]
      : []),
    `event time by file: ${breakdown.length > 0 ? breakdown : "nothing (no files read)"}`,
  ];
}

/**
 * The per-file size ceiling for this run: lifted to no ceiling at all when the break-glass is set.
 *
 * The environment read is done HERE rather than inside the scan so the walk stays a pure-ish function of its
 * arguments and a test can exercise both sides of the guardrail without touching `process.env`.
 *
 * @param env the environment to read {@link ALLOW_LARGE_FILES} from
 * @returns the ceiling in bytes, or `Number.POSITIVE_INFINITY` when the break-glass is set
 */
export function selfMaxBytes({ env }: { env: Readonly<Record<string, string | undefined>> }): number {
  return env[ALLOW_LARGE_FILES] === "1" ? Number.POSITIVE_INFINITY : SELF_FILE_MAX_BYTES;
}

/**
 * The skips that deserve to be WARNINGS rather than a line in the declined breakdown.
 *
 * A policy skip is the walk working correctly and there are thousands of them, so promoting those would bury
 * the run in noise. A FAULT — an unreadable directory, a file that turned out to be a blob — means the walk
 * did not cover something it was meant to, and that belongs where an operator already looks. The two are
 * separated by {@link ./skips.selfSkipIsFault} rather than by a list kept in this module, so a reason added
 * later cannot silently land on the wrong side. Pure.
 *
 * @param skips every entry the walk declined
 * @returns one warning line per fault, in walk order (empty when nothing went wrong)
 */
function selfFaultWarnings({ skips }: { skips: readonly SelfSkip[] }): readonly string[] {
  return skips
    .filter((skip) => selfSkipIsFault({ reason: skip.reason }))
    .map((skip) => `${skip.relPath}: not read (${skip.reason})${skip.detail.length > 0 ? ` — ${skip.detail}` : ""}`);
}

/**
 * Build the `self` ingest job over the given roots.
 *
 * @param roots the absolute directories to scan
 * @param exclude relative-path prefixes to decline, each reported as a named skip
 * @param home the Slopweaver home — never scanned, and the source of the persona id
 * @param window the export window, which names the bronze file and nothing else: a full re-scan has no window
 *   to respect, and every record's `tsIso` is its own resolved event time rather than anything derived here
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function selfIngestJob({
  roots,
  home,
  window,
  exclude = [],
}: {
  roots: readonly string[];
  home: string;
  window: ExportWindow;
  exclude?: readonly string[];
}): SourceIngestJob {
  return {
    cursorless: true,
    label: `self (${String(roots.length)} root(s))`,
    run: async (): Promise<
      Result<{ records: readonly CorpusRecord[]; warnings: readonly string[]; notes: readonly string[] }>
    > => {
      const author = readSelfAuthor({ home });
      if (author.isErr()) {
        return err([`${author.error.message}. No self record was ingested.`]);
      }
      const scanned = scanSelfCorpus({ exclude, home, maxBytes: selfMaxBytes({ env: process.env }), roots });
      const gitDatesByRoot = new Map(roots.map((root) => [root, gitFirstAddedDates({ root })]));
      const dated = dateSelfFiles({ files: scanned.files, gitDatesByRoot });
      const records = projectSelfRecords({ author: author.value, files: dated });
      return ok({
        notes: selfIngestNotes({
          controlBytesStripped: scanned.files.reduce((total, file) => total + file.controlBytesStripped, 0),
          recordCount: records.length,
          skips: scanned.skips,
          timeSources: dated.map((entry) => entry.timeSource),
        }),
        records,
        warnings: [...scanned.warnings, ...selfFaultWarnings({ skips: scanned.skips })],
      });
    },
    source: "self",
    window,
  };
}
