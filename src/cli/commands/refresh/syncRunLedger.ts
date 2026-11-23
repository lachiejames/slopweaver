/**
 * The refresh verb's side of the sync-run ledger (`../../../syncRun/recorder.ts`): how one source's result becomes
 * the ledger's closing row, how production opens a run's recorder, and how a run's ingest is observed and closed.
 *
 * Split out of `./core.ts` and `./run.ts`, which both sit on a file-size ratchet, along the one seam the ledger
 * added: everything here exists for the Automations page, and nothing in the refresh itself reads it back.
 */

import { randomUUID } from "node:crypto";

import { safeFsAsync } from "#lib/safeBoundary.js";
import type { SourceIngestJob } from "../../../corpus/ingestJob.js";
import { logger } from "../../../lib/logger.js";
import { err } from "../../../lib/result.js";
import { withSyncRunObserver } from "../../../syncRun/observerScope.js";
import { createSyncRunRecorder, type SyncRunOutcome, storeAppend } from "../../../syncRun/recorder.js";
import type { RefreshOptions, RefreshResult } from "./core.js";
import type { RefreshDeps } from "./deps.js";

/**
 * One source's result as the sync-run ledger's closing row reads it. Pure.
 *
 * `excluded` and `gaps` are optional on a result because a lane that has neither omits them, so absence is
 * zero by the result's own contract rather than a value this function is guessing at.
 *
 * @param result the source's ingest result
 * @returns its outcome
 */
export function syncRunOutcomeOf({ result }: { result: RefreshResult }): SyncRunOutcome {
  return {
    deduped: result.deduped,
    errors: result.errors,
    excluded: optionalCount({ value: result.excluded }),
    gaps: result.gaps === undefined ? 0 : result.gaps.length,
    ok: result.ok,
    source: result.source,
    warnings: result.warnings.length,
    written: result.written,
  };
}

/** An optional count a result omits when it is zero. */
function optionalCount({ value }: { value: number | undefined }): number {
  if (value === undefined) {
    return 0;
  }
  return value;
}

/**
 * The production `openSyncRun` seam: one recorder per run, appending to the store under the run's home.
 *
 * A ledger write that fails is narrated through the logger as a warning and never fails the run.
 *
 * @returns the opened recorder
 */
export const productionOpenSyncRun: NonNullable<RefreshDeps["openSyncRun"]> = ({ home, jobs }) =>
  createSyncRunRecorder({
    append: storeAppend({ home }),
    jobs,
    nowIso: () => new Date().toISOString(),
    pid: process.pid,
    runId: randomUUID().slice(0, 8),
    warn: ({ msg }) => {
      logger.warn({ msg });
    },
  });

/**
 * Fetch one refresh's planned jobs under its sync-run recorder, then close the ledger.
 *
 * With no `openSyncRun` seam wired the ingest simply runs, so a test deck that wires no ledger writes none. A
 * failed ingest, returned or thrown, reads as every planned source failed with the ingest's own errors, so the summary, the exit code
 * and the closing line all say so — read as no results, it exited 3, nothing to do, and nothing named a failure.
 *
 * @param deps the seams the ingest and the ledger are reached through
 * @param home the Slopweaver home
 * @param jobs the planned per-source ingest jobs
 * @param options the parsed refresh options, of which `--sample` and `--fetch-cap` bound the fetch
 * @returns every source's result
 */
export async function ingestUnderSyncRun({
  deps,
  home,
  jobs,
  options,
}: {
  deps: Pick<RefreshDeps, "ingestSources" | "onProgress" | "openSyncRun">;
  home: string;
  jobs: readonly SourceIngestJob[];
  options: RefreshOptions;
}): Promise<readonly RefreshResult[]> {
  const ingest = (): ReturnType<RefreshDeps["ingestSources"]> =>
    deps.ingestSources({
      home,
      jobs,
      ...(deps.onProgress !== undefined ? { onProgress: deps.onProgress } : {}),
      ...(options.sample !== undefined ? { sample: options.sample } : {}),
      // `--fetch-cap` bounds the fetch, so like `--sample` it must not move any cursor.
      ...(options.fetchCap !== undefined ? { boundedFetch: true } : {}),
    });
  const recorder = deps.openSyncRun?.({ home, jobs });
  // A seam that throws is a failed ingest like any other, so it reaches the closing line instead of escaping it, and
  // the ledger still closes: a missing `finished` row would read as a run still going until its slot was released,
  // and as killed after that, when it actually failed here.
  const ingested = await safeFsAsync({
    execute: () =>
      recorder === undefined ? ingest() : withSyncRunObserver({ body: ingest, observer: recorder.observer }),
    operation: "ingestSources",
  });
  const outcome = ingested.isErr() ? err([ingested.error.message]) : ingested.value;
  const results = outcome.isOk() ? outcome.value : failedIngestResults({ errors: outcome.error, jobs });
  recorder?.finish({ outcomes: results.map((result) => syncRunOutcomeOf({ result })) });
  return results;
}

/** One failed result per planned source, each once in plan order, carrying the failed ingest's own errors. */
function failedIngestResults({
  errors,
  jobs,
}: {
  errors: readonly string[];
  jobs: readonly SourceIngestJob[];
}): readonly RefreshResult[] {
  const sources = [...new Set(jobs.map((job) => job.source))];
  return sources.map((source): RefreshResult => ({
    deduped: 0,
    errors,
    ok: false,
    projected: 0,
    source,
    warnings: [],
    written: 0,
  }));
}
