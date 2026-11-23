/**
 * Census the corpus → cut and hash the deterministic batch plan → load the digest cache. The one effectful
 * read shared by `distil status`, `distil brief` and `distil answer` (the last needs it again after caching a
 * fresh digest, to decide whether gold is now complete) — a single place for it means the latest-record
 * collapse can never drift between the three call sites.
 *
 * It STREAMS. The plan used to come from `readCorpusDir`, which held every record in heap before a batch was
 * cut, and on the owner's 10.6 GB corpus that read refused at the heap preflight on every run from early
 * September, so `distil status` answered nothing at all. The census (`corpus/corpusCensus.ts`) holds a byte
 * range per logical record instead, and a batch's records are read back only when a verb needs that batch.
 */
import { guardLoadSlot, type LoadSlotGuard } from "#lib/loadSlots.js";
import { err, ok, type Result } from "#lib/result.js";
import { type CorpusCensus, censusCorpus } from "../../../corpus/corpusCensus.js";
import { resolveCorpusDir } from "../../../corpus/corpusResolve.js";
import { type RowReader } from "../../../corpus/rowReader.js";
import type { CorpusSource } from "../../../corpus/types.js";
import type { BatchDigest } from "../../../gold/distil.js";
import { DISTIL_PROMPT_FINGERPRINT } from "../../../gold/distil.js";
import { loadDistilCache } from "../../../gold/distilCache.js";
import { censusCountsBySource, type PlannedDistilBatch, planDistilFromCensus } from "../../../gold/distilStreamPlan.js";
import { loadSlotRefusal } from "../../admitLoadSlot.js";
import type { DistilPlanOptions } from "./core.js";

/** The corpus inputs every distil verb plans from: the batch plan, the digest cache, and the census behind it. */
export interface DistilBatchPlan {
  readonly batches: readonly PlannedDistilBatch[];
  readonly cache: Map<string, BatchDigest>;
  /** The collapsed corpus, as byte ranges — what a brief's pinned refs are resolved against. */
  readonly census: CorpusCensus;
  /** How many logical records each source holds — what a source digest reports it covers. */
  readonly recordCountBySource: ReadonlyMap<CorpusSource, number>;
  readonly warnings: readonly string[];
}

/**
 * Census + cut + hash + load-cache, reporting a dir-resolution or read failure as an error and everything
 * else (malformed rows, the superseded-version count) as a warning.
 *
 * **The latest-record collapse is load-bearing** — an uncollapsed read would pay twice for every edited
 * entity and let filesystem read order decide batch membership (an old row and its repair share a `tsIso`
 * AND `sourceId`, the exact pair the batch chronology sorts by). This was silently reverted once already
 * (restored); the census performs it, under the `bronze` tie projection this plan has always read
 * with, so a digest paid for under the old whole-corpus read keys the same batch here.
 *
 * @param options the validated plan options (`--home`/`--corpus`/`--max-per-batch`/`--top-containers`/`--recent-only`)
 * @param home the resolved Slopweaver home
 * @param reader the open row reader ties and batch hashes read rows back through — the caller keeps it open
 *   for as long as it reads batches out of the plan
 * @param guard the machine's load-slot guard; omit for the real one
 * @returns the batch plan, or the machine's slot refusal / the read errors
 */
export function loadDistilBatchPlan({
  options,
  home,
  reader,
  guard = guardLoadSlot,
}: {
  options: DistilPlanOptions;
  home: string;
  reader: RowReader;
  guard?: LoadSlotGuard;
}): Result<DistilBatchPlan> {
  // BEFORE bronze is read, deliberately: the census holds one entry per logical record, which is still the
  // largest thing this machine's distil verbs commit, so it is one of the footprints the slot rations
  // (src/lib/loadSlots.ts). The refusal comes back as this Result's own errors, which every caller prints.
  const refusal = loadSlotRefusal({ guard });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const dir = resolveCorpusDir({ home, ...(options.corpus !== undefined ? { corpus: options.corpus } : {}) });
  if (dir.isErr()) {
    return err([dir.error.message]);
  }
  // PR4.5 DECISION (see retrieval/accessScope.ts): the owner sees every lane, so gold summarises the WHOLE
  // corpus — private-lane records included. Deliberately no `admit` filter, for the same reason the
  // pre-rewrite verb did not filter: gold is part of the owner's own world model.
  const census = censusCorpus({ dir: dir.value, home, reader, tieProjection: "bronze" });
  if (census.isErr()) {
    return err([census.error.message]);
  }
  // REFUSE on an unreadable file. This plan decides what gold gets built, and gold is the one thing here
  // that costs money to produce — a plan silently missing a source's batches spends a real budget on an
  // incomplete corpus and reports success.
  if (census.value.unreadable.length > 0) {
    return err([
      `refusing to plan distil: ${String(census.value.unreadable.length)} corpus path(s) could not be read, so this plan would omit their batches and report a complete run — ${census.value.unreadable.join(", ")}`,
    ]);
  }
  const hidden = census.value.admittedRows - census.value.winners.size;
  const staleNote =
    hidden > 0 ? [`hid ${String(hidden)} superseded record version(s) — distilling the latest of each`] : [];
  const batches = planDistilFromCensus({
    census: census.value,
    promptVersion: DISTIL_PROMPT_FINGERPRINT,
    reader,
    ...(options.maxPerBatch !== undefined ? { targetPerBatch: options.maxPerBatch } : {}),
    ...(options.topContainers !== undefined ? { topContainersPerSource: options.topContainers } : {}),
    recentOnly: options.recentOnly,
  });
  if (batches.isErr()) {
    return err([batches.error.message]);
  }
  return ok({
    batches: batches.value,
    cache: loadDistilCache({ home }),
    census: census.value,
    recordCountBySource: censusCountsBySource({ census: census.value }),
    warnings: [...census.value.warnings, ...staleNote],
  });
}
