/**
 * The lexicographic ranking mechanic both providers' routers use — keys, their comparison, and a stable
 * sort by them. Pure: no clock, no filesystem, no provider vocabulary.
 *
 * ## Why this is shared and the KEYS are not
 *
 * `src/claude/loadBalance.ts` and `src/codex/rank.ts` rank different things on different evidence: Claude
 * has a Fable window, a plan-wide week and a measured 429 asymmetry that sets its second key, and Codex has
 * none of those. What the two genuinely share is the DISCIPLINE — a key is a tuple, keys are applied in
 * order, and each one only breaks the ties the one above it left. Extracting the discipline lets both
 * routers state their own policy as a list of numbers without either one copying a comparator.
 *
 * **Never a weighted scalar**, in either provider. There is no measured conversion between a five-hour
 * window and a seven-day one, so a weighted sum would be inventing an exchange rate and presenting it as
 * arithmetic. That reasoning is Claude's originally (`loadBalance.ts` § Lexicographic) and it transfers
 * intact, which is the test this extraction had to pass to be worth making.
 *
 * ## Missingness is a partition or an explicit element, never an absent one
 *
 * A key that is present on some pairs and absent on others is not a total order, and `Array.toSorted` over
 * a non-transitive comparator produces an arbitrary result that LOOKS deterministic. Both callers therefore
 * choose one key schema for a whole comparison, and encode "unmeasured" as a leading `0`/`1` element rather
 * than by shortening the tuple.
 */

/** One subject's sort key. Every element is the same type at the same position across the subjects compared. */
export type SortKey = readonly (number | string)[];

/**
 * Compare two sort keys element by element, the first difference deciding.
 *
 * A `undefined` element is SKIPPED rather than ordered, which is the shape Claude's ranking has always had:
 * it lets a caller leave a hole in a tuple without that hole deciding anything. It is not a licence to build
 * keys of differing schemas — see this module's header for why that is a non-transitive sort.
 *
 * @param left the first key
 * @param right the second key
 * @returns a standard comparator result, zero when every element matches
 */
export function compareKeys({ left, right }: { left: SortKey; right: SortKey }): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a === b) {
      continue;
    }
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    return String(a) < String(b) ? -1 : 1;
  }
  return 0;
}

/**
 * Rank a pool by one key function, best first.
 *
 * `toSorted` is stable, so the pool's own incoming order survives as the final tie-break without the caller
 * threading an explicit index through its key. Both routers rely on that: a register's row order is the
 * deterministic last word, which is what lets their tests assert an exact alias rather than a set.
 *
 * `key` takes its subject POSITIONALLY, which the named-object-params rule allows for a declared function
 * type — ordering one argument is not a thing a caller can get wrong — and every call site passes an inline
 * arrow naming the provider's own vocabulary (`(gauge) => weeklyKey({ gauge })`) rather than restating a
 * neutral field name this module would have imposed on both.
 *
 * @param pool the subjects to rank, in the order that should survive a tie
 * @param key the key function to rank them by
 * @returns the pool, best first
 */
export function rankBy<T>({ key, pool }: { key: (subject: T) => SortKey; pool: readonly T[] }): readonly T[] {
  return pool.toSorted((left, right) => compareKeys({ left: key(left), right: key(right) }));
}
