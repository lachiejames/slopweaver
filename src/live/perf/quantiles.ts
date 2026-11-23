/**
 * Percentiles over a measured sample, as pure functions — no I/O, no clock.
 *
 * Nearest-rank rather than interpolated, because every sample here is a whole number of seconds read off
 * `ps` or off two event stamps, and an interpolated p95 of `[1, 2]` reading `1.95` would be a number that
 * was never measured. An EMPTY sample answers `undefined` throughout rather than zero: "no tool call
 * finished in the window" and "every tool call took no time" are opposite readings, and the machine-load
 * incident is what a gauge that confuses them costs (`../machine/fleetLoad.ts`'s own header).
 */

/** A measured sample's shape, for one seat or one hook. `undefined` nowhere — an empty sample has no row. */
export interface Distribution {
  /** How many samples it was computed from. Always ≥ 1. */
  readonly count: number;
  /** The nearest-rank median, in the sample's own unit. */
  readonly p50: number;
  /** The nearest-rank 95th percentile. */
  readonly p95: number;
  /** The largest sample. */
  readonly max: number;
}

/**
 * The nearest-rank value at a fraction of an ASCENDING sample.
 *
 * @param sorted the sample, already ascending — sorting here would hide a caller that forgot to
 * @param fraction where to read, 0 to 1
 * @returns the value at that rank, or `undefined` when the sample is empty
 */
export function percentile({ sorted, fraction }: { sorted: readonly number[]; fraction: number }): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Summarise a sample, sorting a copy so the caller's array is left alone.
 *
 * @param samples the measurements, in any order
 * @returns the distribution, or `undefined` when nothing was measured
 */
export function summarise({ samples }: { samples: readonly number[] }): Distribution | undefined {
  if (samples.length === 0) {
    return undefined;
  }
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    max: sorted[sorted.length - 1]!,
    p50: percentile({ fraction: 0.5, sorted })!,
    p95: percentile({ fraction: 0.95, sorted })!,
  };
}
