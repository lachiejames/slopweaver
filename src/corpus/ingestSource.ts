/**
 * Multi-source ingest orchestration: run each source's fetch+project job, then push its records through
 * the ONE bronze write path (redact → fingerprint-dedup → JSONL) and advance ONLY that source's
 * watermark — after its write succeeds. Sources are independent: one source failing never rolls back or
 * skips another's committed progress. Generic over `CorpusRecord`; no raw SDK shape leaks through here.
 *
 * A job may ALSO commit PER-CONTAINER as it crawls, reporting how much it wrote through
 * {@link SourceIngestJob.run}'s `committedPerContainer` — see that field for why a single write at the end
 * is not durable enough for a multi-hour crawl, and why the bulk write below still runs anyway.
 */
import { ok, type Result } from "../lib/result.js";
import { writeCorpusRecords } from "./corpusWriter.js";
import type { CoverageGap, SourceIngestJob, SourceIngestResult } from "./ingestJob.js";
import {
  type AdvanceOutcome,
  emptyFetchResult,
  fetchFailureResult,
  successfulIngestResult,
  writeFailureResult,
} from "./ingestResult.js";
import type { CorpusRecord, CorpusSource } from "./types.js";
import { advanceWatermark, computeSourceWatermarks, isCursorlessSource } from "./watermark.js";

/**
 * The timestamps the pooled cursor may advance to: the bulk write's records, plus the newest one a job
 * already banked per-container. Pure.
 *
 * A job that commits container by container hands the bulk write only what no container covered, so its own
 * newest timestamp reaches this calculation no other way. Appending it as one more observation keeps the
 * MAX-merge in `computeSourceWatermarks` the single place that decides.
 *
 * @param records the records the bulk write was handed
 * @param committedCursor the newest `tsIso` the job banked per-container, if any
 * @param source the source those per-container commits belong to
 * @returns the records, plus one synthetic observation when there is a committed cursor to carry
 */
function withCommittedCursor({
  records,
  committedCursor,
  source,
}: {
  records: readonly CorpusRecord[];
  committedCursor: string | undefined;
  source: CorpusSource;
}): readonly { source: CorpusSource; tsIso: string }[] {
  return committedCursor === undefined ? records : [...records, { source, tsIso: committedCursor }];
}

/**
 * Advance the source's pooled cursor for a completed write, or hold it.
 *
 * @param deps the injected write/advance seams
 * @param holdCursor whether this run may not move the cursor at all (a gap, a sample, a cursorless source)
 * @param home the Slopweaver home
 * @param job the ingest job, for its source and window end
 * @param records the records the bulk write was handed
 * @param committedCursor the newest `tsIso` the job banked per-container, if any
 * @returns the advance outcome — a no-op success when the cursor is held
 */
function advanceForRun({
  deps,
  holdCursor,
  home,
  job,
  records,
  committedCursor,
}: {
  deps: IngestDeps;
  holdCursor: boolean;
  home: string;
  job: SourceIngestJob;
  records: readonly CorpusRecord[];
  committedCursor: string | undefined;
}): AdvanceOutcome {
  return holdCursor
    ? NOOP_ADVANCE
    : deps.advance({
        home,
        watermarks: computeSourceWatermarks({
          fallbackUntil: job.window.until,
          nowIso: deps.nowIso(),
          records: withCommittedCursor({ committedCursor, records, source: job.source }),
        }),
      });
}

/**
 * What a completed run reports, across BOTH of its writes. Pure.
 *
 * A run has two write paths — whatever a job committed per-container as it crawled, and the end-of-run bulk
 * write — and the honest totals are their sums. Summing the two `deduped` counts instead would double-count
 * every record a per-container commit landed and the bulk write was then offered again; reporting the bulk
 * write's numbers alone would say a run that committed 459,384 rows found nothing.
 *
 * @param bulkProjected how many records the bulk write was handed
 * @param bulkWritten how many of those became new lines
 * @param committedProjected how many records the job's own per-container commits were offered
 * @param committedWritten how many of those became new lines
 * @returns the run's projected/written/deduped totals
 */
function runCounts({
  bulkProjected,
  bulkWritten,
  bulkExcluded,
  committedProjected,
  committedWritten,
}: {
  bulkProjected: number;
  bulkWritten: number;
  bulkExcluded: number;
  committedProjected: number;
  committedWritten: number;
}): { projected: number; written: number; deduped: number; excluded: number } {
  const projected = bulkProjected + committedProjected;
  const written = bulkWritten + committedWritten;
  // `deduped` is what the residue MEANS, so an excluded record must come out of it rather than swell it.
  // Without this subtraction a denylisted author reads as a record bronze already had, which is the exact
  // confusion the separate count exists to prevent.
  return { deduped: projected - written - bulkExcluded, excluded: bulkExcluded, projected, written };
}

/**
 * Cap a source's records to at most `sample` per container (repo/channel/page), preserving first-seen
 * order within each container. The fast-feedback sampler: bounds what is WRITTEN + later DISTILLED per
 * container (far fewer distil batches), so `refresh → derive → distil → ask` runs in seconds against real
 * APIs. Pure.
 *
 * @param records the fetched+projected records for one source
 * @param sample max records to keep per container (a positive integer)
 * @returns the capped records, first-seen order preserved
 */
export function capPerContainer({
  records,
  sample,
}: {
  records: readonly CorpusRecord[];
  sample: number;
}): readonly CorpusRecord[] {
  const kept: CorpusRecord[] = [];
  const perContainer = new Map<string, number>();
  for (const record of records) {
    const seen = perContainer.get(record.container) ?? 0;
    if (seen < sample) {
      kept.push(record);
      perContainer.set(record.container, seen + 1);
    }
  }
  return kept;
}

/** The injected effectful seams (production: the real bronze writer + watermark store + the real clock). */
export interface IngestDeps {
  readonly write: typeof writeCorpusRecords;
  readonly advance: typeof advanceWatermark;
  /**
   * The instant this run is happening at, read once per advance. A SEAM rather than a `new Date()` inside,
   * because it is what caps every banked cursor (`./watermark.ts#computeSourceWatermarks`) and a cap no test
   * can pin is a cap no test can prove.
   */
  readonly nowIso: () => string;
}

/** A no-op watermark advance (a sampled run must never move a cursor — see {@link ingestSources}). */
const NOOP_ADVANCE: AdvanceOutcome = ok(undefined);

const productionIngestDeps: IngestDeps = {
  advance: advanceWatermark,
  nowIso: () => new Date().toISOString(),
  write: writeCorpusRecords,
};

/**
 * Run one job over injected seams: fetch/project → write that source's records → advance its watermark.
 * A thin shell composing the pure result builders; the write + watermark IO is injected for testing.
 */
async function ingestOneWithDeps({
  job,
  home,
  deps,
  sample,
  boundedFetch = false,
}: {
  job: SourceIngestJob;
  home: string;
  deps: IngestDeps;
  sample?: number;
  boundedFetch?: boolean;
}): Promise<SourceIngestResult> {
  const fetched = await job.run();
  if (fetched.isErr()) {
    return fetchFailureResult({ errors: fetched.error, source: job.source });
  }
  const sampled = sample !== undefined;
  const records = sampled ? capPerContainer({ records: fetched.value.records, sample }) : fetched.value.records;
  const { warnings } = fetched.value;
  const gaps = fetched.value.gaps ?? [];
  const notes = fetched.value.notes ?? [];
  // `|| isCursorlessSource` rather than the flag alone: the flag is what a job DECLARES, and a job that forgot
  // it would otherwise advance a cursor for a source that has none. The write itself refuses too
  // ({@link ../corpus/watermark.advanceWatermark}); this layer keeps the run from asking in the first place.
  const holdCursor = shouldHoldCursor({
    boundedFetch,
    cursorless: job.cursorless === true || isCursorlessSource({ source: job.source }),
    gaps,
    sampled,
  });
  const committedProjected = fetched.value.projectedPerContainer ?? 0;
  // A job that committed per-container has already done real work, so an empty BULK write is not an empty
  // run — taking the shortcut below would report it as zero written and advance its cursor to the window end.
  if (records.length === 0 && committedProjected === 0) {
    const advanced = holdCursor
      ? NOOP_ADVANCE
      : deps.advance({ home, watermarks: [{ cursor: job.window.until, source: job.source }] });
    return emptyFetchResult({ advanced, gaps, notes, source: job.source, warnings });
  }
  return writeAndAdvance({
    committedCursor: fetched.value.committedCursor,
    committedProjected,
    committedWritten: fetched.value.committedPerContainer ?? 0,
    deps,
    gaps,
    holdCursor,
    home,
    job,
    notes,
    records,
    warnings,
  });
}

/**
 * The tail of one ingest: write the bulk batch, advance the cursor, and fold the counts into a result.
 *
 * Split out because the counts arithmetic has three inputs from two different places — what the bulk write
 * did, what the job already banked per container, and what the author denylist refused — and reading it
 * beside the fetch and sampling logic made the whole run one long function with two unrelated concerns.
 *
 * @param records the bulk batch, already sampled
 * @param committedProjected records the job already banked container by container
 * @param committedWritten how many of those actually reached disk
 * @param committedCursor the newest instant those per-container commits covered
 * @param holdCursor whether this run must leave its resume cursor exactly where it was
 * @returns the write-failed result, or the successful one with its counts
 * @internal — reached only through {@link ingestOneWithDeps}; nothing outside this file names it.
 */
function writeAndAdvance({
  job,
  home,
  deps,
  records,
  warnings,
  gaps,
  notes,
  holdCursor,
  committedProjected,
  committedWritten,
  committedCursor,
}: {
  job: SourceIngestJob;
  home: string;
  deps: IngestDeps;
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  gaps: readonly CoverageGap[];
  notes: readonly string[];
  holdCursor: boolean;
  committedProjected: number;
  committedWritten: number;
  committedCursor: string | undefined;
}): SourceIngestResult {
  const written = deps.write({ home, records, window: job.window });
  if (written.isErr()) {
    return writeFailureResult({ errors: written.error, projected: records.length, source: job.source, warnings });
  }
  const advanced = advanceForRun({
    committedCursor,
    deps,
    holdCursor,
    home,
    job,
    records,
  });
  return successfulIngestResult({
    advanced,
    gaps,
    notes,
    source: job.source,
    warnings,
    ...runCounts({
      bulkExcluded: written.value.excluded,
      bulkProjected: records.length,
      bulkWritten: written.value.written,
      committedProjected,
      committedWritten,
    }),
  });
}

/**
 * Whether this run must leave its resume cursor exactly where it was.
 *
 * FOUR independent reasons, and they are not the same reason:
 *
 *  - `sampled` — the run deliberately looked at only part of the window, so advancing would skip the
 *    un-sampled remainder.
 *  - `boundedFetch` (`--fetch-cap`) — the fetch ITSELF was bounded, so the lane never saw the rest of its
 *    window. This was the sharper half of a real bug: the issues lane is ordered by `updatedAt` DESCENDING, so
 *    a capped run keeps the NEWEST items and then advanced the cursor to roughly now. Every item below the cap
 *    boundary was skipped by every future refresh, permanently, with the run reporting success.
 *  - `gaps` — the run TRIED to see the whole window and could not, and no OTHER cursor is holding the span it
 *    missed. Advancing would step permanently over data the API really has, and no later refresh would ever
 *    ask for it again. A gap whose lane withholds that span in its own per-container resume state is the one
 *    exception, and it is the lane's claim rather than this function's guess —
 *    {@link CoverageGap.heldPerContainer} carries the measurement that bought it. Such a gap still FAILS the
 *    run: the hold and the verdict are different questions, and answering them with one flag is what froze a
 *    workspace-wide cursor on a single stalled conversation.
 *  - `cursorless` — the SOURCE has no cursor to advance (see {@link SourceIngestJob.cursorless}). The other
 *    three are properties of the run; this one is a property of the lane, and it holds on every run.
 *
 * All four suppress the advance; only `gaps` is a failure. The records that DID arrive are written either
 * way — a partial capture beats none, and the write path deduplicates, so re-running after the gap closes
 * converges rather than duplicating. Pure.
 *
 * @param sampled whether `--sample` bounded what was kept
 * @param boundedFetch whether `--fetch-cap` bounded what was fetched
 * @param gaps the coverage gaps the lane reported; one already held per container does not hold the pool
 * @param cursorless whether the source has no resume cursor at all
 * @returns true when the cursor must not move
 */
function shouldHoldCursor({
  sampled,
  boundedFetch,
  gaps,
  cursorless,
}: {
  sampled: boolean;
  boundedFetch: boolean;
  gaps: readonly CoverageGap[];
  cursorless: boolean;
}): boolean {
  return sampled || boundedFetch || cursorless || gaps.some((gap) => !gap.heldPerContainer);
}

/** Per-source ingest progress, emitted as each source starts + finishes (non-blocking). */
export interface IngestProgress {
  readonly source: CorpusSource;
  readonly label: string;
  readonly phase: "start" | "done";
  readonly done: number;
  readonly total: number;
  readonly written?: number;
}

/**
 * Run every source job sequentially (bounded concurrency is a later, rate-limit-proven change),
 * committing each source's records + watermark independently. `onProgress` fires as each source starts
 * and finishes, so a long refresh is visible in the session (non-blocking).
 *
 * @param jobs the per-source ingest jobs
 * @param home the Slopweaver home
 * @param onProgress optional per-source progress callback
 * @param deps the injected effect bag (fetch/write/watermark), swapped for plain fakes under test
 * @param sample fast-feedback cap: keep at most this many records per container AND skip the watermark
 *   advance, so a sampled run can never be mistaken for a complete one
 * @param boundedFetch whether the fetch itself was bounded (`--fetch-cap`), recorded so a capped crawl is
 *   reported as capped rather than as having found everything there was
 * @returns one result per job, in order
 */
export async function ingestSources({
  jobs,
  home,
  onProgress,
  deps = productionIngestDeps,
  sample,
  boundedFetch = false,
}: {
  jobs: readonly SourceIngestJob[];
  home: string;
  onProgress?: (progress: IngestProgress) => void;
  deps?: IngestDeps;
  /** Fast-feedback cap: keep ≤ `sample` records per container AND skip the watermark advance. */
  sample?: number;
  /**
   * Whether the FETCH was bounded (`--fetch-cap`), which — like {@link sample} — means the lane did not see
   * its whole window, so no cursor may advance.
   */
  boundedFetch?: boolean;
}): Promise<Result<readonly SourceIngestResult[]>> {
  const results: SourceIngestResult[] = [];
  const total = jobs.length;
  for (const [index, job] of jobs.entries()) {
    onProgress?.({ done: index, label: job.label, phase: "start", source: job.source, total });
    const result = await ingestOneWithDeps({
      boundedFetch,
      deps,
      home,
      job,
      ...(sample !== undefined ? { sample } : {}),
    });
    results.push(result);
    onProgress?.({
      done: index + 1,
      label: job.label,
      phase: "done",
      source: job.source,
      total,
      written: result.written,
    });
  }
  return ok(results);
}
