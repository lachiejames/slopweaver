/**
 * The corpus shape a SLICE decision needs — one streaming pass, four answers.
 *
 * The rule is `SLICE = MEASURE`: time every stage of the pipeline, then price the
 * four candidate dev-loop slices — **window**, **cap**, **sample**, **channels** — back to the owner rather than
 * picking one. Three of those four needed a number nothing in this repository produced. A date histogram
 * says whether "the last 30 days" is 2% of the corpus or 20%; a per-container tally says whether an
 * allowlist of ten channels is most of Slack or a rounding error; a per-thread distribution says whether
 * sampling whole threads keeps a usable unit at all. This module and {@link ./sliceShapePrices} compute all
 * three, plus the cap arithmetic that was already derivable, from ONE pass over bronze.
 *
 * ## Why one accumulator rather than four passes
 *
 * A full `JSON.parse` pass over this install's 7.9 GB bronze runs at 518 MB/s (measured, repro:
 * `slopweaver dev slice-shape --json`), so the pass itself is seconds. Four passes would still be seconds,
 * and would still be wrong: each would read the corpus at a different instant, and a refresh landing between
 * two of them makes the window histogram disagree with the channel tally about how many records exist. One
 * accumulator over one pass makes every number in the report describe the same corpus.
 *
 * ## What is bounded and what is not
 *
 * Everything here is a tally keyed by a low-cardinality string except {@link SliceShapeAccumulator.threads},
 * which is keyed by thread root and therefore grows with Slack's thread count. That is the one map whose
 * size is a property of the data, so it is the one the shell has to watch. It stores two numbers per thread
 * and nothing else — never the records — precisely so the whole distribution fits where a list of records
 * would not.
 */

import { CONTAINER_SCOPED_SOURCES } from "../integrations/corpusSources.js";
import { parseIsoMs } from "../lib/date.js";
import {
  type CapPrice,
  type Concentration,
  type ContainerCutPrice,
  concentrationOf,
  type NamedSlice,
  priceCaps,
  priceContainerCuts,
  priceWindows,
  type ShapeSlice,
  shareOf,
  type Tally,
  type WindowPrice,
} from "./sliceShapePrices.js";
import type { CorpusSource } from "./types.js";

/** The `:reply:` infix a Slack reply's `sourceId` carries between its thread root and its own timestamp. */
const REPLY_INFIX = ":reply:";

/**
 * The percentiles a size distribution reports.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const DISTRIBUTION_PERCENTILES: readonly number[] = [50, 75, 90, 95, 99];

/** One row's fields, already extracted — everything the shape pass reads and nothing else. */
export interface SliceShapeRow {
  readonly source: CorpusSource;
  readonly tsIso: string;
  readonly container: string;
  readonly sourceId: string;
  /** The line's own byte length on disk, so a byte share is the real one rather than a re-serialised guess. */
  readonly byteLength: number;
}

/**
 * The mutable state one pass folds into.
 *
 * Deliberately not `readonly`: a 2-million-row fold that rebuilt an immutable structure per row would spend
 * the whole pass in the collector. The immutable value is {@link SliceShape}, which {@link finishSliceShape}
 * derives once at the end.
 */
export interface SliceShapeAccumulator {
  readonly bySource: Map<CorpusSource, Tally>;
  /**
   * `<source>\t<YYYY-MM-DD>` → tally. One flat map rather than nested, so a day with no records has no key.
   *
   * The bucket is the DAY rather than the month even though the report renders months, and that is what
   * makes a window price exact rather than an estimate. A month histogram prices `--days 30` by prorating
   * the boundary month across its 31 days, which assumes activity is uniform inside a month — and this
   * corpus is the counter-example, with 549,469 records in its peak month against 34,179 in the month
   * before it. Day buckets cost about 1,400 map entries over four years, which is nothing next to the
   * container and thread maps beside them.
   */
  readonly byDay: Map<string, Tally>;
  /** Container → tally, for the container-scoped sources only (see {@link CONTAINER_SCOPED_SOURCES}). */
  readonly byContainer: Map<string, Tally>;
  /** Thread root → tally, Slack only. The one map whose size grows with the data. */
  readonly threads: Map<string, Tally>;
  /** Row timestamps in epoch-ms, kept only as a running newest/oldest rather than a list. */
  readonly span: { newestMs: number; oldestMs: number };
  /** Rows whose `tsIso` did not parse — a window reading that silently dropped them would be a lie. */
  undatedRows: number;
  totalRows: number;
  totalBytes: number;
}

/**
 * A fresh, empty accumulator.
 *
 * @returns the zero state one pass folds rows into
 */
export function emptySliceShape(): SliceShapeAccumulator {
  return {
    byContainer: new Map(),
    byDay: new Map(),
    bySource: new Map(),
    span: { newestMs: Number.NEGATIVE_INFINITY, oldestMs: Number.POSITIVE_INFINITY },
    threads: new Map(),
    totalBytes: 0,
    totalRows: 0,
    undatedRows: 0,
  };
}

/**
 * The `YYYY-MM` bucket a record's timestamp falls in.
 *
 * Read off the ISO string's own leading characters rather than through a `Date`, because a `Date` would
 * re-interpret the offset a source wrote and move a record across a month boundary — `self` records carry
 * `+10:00` and would land in the previous month in UTC. The bucket is the month the source SAID, which is
 * the one a `--days` window is explained in.
 *
 * @param tsIso the record's own timestamp
 * @returns the bucket, or `undefined` when the value is not a date at all
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export function monthKeyOf({ tsIso }: { tsIso: string }): string | undefined {
  const head = tsIso.slice(0, 7);
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(head) ? head : undefined;
}

/**
 * The thread a Slack record belongs to, as its `sourceId` spells it.
 *
 * A root message's id IS its thread key, and a reply's is everything before the `:reply:` infix — so a root
 * and its replies collapse onto one key with no lookup and no second pass. A record from any other source
 * has no thread, and saying so is what stops a per-thread distribution quietly counting GitHub comments.
 *
 * @param source the record's origin, because only Slack ids carry this shape
 * @returns the thread root id, or `undefined` when the record is not a threaded Slack record
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export function threadKeyOf({ source, sourceId }: { source: CorpusSource; sourceId: string }): string | undefined {
  if (source !== "slack" || sourceId.length === 0) {
    return undefined;
  }
  const at = sourceId.indexOf(REPLY_INFIX);
  return at === -1 ? sourceId : sourceId.slice(0, at);
}

/**
 * The `YYYY-MM-DD` bucket a record's timestamp falls in.
 *
 * Read off the ISO string for the reason {@link monthKeyOf} carries — the day the source SAID, never the day
 * a `Date` would re-derive from its offset.
 *
 * @param tsIso the record's own timestamp
 * @returns the bucket, or `undefined` when the value is not a date at all
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export function dayKeyOf({ tsIso }: { tsIso: string }): string | undefined {
  const head = tsIso.slice(0, 10);
  return /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(head) ? head : undefined;
}

/** Add one row's weight to a keyed tally, creating the entry on first sight. */
function bump({ into, key, byteLength }: { into: Map<string, Tally>; key: string; byteLength: number }): void {
  const held = into.get(key);
  if (held === undefined) {
    into.set(key, { bytes: byteLength, records: 1 });
    return;
  }
  held.records += 1;
  held.bytes += byteLength;
}

/**
 * Fold one row into the accumulator.
 *
 * Mutates rather than returns, for the reason {@link SliceShapeAccumulator} carries: this is called once per
 * bronze line and there are about two million of them.
 *
 * @param into the accumulator to fold into
 * @param row the row's extracted fields
 */
export function absorbRow({ into, row }: { into: SliceShapeAccumulator; row: SliceShapeRow }): void {
  into.totalRows += 1;
  into.totalBytes += row.byteLength;

  const bySource = into.bySource.get(row.source);
  if (bySource === undefined) {
    into.bySource.set(row.source, { bytes: row.byteLength, records: 1 });
  } else {
    bySource.records += 1;
    bySource.bytes += row.byteLength;
  }

  const day = dayKeyOf({ tsIso: row.tsIso });
  const ms = parseIsoMs({ tsIso: row.tsIso });
  if (day === undefined || ms === undefined) {
    into.undatedRows += 1;
  } else {
    bump({ byteLength: row.byteLength, into: into.byDay, key: `${row.source}\t${day}` });
    into.span.newestMs = Math.max(into.span.newestMs, ms);
    into.span.oldestMs = Math.min(into.span.oldestMs, ms);
  }

  if (CONTAINER_SCOPED_SOURCES.includes(row.source) && row.container.length > 0) {
    bump({ byteLength: row.byteLength, into: into.byContainer, key: row.container });
  }

  const thread = threadKeyOf({ source: row.source, sourceId: row.sourceId });
  if (thread !== undefined) {
    bump({ byteLength: row.byteLength, into: into.threads, key: thread });
  }
}

/**
 * A size distribution over a population, in records and in bytes.
 *
 * @internal — reached only through {@link SliceShape}; nothing outside this file names it.
 */
export interface SizeDistribution {
  readonly population: number;
  readonly recordPercentiles: readonly { readonly percentile: number; readonly value: number }[];
  readonly bytePercentiles: readonly { readonly percentile: number; readonly value: number }[];
  readonly maxRecords: number;
  readonly maxBytes: number;
  readonly meanRecords: number;
  readonly meanBytes: number;
}

/** The immutable reading one pass produced. */
export interface SliceShape {
  readonly totalRecords: number;
  readonly totalBytes: number;
  readonly undatedRows: number;
  readonly newestIso: string | undefined;
  readonly oldestIso: string | undefined;
  readonly bySource: readonly (NamedSlice & { readonly source: CorpusSource })[];
  /** Every `YYYY-MM` that holds a record, oldest first, summed across sources. */
  readonly byMonth: readonly NamedSlice[];
  readonly windows: readonly WindowPrice[];
  readonly caps: readonly CapPrice[];
  /** Containers, biggest first. Capped by the caller's `--top`, with the remainder folded into a tail row. */
  readonly topContainers: readonly NamedSlice[];
  readonly containerCount: number;
  readonly containerTail: ShapeSlice;
  readonly concentration: readonly Concentration[];
  readonly containerCuts: readonly ContainerCutPrice[];
  readonly threads: SizeDistribution;
}

/** The value at a percentile of an ascending-sorted population, by nearest rank. */
function percentileOf({ sorted, percentile }: { sorted: readonly number[]; percentile: number }): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const at = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[at] ?? 0;
}

/**
 * The percentile table for one ascending-sorted population.
 *
 * @param sorted the population, ascending — sorted by the caller because both axes share one sort
 * @returns one entry per {@link DISTRIBUTION_PERCENTILES} member
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export function percentileTable({
  sorted,
}: {
  sorted: readonly number[];
}): readonly { readonly percentile: number; readonly value: number }[] {
  return DISTRIBUTION_PERCENTILES.map((percentile) => ({ percentile, value: percentileOf({ percentile, sorted }) }));
}

/** Fold a keyed tally map into named slices, biggest first by records. */
function rankSlices({
  tallies,
  totalRecords,
  totalBytes,
}: {
  tallies: Map<string, Tally>;
  totalRecords: number;
  totalBytes: number;
}): readonly NamedSlice[] {
  return namedSlicesOf({ tallies, totalBytes, totalRecords }).toSorted((left, right) => right.records - left.records);
}

/** The record and byte distribution over a keyed population. */
function distributionOf({ tallies }: { tallies: Map<string, Tally> }): SizeDistribution {
  const records: number[] = [];
  const bytes: number[] = [];
  let recordSum = 0;
  let byteSum = 0;
  for (const tally of tallies.values()) {
    records.push(tally.records);
    bytes.push(tally.bytes);
    recordSum += tally.records;
    byteSum += tally.bytes;
  }
  const sortedRecords = records.toSorted((left, right) => left - right);
  const sortedBytes = bytes.toSorted((left, right) => left - right);
  const population = sortedRecords.length;
  // An empty population has no largest member and reads 0, as its mean does. Otherwise both lists hold one
  // entry per tally (the loop above pushes each together), so `population - 1` indexes each one's largest.
  return {
    bytePercentiles: percentileTable({ sorted: sortedBytes }),
    maxBytes: population === 0 ? 0 : sortedBytes[population - 1]!,
    maxRecords: population === 0 ? 0 : sortedRecords[population - 1]!,
    meanBytes: population === 0 ? 0 : byteSum / population,
    meanRecords: population === 0 ? 0 : recordSum / population,
    population,
    recordPercentiles: percentileTable({ sorted: sortedRecords }),
  };
}

/**
 * Roll the day buckets up into one month bucket each, summed across sources.
 *
 * The pass tallies DAYS so a window price can be exact; a reader wants MONTHS, because 1,400 rows is a
 * listing and 46 is a shape. Both readings come off the same buckets, so they can never disagree.
 *
 * @param byDay the pass's own `<source>\t<YYYY-MM-DD>` tallies
 * @returns one tally per month that holds a record
 * @internal — reached only through {@link finishSliceShape}; nothing outside this file names it.
 */
function monthRollup({ byDay }: { byDay: Map<string, Tally> }): Map<string, Tally> {
  const months = new Map<string, Tally>();
  for (const [key, tally] of byDay) {
    const month = key.slice(key.indexOf("\t") + 1, key.indexOf("\t") + 8);
    const held = months.get(month);
    if (held === undefined) {
      months.set(month, { bytes: tally.bytes, records: tally.records });
    } else {
      held.records += tally.records;
      held.bytes += tally.bytes;
    }
  }
  return months;
}

/**
 * Turn a keyed tally map into named slices with their shares.
 *
 * @param tallies the tallies to name
 * @param totalRecords the denominator for a record share
 * @param totalBytes the denominator for a byte share
 * @returns one slice per key, in the map's own order
 * @internal — reached only through {@link finishSliceShape}; nothing outside this file names it.
 */
function namedSlicesOf({
  tallies,
  totalRecords,
  totalBytes,
}: {
  tallies: Map<string, Tally>;
  totalRecords: number;
  totalBytes: number;
}): readonly NamedSlice[] {
  return [...tallies.entries()].map(([key, tally]) => ({
    byteShare: shareOf({ part: tally.bytes, whole: totalBytes }),
    bytes: tally.bytes,
    key,
    recordShare: shareOf({ part: tally.records, whole: totalRecords }),
    records: tally.records,
  }));
}

/**
 * Derive the immutable reading from a finished pass.
 *
 * @param into the accumulator every row was folded into
 * @param nowMs the instant the candidate windows are measured back from — the caller's clock, so the pure
 *   half never reads one
 * @param top how many containers to name individually before the tail row
 * @returns the finished shape
 */
export function finishSliceShape({
  into,
  nowMs,
  top,
}: {
  into: SliceShapeAccumulator;
  nowMs: number;
  top: number;
}): SliceShape {
  const { totalRows, totalBytes } = into;
  const rankedContainers = rankSlices({ tallies: into.byContainer, totalBytes, totalRecords: totalRows });
  const named = rankedContainers.slice(0, Math.max(top, 0));
  const tail = rankedContainers.slice(named.length);
  const tailRecords = tail.reduce((sum, slice) => sum + slice.records, 0);
  const tailBytes = tail.reduce((sum, slice) => sum + slice.bytes, 0);
  const bySource = [...into.bySource.entries()].map(([source, tally]) => ({
    byteShare: shareOf({ part: tally.bytes, whole: totalBytes }),
    bytes: tally.bytes,
    key: source,
    recordShare: shareOf({ part: tally.records, whole: totalRows }),
    records: tally.records,
    source,
  }));
  return {
    byMonth: namedSlicesOf({
      tallies: monthRollup({ byDay: into.byDay }),
      totalBytes,
      totalRecords: totalRows,
    }).toSorted((left, right) => left.key.localeCompare(right.key)),
    bySource: bySource.toSorted((left, right) => right.records - left.records),
    caps: priceCaps({ bySource: into.bySource, totalRecords: totalRows }),
    concentration: concentrationOf({ ranked: rankedContainers, totalRecords: totalRows }),
    containerCount: rankedContainers.length,
    containerCuts: priceContainerCuts({ ranked: rankedContainers, totalBytes, totalRecords: totalRows }),
    containerTail: {
      byteShare: shareOf({ part: tailBytes, whole: totalBytes }),
      bytes: tailBytes,
      recordShare: shareOf({ part: tailRecords, whole: totalRows }),
      records: tailRecords,
    },
    newestIso: Number.isFinite(into.span.newestMs) ? new Date(into.span.newestMs).toISOString() : undefined,
    oldestIso: Number.isFinite(into.span.oldestMs) ? new Date(into.span.oldestMs).toISOString() : undefined,
    threads: distributionOf({ tallies: into.threads }),
    topContainers: named,
    totalBytes,
    totalRecords: totalRows,
    undatedRows: into.undatedRows,
    windows: priceWindows({ byDay: into.byDay, nowMs, totalBytes, totalRecords: totalRows }),
  };
}
