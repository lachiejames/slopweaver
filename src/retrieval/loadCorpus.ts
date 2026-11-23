/**
 * Load the full searchable corpus: bronze records + gold-as-records, over one flat readable set, TOGETHER
 * WITH the coverage manifest describing what that load actually managed to read.
 *
 * ## The line this module used to contain
 *
 * ```ts
 * const stored = bronze.ok ? bronze.value : [];
 * ```
 *
 * A failed bronze read became an empty array, the query proceeded gold-only, and the answer was
 * indistinguishable from a healthy run — same shape, same confidence, same exit code. That is the single
 * defect this step exists to remove: **a failed read must not be able to render as a clean answer.** The
 * error is now carried, per leg, into a {@link CoverageManifest} the caller must deal with.
 *
 * Bronze is append-only, so an edited entity has BOTH versions on disk. The collapse to the logical latest
 * view happens here, before anything ranks them, or a stale version competes with its own replacement as an
 * independent document — and the versions it hides are reported as a counted `superseded` skip rather than
 * vanishing from the arithmetic. Gold is synthesised fresh per query (one record per section, stamped
 * `nowIso`) and has no prior versions to supersede, so it is a leg of its own, appended after the collapse.
 */

import type { CensusGroup } from "../corpus/corpusCensus.js";
import { readCorpusTally } from "../corpus/corpusDirRead.js";
import { resolveCorpusScan } from "../corpus/corpusResolve.js";
import { type CorpusProjection } from "../corpus/corpusRowCore.js";
import { type CorpusGroupTally } from "../corpus/corpusTallyCore.js";
import { latestRecords } from "../corpus/latestRecords.js";
import { readSubsetManifest } from "../corpus/subsetStore.js";
import { excludeFromSync, loadSyncExclusion } from "../corpus/syncExclusion.js";
import type { CorpusRecord } from "../corpus/types.js";
import { appendAll } from "../lib/arrays.js";
import { guardHeap, type HeapGuard } from "../lib/heapBudget.js";
import { err, ok, type Result } from "../lib/result.js";
import { buildLeg, type CoverageLeg, type CoverageManifest, STALE_AFTER_DAYS } from "./coverage.js";
import { readGoldRecords } from "./goldRecords.js";
import { type LoadCorpusError, LoadCorpusErrors } from "./loadCorpus.errors.js";
import { findRecordKeyCollisions } from "./recordKey.js";

/** What a corpus load produced: the records to rank, and an honest account of how they were obtained. */
export interface CorpusLoad {
  readonly records: readonly CorpusRecord[];
  readonly coverage: CoverageManifest;
  readonly warnings: readonly string[];
}

/** The newest `tsIso` among some records, or `undefined` when there are none. */
function newestTimestamp({ records }: { records: readonly CorpusRecord[] }): string | undefined {
  let newest: string | undefined;
  for (const record of records) {
    if (newest === undefined || record.tsIso > newest) {
      newest = record.tsIso;
    }
  }
  return newest;
}

/** A whole read's per-group tallies in the census's terms, which {@link coverageOf} reads. */
function groupsOf({ tallies }: { tallies: readonly CorpusGroupTally[] }): readonly CensusGroup[] {
  return tallies.map((tally) => ({
    group: tally.group,
    parsed: tally.records.length,
    rows: tally.rows,
    skipped: tally.skipped,
    unreadable: tally.unreadable,
  }));
}

/**
 * Which leg each record came from, by object identity. `latestRecords` returns the very objects it was
 * given, so a reference map attributes every SURVIVOR back to the leg whose rows produced it — which is what
 * makes the conservation law exact rather than approximately per-source.
 */
function legIndex({ tallies }: { tallies: readonly CorpusGroupTally[] }): Map<CorpusRecord, string> {
  const index = new Map<CorpusRecord, string>();
  for (const tally of tallies) {
    for (const record of tally.records) {
      index.set(record, tally.group);
    }
  }
  return index;
}

/** What one leg contributed to the latest view: how many survivors, and the newest of their timestamps. */
interface LegSurvivors {
  readonly count: number;
  readonly newestIso: string | undefined;
}

/**
 * Fold one survivor into its leg's tally — the one place a leg's survivor count and newest timestamp are
 * accumulated. Pure apart from the map it updates.
 *
 * @param byLeg the tallies so far, keyed by leg name
 * @param leg the leg the survivor's row was read from
 * @param tsIso the survivor's timestamp
 */
function countSurvivor({ byLeg, leg, tsIso }: { byLeg: Map<string, LegSurvivors>; leg: string; tsIso: string }): void {
  const prior = byLeg.get(leg);
  if (prior === undefined) {
    byLeg.set(leg, { count: 1, newestIso: tsIso });
    return;
  }
  const newer = prior.newestIso === undefined || tsIso > prior.newestIso;
  byLeg.set(leg, { count: prior.count + 1, newestIso: newer ? tsIso : prior.newestIso });
}

/** How many survivors each leg contributed, and the newest of them, keyed by leg name. */
function survivorsByLeg({
  survivors,
  index,
}: {
  survivors: readonly CorpusRecord[];
  index: ReadonlyMap<CorpusRecord, string>;
}): Map<string, LegSurvivors> {
  const byLeg = new Map<string, LegSurvivors>();
  for (const record of survivors) {
    const leg = index.get(record);
    if (leg !== undefined) {
      countSurvivor({ byLeg, leg, tsIso: record.tsIso });
    }
  }
  return byLeg;
}

/** Build the bronze legs: one per group, with the collapse's losses folded in as a counted `superseded` skip. */
function bronzeLegs({
  groups,
  survivors,
  nowIso,
  staleAfterDays,
}: {
  groups: readonly CensusGroup[];
  survivors: ReadonlyMap<string, LegSurvivors>;
  nowIso: string;
  staleAfterDays: number;
}): readonly CoverageLeg[] {
  return groups.map((tally) => {
    const kept = survivors.get(tally.group);
    const indexed = kept === undefined ? 0 : kept.count;
    // Every PARSED row of the leg the latest view does not keep — the superseded versions, and (when an
    // author denylist applies) the rows it excluded, exactly as this arithmetic has always counted them.
    const superseded = tally.parsed - indexed;
    return buildLeg({
      indexed,
      ingested: tally.rows,
      leg: tally.group,
      newestIso: kept === undefined ? undefined : kept.newestIso,
      nowIso,
      skipped:
        superseded > 0 ? [...tally.skipped, { count: superseded, reason: "superseded" as const }] : tally.skipped,
      staleAfterDays,
      unreadable: tally.unreadable,
    });
  });
}

/**
 * Collapse gold's own duplicate headings through the SAME winner rule bronze uses, then combine with the
 * already-collapsed bronze view.
 *
 * Gold is synthesised fresh per query and never de-duplicated before this — two identical `## ` headings in
 * one gold doc render the SAME `(source, container, sourceId)` identity twice. Cross-leg collapse never
 * happens here: gold's own `source` value never appears on a bronze row, so this can only collapse within
 * gold.
 *
 * @param current the already-collapsed bronze records
 * @param gold the freshly-synthesised gold records, not yet collapsed
 * @returns the combined record set, and the gold survivors alone (for the gold leg's own accounting)
 */
function combineWithGold({ current, gold }: { current: readonly CorpusRecord[]; gold: readonly CorpusRecord[] }): {
  combined: readonly CorpusRecord[];
  goldSurvivors: readonly CorpusRecord[];
} {
  const goldSurvivors = latestRecords({ records: gold });
  return { combined: [...current, ...goldSurvivors], goldSurvivors };
}

/**
 * Build the gold leg from gold records the caller has already collapsed.
 *
 * EXPORTED because the sliced query path needs the identical leg: gold is synthesised per question and is
 * never in the prebuilt index, so it is the one leg a query still counts for itself. Two implementations of
 * the same tally is how the two paths would start disagreeing about the same corpus.
 *
 * Gold is synthesised, so it is ingested and indexed in the same breath and can never skip a row for any
 * OTHER reason — its only possible skip class is {@link combineWithGold}'s own collapse of a duplicate
 * heading.
 *
 * @param gold every gold record before the collapse
 * @param goldSurvivors the gold records that survived {@link combineWithGold}'s collapse
 * @param nowIso the reference time for staleness
 * @param staleAfterDays how old the leg's newest record may be before it reads as stale
 * @returns the gold coverage leg
 */
function goldLeg({
  gold,
  goldSurvivors,
  nowIso,
  staleAfterDays,
}: {
  gold: readonly CorpusRecord[];
  goldSurvivors: readonly CorpusRecord[];
  nowIso: string;
  staleAfterDays: number;
}): CoverageLeg {
  return buildLeg({
    indexed: goldSurvivors.length,
    ingested: gold.length,
    leg: "gold",
    newestIso: newestTimestamp({ records: goldSurvivors }),
    nowIso,
    skipped:
      goldSurvivors.length < gold.length
        ? [{ count: gold.length - goldSurvivors.length, reason: "superseded" as const }]
        : [],
    staleAfterDays,
    unreadable: [],
  });
}

/**
 * Read bronze through the guarded reader and flatten its tallies, mapping the reader's failures into this
 * loader's own union — the heap refusal carries its numbers forward, anything else is a plain read failure.
 *
 * @param dir the resolved bronze root
 * @param projection which fields each record retains
 * @param heapGuard the guard the reader consults before each file
 * @param home the Slopweaver home whose protect list the reader judges `dir` by, when one was given
 * @returns the tallies and the flattened records, or the typed failure — a protect-list refusal among them
 */
function readBronze({
  dir,
  projection,
  heapGuard,
  home,
}: {
  dir: string;
  projection: CorpusProjection;
  heapGuard: HeapGuard;
  home: string | undefined;
}): Result<
  { tallies: readonly CorpusGroupTally[]; stored: readonly CorpusRecord[]; warnings: readonly string[] },
  LoadCorpusError
> {
  const bronze = readCorpusTally({ dir, heapGuard, projection, ...(home !== undefined ? { home } : {}) });
  if (bronze.isErr()) {
    return err(
      bronze.error.code === "CORPUS_HEAP_CEILING"
        ? LoadCorpusErrors.heapCeiling({ cause: bronze.error })
        : LoadCorpusErrors.bronzeReadFailed({ message: bronze.error.message }),
    );
  }
  const stored: CorpusRecord[] = [];
  for (const tally of bronze.value.tallies) {
    appendAll({ from: tally.records, into: stored });
  }
  return ok({ stored, tallies: bronze.value.tallies, warnings: bronze.value.warnings });
}

/**
 * The coverage manifest for one load: a leg per bronze source, the gold leg, and — when the home is one —
 * the subset window every answer path then states.
 *
 * The subset is read off the HOME rather than passed in, so a caller cannot forget it. A `--corpus <dir>`
 * override with no home still resolves the default home here, which is correct: the override narrows which
 * bronze is read, it does not turn a subset home into a full one.
 *
 * @param groups each bronze leg's row accounting
 * @param survivors what each leg contributed to the latest view
 * @param gold the gold records read back
 * @param goldSurvivors the gold records that survived the combine
 * @param nowIso the staleness reference
 * @param staleAfterDays how old a leg's newest record may be before it reads as stale
 * @param home the Slopweaver home, when one was given
 * @returns the manifest to hand back with the records
 */
function coverageOf({
  groups,
  survivors,
  gold,
  goldSurvivors,
  nowIso,
  staleAfterDays,
  home,
}: {
  groups: readonly CensusGroup[];
  survivors: ReadonlyMap<string, LegSurvivors>;
  gold: readonly CorpusRecord[];
  goldSurvivors: readonly CorpusRecord[];
  nowIso: string;
  staleAfterDays: number;
  home?: string;
}): CoverageManifest {
  const legs = [
    ...bronzeLegs({ groups, nowIso, staleAfterDays, survivors }),
    // Still a leg despite never skipping for its own reason: with gold deferred by owner decision it
    // reports `absent`, which is a fact about the answer — not the silence it used to be.
    goldLeg({ gold, goldSurvivors, nowIso, staleAfterDays }),
  ];
  const subset = readSubsetManifest(home === undefined ? {} : { home });
  return { legs, ...(subset !== undefined ? { subset } : {}) };
}

/**
 * Drop every record the install's author denylist excludes, before anything collapses or ranks them.
 *
 * Applied to the RETRIEVAL view rather than to bronze on disk: the rows stay where they are, and nothing
 * that ranks, embeds or answers sees them again. A load failure REFUSES rather than defaulting to excluding
 * nothing — a query answering from records the operator had excluded, and saying nothing about it, is the
 * failure this whole feature exists to prevent.
 *
 * @param stored every record the bronze read returned
 * @param home the Slopweaver home the denylist is read from
 * @returns the admitted records, or the typed refusal when the denylist could not be read
 * @internal — reached only through {@link loadCorpus}; nothing outside this file names it.
 */
function admitRecords({
  stored,
  home,
}: {
  stored: readonly CorpusRecord[];
  home?: string;
}): Result<readonly CorpusRecord[], LoadCorpusError> {
  const exclusion = loadSyncExclusion(home === undefined ? {} : { home });
  if (exclusion.isErr()) {
    return err(LoadCorpusErrors.exclusionUnreadable({ message: exclusion.error.join("; ") }));
  }
  return ok(excludeFromSync({ exclusion: exclusion.value, records: stored }).kept);
}

/**
 * Load bronze + gold records for retrieval, with the coverage manifest that says what was read.
 *
 * A missing corpus is still an `err` (the verb maps it to an expected-empty exit) — that is a genuine
 * ABSENCE. An unreadable one is not: it comes back `ok` with a `failed` leg, so the caller can refuse
 * loudly instead of printing "no corpus yet" at someone whose real problem is a permission bit.
 *
 * ONE heap guard stands in this path: the bronze reader checks the real isolate between read chunks (see
 * {@link readCorpusTally}) and refuses as a typed `LOAD_CORPUS_HEAP_CEILING` naming the corpus, the ceiling
 * and the flag. A SECOND guard — over a BM25 index a caller might build in heap over these records — used to
 * stand here too. It is gone with the index itself: every in-heap and prebuilt
 * ranker is retired, the `store` verbs select from the store, and the whole-corpus callers that remain (`seed --demo`,
 * `slice verify`, the browser console's WORLD MODEL section) never allocate one.
 *
 * The records come back in the RETRIEVAL projection unless a caller says otherwise: `raw` is never read by
 * anything downstream of this load, and on the real corpus it was 56% of the heap the load retained. The
 * only caller that asks for `bronze` is `dev heap-curve`, measuring what the other projection costs.
 *
 * @param home the Slopweaver home
 * @param corpus an explicit corpus dir override (bronze)
 * @param nowIso the timestamp to stamp gold records with (so they rank as fresh), and the staleness reference
 * @param staleAfterDays how old a leg's newest record may be before it reads as stale
 * @param heapGuard the guard consulted before each big allocation — the real isolate unless a test injects one
 * @param projection which fields each record retains — `retrieval` (no `raw`) unless a caller says otherwise
 * @returns the combined records plus the coverage manifest, or an error when no corpus exists at all
 */
export function loadCorpus({
  home,
  corpus,
  nowIso,
  staleAfterDays = STALE_AFTER_DAYS,
  heapGuard = guardHeap,
  projection = "retrieval",
}: {
  home?: string;
  corpus?: string;
  nowIso: string;
  staleAfterDays?: number;
  heapGuard?: HeapGuard;
  projection?: CorpusProjection;
}): Result<CorpusLoad, LoadCorpusError> {
  const resolved = resolveCorpusScan({
    ...(home !== undefined ? { home } : {}),
    ...(corpus !== undefined ? { corpus } : {}),
  });
  // A tree the owner's protect list refuses fails as a read the same refusal would fail, never as an absent corpus.
  if (resolved.isErr()) {
    return err(LoadCorpusErrors.bronzeReadFailed({ message: resolved.error.message }));
  }
  const resolution = resolved.value;
  // ONLY a genuine absence errs here, because the shell renders an `err` as "no corpus yet — run
  // `slopweaver refresh` first". An unreadable tree used to take that same branch, sending a reader off to
  // re-fetch 112 MB when the fix was a permission bit. It now falls through to the read, where the
  // unreadable directories surface as a FAILED leg and the query refuses instead.
  if (resolution.fileCount === 0 && resolution.unreadableDirs.length === 0) {
    return err(LoadCorpusErrors.empty({ dir: resolution.dir }));
  }
  const bronze = readBronze({ dir: resolution.dir, heapGuard, home, projection });
  if (bronze.isErr()) {
    return err(bronze.error);
  }
  const admitted = admitRecords({ ...(home !== undefined ? { home } : {}), stored: bronze.value.stored });
  if (admitted.isErr()) {
    return err(admitted.error);
  }
  const current = latestRecords({ records: admitted.value });
  const gold = readGoldRecords({ ...(home !== undefined ? { home } : {}), tsIso: nowIso });
  const { combined, goldSurvivors } = combineWithGold({ current, gold });
  const collisions = findRecordKeyCollisions({ records: combined });
  if (collisions.length > 0) {
    return err(LoadCorpusErrors.recordKeyCollision({ collisions }));
  }
  return ok({
    coverage: coverageOf({
      gold,
      goldSurvivors,
      nowIso,
      staleAfterDays,
      groups: groupsOf({ tallies: bronze.value.tallies }),
      ...(home !== undefined ? { home } : {}),
      survivors: survivorsByLeg({ index: legIndex({ tallies: bronze.value.tallies }), survivors: current }),
    }),
    records: combined,
    warnings: bronze.value.warnings,
  });
}
