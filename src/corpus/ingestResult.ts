/**
 * The pure builders for one source's ingest outcome (`./ingestJob.ts`'s `SourceIngestResult`): a failed
 * fetch, an empty window, a failed write and a successful one. The shell that picks between them is
 * `./ingestSource.ts`.
 */
import type { Result } from "#lib/result.js";
import type { CoverageGap, SourceIngestResult } from "./ingestJob.js";
import type { CorpusSource } from "./types.js";

/** A watermark-advance outcome (the seam returns the repo `Result`; only its ok/errors shape the result). */
export type AdvanceOutcome = Result<unknown>;

/**
 * The fetch-failed result: nothing projected/written, the fetch errors surfaced. Pure.
 *
 * @param source which source failed
 * @param errors the fetch errors, surfaced verbatim
 * @returns a not-ok result with every count at zero — the watermark must NOT advance past a failed fetch
 */
export function fetchFailureResult({
  source,
  errors,
}: {
  source: CorpusSource;
  errors: readonly string[];
}): SourceIngestResult {
  return {
    deduped: 0,
    errors,
    excluded: 0,
    gaps: [],
    notes: [],
    ok: false,
    projected: 0,
    source,
    warnings: [],
    written: 0,
  };
}

/**
 * The empty-but-successful-window result: nothing to write, but the watermark still advanced to `until`
 * (so the window isn't re-scanned) — its ok/errors flow through. Pure.
 *
 * @param source which source returned nothing
 * @param warnings warnings raised during the empty fetch, which are kept even though nothing was written
 * @param advanced the watermark-advance outcome; its ok/errors become the result's, so a failed advance
 *   over an empty window is still reported as a failure
 * @param gaps coverage gaps observed for this source, carried even on an empty window
 * @param notes free-text notes for the summary
 * @returns a result with zero counts whose `ok` tracks the watermark, not the (absent) write
 */
export function emptyFetchResult({
  source,
  warnings,
  advanced,
  gaps = [],
  notes = [],
}: {
  source: CorpusSource;
  warnings: readonly string[];
  advanced: AdvanceOutcome;
  gaps?: readonly CoverageGap[];
  notes?: readonly string[];
}): SourceIngestResult {
  return {
    deduped: 0,
    excluded: 0,
    // The gaps ARE the errors when they are what failed the run: `refreshStreamEvents` prints `errors` as the
    // reason after "frozen:", and a gap-only failure carried none — MEASURED, five `write-refused`
    // calendar rows on the supervisor stream whose reason ended at the colon.
    errors: [...(advanced.isOk() ? [] : advanced.error), ...gaps.map((gap) => gap.message)],
    gaps,
    notes,
    // A held cursor is a no-op ADVANCE, which succeeds — so `advanced.isOk()` alone would report a lane that
    // could not see its window as fine. The gap has to be part of the verdict, not just carried beside it.
    ok: advanced.isOk() && gaps.length === 0,
    projected: 0,
    source,
    warnings,
    written: 0,
  };
}

/**
 * The write-failed result: records projected but the write errored, so the watermark did NOT advance. Pure.
 *
 * @param source which source failed to write
 * @param projected how many records were projected before the write failed — kept, so the loss is visible
 * @param warnings warnings raised during fetch/projection
 * @param errors the write errors
 * @returns a not-ok result with `written` at zero and `projected` intact
 */
export function writeFailureResult({
  source,
  projected,
  warnings,
  errors,
}: {
  source: CorpusSource;
  projected: number;
  warnings: readonly string[];
  errors: readonly string[];
}): SourceIngestResult {
  return {
    deduped: 0,
    errors,
    excluded: 0,
    gaps: [],
    notes: [],
    ok: false,
    projected,
    source,
    warnings,
    written: 0,
  };
}

/**
 * The write-succeeded result: the write counts stand REGARDLESS of the subsequent watermark advance — a
 * watermark failure after a good write is surfaced (ok/errors) without losing the write counts. Pure.
 *
 * @param source which source was ingested
 * @param projected how many records the projection produced
 * @param written how many actually landed on disk
 * @param deduped how many were dropped as already-present
 * @param warnings warnings raised during fetch/projection
 * @param advanced the watermark-advance outcome; it decides `ok` but never the counts
 * @param gaps coverage gaps observed during the fetch, so a partial crawl cannot report as complete
 * @param notes free-text notes for the summary
 * @returns the result, whose counts stand even when the watermark advance failed
 */
export function successfulIngestResult({
  source,
  projected,
  written,
  deduped,
  excluded = 0,
  warnings,
  advanced,
  gaps = [],
  notes = [],
}: {
  source: CorpusSource;
  projected: number;
  written: number;
  deduped: number;
  excluded?: number;
  warnings: readonly string[];
  advanced: AdvanceOutcome;
  gaps?: readonly CoverageGap[];
  notes?: readonly string[];
}): SourceIngestResult {
  return {
    deduped,
    // The gaps are the errors here too, for the reason `emptyFetchResult` gives: without them a partial crawl
    // that wrote rows is a failed source whose summary names no reason at all.
    errors: [...(advanced.isOk() ? [] : advanced.error), ...gaps.map((gap) => gap.message)],
    excluded,
    gaps,
    notes,
    ok: advanced.isOk() && gaps.length === 0,
    projected,
    source,
    warnings,
    written,
  };
}
