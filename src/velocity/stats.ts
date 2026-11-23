/**
 * Tiny, dependency-free descriptive stats shared by the doc-latency and turns-per-ask measurements. Pure —
 * no clock, no I/O — and deliberately not pulled from a stats library: two functions do not earn a
 * dependency.
 */

/**
 * The arithmetic mean, or `undefined` over an empty sample rather than `NaN`.
 *
 * @param values the sample
 * @returns the mean, or `undefined` when `values` is empty
 */
export function mean({ values }: { values: readonly number[] }): number | undefined {
  return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The median, or `undefined` over an empty sample. An even-sized sample averages its two middle values.
 *
 * @param values the sample
 * @returns the median, or `undefined` when `values` is empty
 */
export function median({ values }: { values: readonly number[] }): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
