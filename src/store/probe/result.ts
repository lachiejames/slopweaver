/**
 * What a probe comes to — the count matrix a detective reads, and the pure folds that build it.
 *
 * No I/O and no database types: {@link ./run} hands raw rows in, everything here is testable without a
 * Postgres. That split is what lets the ladder's arithmetic — which cell is a lead, which is too wide to
 * enumerate, where the count collapses — be asserted exactly rather than approximately.
 */
import { PROBE_SHAPES, type ProbeShape, probeShapeSpec } from "./shapes.js";

/** How many rows one source contributed to one cell. */
export interface SourceCount {
  readonly source: string;
  readonly rows: number;
}

/** One cell of the matrix: what one shape found for one subject. */
export interface ProbeCell {
  readonly shape: ProbeShape;
  /** Total rows across every source. */
  readonly rows: number;
  /** The same total, split by source, largest first. Empty when the cell is empty. */
  readonly bySource: readonly SourceCount[];
  /**
   * The record ids, newest first, when the cell was narrow enough to enumerate.
   *
   * `null` means NOT ASKED because the count was above the enumeration cap — never "there were none",
   * which is `[]` on a cell whose `rows` is 0. A detective reads the difference: an empty list is a dead
   * end, a null is a seam that needs narrowing first.
   */
  readonly ids: readonly string[] | null;
  /** False when no index could serve this shape for this subject, so it scanned every row. */
  readonly indexed: boolean;
}

/** One subject's whole ladder. */
export interface ProbeRow {
  /** The keyword, or the caller's own regex source. */
  readonly subject: string;
  /** Which of the two kinds of subject this is. */
  readonly kind: "term" | "regex";
  /** Every shape that was run, narrowest first. */
  readonly cells: readonly ProbeCell[];
  /**
   * Bot-authored rows the human-only default left out of this subject's widest set — `wild-both`'s
   * containment for a keyword, the pattern's own match for a regex. Zero when the probe included bots.
   * It is what tells a detective that widening with `--include-bots` would change the answer.
   */
  readonly botsHidden: number;
  readonly elapsedMs: number;
}

/** Everything one probe invocation found. */
export interface ProbeReport {
  readonly rows: readonly ProbeRow[];
  /** The source the probe was restricted to, or nothing when it ran over the whole store. */
  readonly source: string | null;
  /** Whether bot-authored rows were counted — false is the default, human-only. */
  readonly includeBots: boolean;
  /** The count at or below which a cell's ids were fetched. */
  readonly enumerateAtOrBelow: number;
  readonly elapsedMs: number;
}

/**
 * Fold `(source, rows)` pairs into the per-source split, largest first, and their total.
 *
 * Ties break on the source name so the rendered order is stable across runs — an unstable order in a
 * report two detectives compare is a difference that means nothing and costs a reading.
 *
 * @param counts one row per source, as the statement returned them
 * @returns the total and the ordered split
 */
export function foldSourceCounts({ counts }: { counts: readonly SourceCount[] }): {
  readonly rows: number;
  readonly bySource: readonly SourceCount[];
} {
  const kept = counts.filter((count) => count.rows > 0);
  const bySource = kept.toSorted((left, right) =>
    left.rows === right.rows ? left.source.localeCompare(right.source) : right.rows - left.rows,
  );
  return { bySource, rows: bySource.reduce((total, count) => total + count.rows, 0) };
}

/**
 * Order a ladder's cells narrowest-shape-first, matching {@link ./shapes.PROBE_SHAPES}.
 *
 * @param cells the cells in whatever order they were computed
 * @returns the cells in reading order
 */
export function orderCells({ cells }: { cells: readonly ProbeCell[] }): readonly ProbeCell[] {
  const rank = new Map(PROBE_SHAPES.map((shape, index) => [shape, index]));
  // `!` rather than a fallback: `rank` is built from PROBE_SHAPES, the tuple `ProbeShape` is defined as, so
  // every shape a cell can carry is a key — the same invariant `probeShapeSpec` reads its own map under.
  return cells.toSorted((left, right) => rank.get(left.shape)! - rank.get(right.shape)!);
}

/**
 * The narrowest non-empty cell of a ladder — where a detective spends its attention first.
 *
 * @param row one subject's ladder
 * @returns that cell, or nothing when every shape came back empty
 */
export function narrowestHit({ row }: { row: ProbeRow }): ProbeCell | null {
  const hit = orderCells({ cells: row.cells }).find((cell) => cell.rows > 0);
  if (hit === undefined) {
    // Every shape counted zero rows: the subject is a dead end, which is a finding rather than a failure.
    return null;
  }
  return hit;
}

/**
 * Where the ladder COLLAPSES: the largest drop in count between two adjacent rungs.
 *
 * This is the finding the owner described — a keyword whose exact match is 3 and whose alphanumeric match
 * is 4 has told you something, and one whose alphanumeric match is a million has told you something else.
 * The collapse names the rung worth reading and the rung that is noise, in one number.
 *
 * @param row one subject's ladder
 * @returns the two shapes and the factor between them, or nothing when fewer than two rungs found rows
 */
export function collapse({ row }: { row: ProbeRow }): {
  readonly from: ProbeShape;
  readonly to: ProbeShape;
  readonly factor: number;
} | null {
  const hits = orderCells({ cells: row.cells }).filter((cell) => cell.rows > 0);
  let best: { from: ProbeShape; to: ProbeShape; factor: number } | null = null;
  for (let index = 1; index < hits.length; index += 1) {
    // Non-null: `index` runs from 1 to hits.length - 1, so both lookups are inside the array.
    const narrow = hits[index - 1]!;
    const wide = hits[index]!;
    const factor = wide.rows / narrow.rows;
    if (best === null || factor > best.factor) {
      best = { factor, from: narrow.shape, to: wide.shape };
    }
  }
  return best;
}

/**
 * One line describing a cell, for the human report.
 *
 * @returns the line, without its leading indent
 */
export function cellLine({ cell }: { cell: ProbeCell }): string {
  const spec = probeShapeSpec({ shape: cell.shape });
  const split = cell.bySource.map((count) => `${count.source} ${String(count.rows)}`).join(" · ");
  const scan = cell.indexed ? "" : "  [no index — scanned every row]";
  const head = `${cell.shape.padEnd(10)} ${spec.wildcard.padEnd(24)} ${String(cell.rows).padStart(9)}`;
  return cell.rows === 0 ? `${head}${scan}` : `${head}  ${split}${scan}`;
}
