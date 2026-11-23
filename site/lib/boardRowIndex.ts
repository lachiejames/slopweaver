/**
 * A board reading's rows indexed by slug, so a record joining the rows it names reads those rows rather than every
 * row on the board — pure, so the equivalence with the scan it replaced is a unit test.
 *
 * MEASURED, a cold `/queue` load profiled in a launched browser (CDP `Profiler`, 0.5 ms sampling, the
 * walk's own `slopweaver perf console` browser): 6.5 s of main-thread self time sat in `actPlacement`'s scan of every
 * board row, once per act per call, with the Queue placing each act three or four times, and a further 1.3 s in
 * `actLinks`' scan, once per act card. Each is now one lookup per slug. Built by the caller that owns the reading,
 * once, from a COPY of its rows — so a caller changing its own array later cannot leave the positions describing
 * another one. The rows themselves are a reading — parsed JSON nothing writes to, and `slug` is
 * `readonly` in the type — so a row's slug changing after indexing is outside its contract.
 */

/** The rows of one board reading, with each slug's positions in board order. */
export interface BoardRowIndex<T extends { readonly slug: string }> {
  readonly rows: readonly T[];
  readonly positions: ReadonlyMap<string, readonly number[]>;
}

/**
 * Index a board reading's rows by slug.
 *
 * @param rows a board reading's rows, copied as they stand now
 * @returns the index
 */
export function indexBoardRows<T extends { readonly slug: string }>({
  rows,
}: {
  rows: readonly T[];
}): BoardRowIndex<T> {
  const kept = [...rows];
  const positions = new Map<string, number[]>();
  kept.forEach((row, at) => {
    const known = positions.get(row.slug);
    if (known === undefined) {
      positions.set(row.slug, [at]);
    } else {
      known.push(at);
    }
  });
  return { positions, rows: kept };
}

/**
 * The rows carrying any of `slugs`, in board order — exactly `rows.filter((row) => slugs.has(row.slug))` over the
 * indexed rows. Order is kept because a placement's first stated evidence rules (`placementOf`).
 *
 * @param index the board reading, indexed
 * @param slugs the slugs a record joins rows by
 * @returns the joined rows
 */
export function rowsCarrying<T extends { readonly slug: string }>({
  index,
  slugs,
}: {
  index: BoardRowIndex<T>;
  slugs: ReadonlySet<string>;
}): readonly T[] {
  return [...slugs]
    .flatMap((slug) => {
      const at = index.positions.get(slug);
      if (at === undefined) {
        return [];
      }
      return at;
    })
    .toSorted((a, b) => a - b)
    .map((at) => index.rows[at]);
}
