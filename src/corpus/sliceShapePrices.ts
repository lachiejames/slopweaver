/**
 * What each candidate slice would KEEP — the pricing half of the corpus shape.
 *
 * {@link ./sliceShape} folds bronze into tallies and assembles the finished reading; this module answers the
 * question that reading exists for, one candidate at a time: a `--days` window, a per-source `--limit`, a
 * container cut-off read both ways, and how few containers hold a given share. Pure throughout — the tallies,
 * the totals and the clock all arrive as arguments.
 */

import type { CorpusSource } from "./types.js";

/**
 * The candidate `--days` windows a report prices, newest-first.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const CANDIDATE_WINDOW_DAYS: readonly number[] = [7, 14, 30, 60, 90, 180, 365];

/**
 * The candidate per-source `--limit` caps a report prices.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const CANDIDATE_CAPS: readonly number[] = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000];

/**
 * The share thresholds a concentration reading answers — how few containers hold this much of the source.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const CONCENTRATION_SHARES: readonly number[] = [0.5, 0.8, 0.95];

/**
 * The container-count cut-offs an allowlist (keep the top N) and a denylist (drop the top N) are priced at.
 *
 * @internal — exported for its own unit test; nothing outside this file reads it.
 */
export const CANDIDATE_CONTAINER_CUTS: readonly number[] = [1, 3, 5, 10, 25, 50];

/** A running record + byte pair. Mutable by design: it is the leaf of every tally in the accumulator. */
export interface Tally {
  records: number;
  bytes: number;
}

/**
 * A finished record + byte pair, with its share of the whole.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface ShapeSlice {
  readonly records: number;
  readonly bytes: number;
  readonly recordShare: number;
  readonly byteShare: number;
}

/**
 * One named bucket of the finished report.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface NamedSlice extends ShapeSlice {
  readonly key: string;
}

/**
 * What one candidate `--days` window would keep.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface WindowPrice extends ShapeSlice {
  readonly days: number;
  /** The window's own cut instant, so a re-run over a moved corpus is comparable rather than merely similar. */
  readonly sinceIso: string;
}

/**
 * What one candidate per-source `--limit` would keep.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface CapPrice {
  readonly limit: number;
  readonly records: number;
  readonly recordShare: number;
  /** Per source: how many of its records survive the cap. `min(limit, held)`, which is the whole arithmetic. */
  readonly bySource: readonly { readonly source: CorpusSource; readonly kept: number; readonly held: number }[];
}

/**
 * What a container cut-off buys, read both ways.
 *
 * `keep` is the allowlist reading — only the top N containers survive. `drop` is the denylist reading — the
 * top N are excluded and everything else survives. They are complements over the container-scoped records
 * and are reported together because the two are genuinely different proposals: an allowlist is a decision
 * about what the loop is FOR, and a denylist is a decision about what is noise.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface ContainerCutPrice {
  readonly containers: number;
  readonly keep: ShapeSlice;
  readonly drop: ShapeSlice;
}

/**
 * How few containers hold a given share of a source's records.
 *
 * @internal — reached only through {@link ./sliceShape.SliceShape}; nothing outside these two modules names it.
 */
export interface Concentration {
  readonly share: number;
  readonly containers: number;
}

/**
 * A share, with the zero-denominator case answered as 0 rather than `NaN`.
 *
 * @returns the fraction of `whole` that `part` is
 */
export function shareOf({ part, whole }: { part: number; whole: number }): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Price every candidate window off the DAY histogram plus the caller's clock.
 *
 * @returns one price per {@link CANDIDATE_WINDOW_DAYS} member
 */
export function priceWindows({
  byDay,
  nowMs,
  totalRecords,
  totalBytes,
}: {
  byDay: Map<string, Tally>;
  nowMs: number;
  totalRecords: number;
  totalBytes: number;
}): readonly WindowPrice[] {
  const dayMs = 24 * 60 * 60 * 1000;
  return CANDIDATE_WINDOW_DAYS.map((days) => {
    const sinceMs = nowMs - days * dayMs;
    let records = 0;
    let bytes = 0;
    for (const [key, tally] of byDay) {
      const startMs = Date.parse(`${key.slice(key.indexOf("\t") + 1)}T00:00:00.000Z`);
      // A whole day inside the window contributes whole. Only the day the cut lands in is prorated, and
      // only across that one day — so the worst error is a fraction of ONE day's records rather than a
      // fraction of a month's.
      const elapsed = Math.min(startMs + dayMs, nowMs) - startMs;
      const overlap = Math.min(startMs + dayMs, nowMs) - Math.max(startMs, sinceMs);
      if (overlap <= 0 || elapsed <= 0) {
        continue;
      }
      const fraction = Math.min(overlap / elapsed, 1);
      records += tally.records * fraction;
      bytes += tally.bytes * fraction;
    }
    return {
      byteShare: shareOf({ part: bytes, whole: totalBytes }),
      bytes: Math.round(bytes),
      days,
      recordShare: shareOf({ part: records, whole: totalRecords }),
      records: Math.round(records),
      sinceIso: new Date(sinceMs).toISOString(),
    };
  });
}

/**
 * Price every candidate per-source cap: `min(limit, held)` summed over the sources.
 *
 * @returns one price per {@link CANDIDATE_CAPS} member
 */
export function priceCaps({
  bySource,
  totalRecords,
}: {
  bySource: Map<CorpusSource, Tally>;
  totalRecords: number;
}): readonly CapPrice[] {
  return CANDIDATE_CAPS.map((limit) => {
    const rows = [...bySource.entries()]
      .map(([source, tally]) => ({ held: tally.records, kept: Math.min(limit, tally.records), source }))
      .toSorted((left, right) => right.held - left.held);
    const records = rows.reduce((sum, row) => sum + row.kept, 0);
    return { bySource: rows, limit, recordShare: shareOf({ part: records, whole: totalRecords }), records };
  });
}

/**
 * How few containers, biggest first, cover each share threshold.
 *
 * @returns one reading per {@link CONCENTRATION_SHARES} member
 */
export function concentrationOf({
  ranked,
  totalRecords,
}: {
  ranked: readonly NamedSlice[];
  totalRecords: number;
}): readonly Concentration[] {
  return CONCENTRATION_SHARES.map((share) => {
    const target = share * totalRecords;
    let running = 0;
    let containers = 0;
    for (const slice of ranked) {
      if (running >= target) {
        break;
      }
      running += slice.records;
      containers += 1;
    }
    return { containers, share };
  });
}

/**
 * Price each container cut-off, both ways, off the already-ranked list.
 *
 * The totals are the WHOLE corpus rather than only its container-scoped part, because a slice decision is
 * about how much of the pipeline's work survives — and a record with no container survives every container
 * rule there is. So `drop` counts it and `keep` does not, which is what makes the two not sum to one.
 *
 * @returns one price per {@link CANDIDATE_CONTAINER_CUTS} member
 */
export function priceContainerCuts({
  ranked,
  totalRecords,
  totalBytes,
}: {
  ranked: readonly NamedSlice[];
  totalRecords: number;
  totalBytes: number;
}): readonly ContainerCutPrice[] {
  return CANDIDATE_CONTAINER_CUTS.map((containers) => {
    const head = ranked.slice(0, containers);
    const keptRecords = head.reduce((sum, slice) => sum + slice.records, 0);
    const keptBytes = head.reduce((sum, slice) => sum + slice.bytes, 0);
    return {
      containers,
      drop: {
        byteShare: shareOf({ part: totalBytes - keptBytes, whole: totalBytes }),
        bytes: totalBytes - keptBytes,
        recordShare: shareOf({ part: totalRecords - keptRecords, whole: totalRecords }),
        records: totalRecords - keptRecords,
      },
      keep: {
        byteShare: shareOf({ part: keptBytes, whole: totalBytes }),
        bytes: keptBytes,
        recordShare: shareOf({ part: keptRecords, whole: totalRecords }),
        records: keptRecords,
      },
    };
  });
}
