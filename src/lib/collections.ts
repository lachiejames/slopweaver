/**
 * Small collection primitives that had been reimplemented across silver, distil, and retrieval — count
 * maps (`m.set(k, (m.get(k) ?? 0) + 1)`), sorted-unique arrays, and the "clamp the limit to ≥0 before
 * slicing" guard the retrieval rankers hand-rolled. Pure and tested once here.
 */
import { compareStrings } from "./compare.js";

/**
 * Distinct values, sorted ascending by code point. Pure — the input is not mutated.
 *
 * @param values the values (with possible duplicates)
 * @returns the distinct values in ascending order
 */
export function sortedUnique({ values }: { values: readonly string[] }): readonly string[] {
  return [...new Set(values)].toSorted((a, b) => compareStrings({ a, b }));
}

/**
 * Count occurrences of each key. Pure — replaces the scattered `map.set(k, (map.get(k) ?? 0) + 1)` loops.
 *
 * @param keys the keys to tally (order-independent)
 * @returns a map of key → count
 */
export function countBy({ keys }: { keys: readonly string[] }): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    incrementCount({ counts, key });
  }
  return counts;
}

/**
 * Increment one key's count in place (the single-step form of {@link countBy}). Mutates + returns `counts`
 * so it composes inside an accumulation loop. The map itself is the caller's local state, never shared.
 *
 * A key the map has never held is being seen for the first time, so its tally opens at one — a line of code
 * rather than a coalesce, exactly as {@link pushInto} opens a bucket.
 *
 * @param counts the count map to mutate
 * @param key the key to bump
 * @returns the same map, with `key`'s count incremented
 */
export function incrementCount({ counts, key }: { counts: Map<string, number>; key: string }): Map<string, number> {
  const held = counts.get(key);
  if (held === undefined) {
    counts.set(key, 1);
    return counts;
  }
  counts.set(key, held + 1);
  return counts;
}

/**
 * Append one value to the bucket `key` names, creating that bucket the first time the key is seen. Mutates
 * and returns `buckets`, so it composes inside an accumulation loop exactly as {@link incrementCount} does.
 * The map is the caller's own local state, never shared.
 *
 * The first-sight case is a line of code rather than a coalesce, which is what
 * `.claude/rules/typescript-patterns.md` § No silent fallback asks for — the same reason this function
 * exists at all rather than `buckets.get(key) ?? []` being written out at each site.
 *
 * @param buckets the bucket map to mutate
 * @param value what to append
 * @returns the same map, with `value` appended to `key`'s bucket
 */
export function pushInto<T>({
  buckets,
  key,
  value,
}: {
  buckets: Map<string, T[]>;
  key: string;
  value: T;
}): Map<string, T[]> {
  const bucket = buckets.get(key);
  if (bucket === undefined) {
    buckets.set(key, [value]);
    return buckets;
  }
  bucket.push(value);
  return buckets;
}

/**
 * Add one value to the SET `key` names, creating that set the first time the key is seen — {@link pushInto}
 * for a map of sets, where the caller wants distinct values rather than every occurrence.
 *
 * @param sets the set map to mutate
 * @param value what to add
 * @returns the same map, with `value` in `key`'s set
 */
export function addInto({
  sets,
  key,
  value,
}: {
  sets: Map<string, Set<string>>;
  key: string;
  value: string;
}): Map<string, Set<string>> {
  const seen = sets.get(key);
  if (seen === undefined) {
    sets.set(key, new Set([value]));
    return sets;
  }
  seen.add(value);
  return sets;
}

/**
 * How many times `key` has been counted — the reading half of {@link incrementCount}. A key never counted
 * is zero, said out loud rather than coalesced. Pure.
 *
 * @param counts the count map to read
 * @returns that key's count, zero when the key was never counted
 */
export function countOf({ counts, key }: { counts: ReadonlyMap<string, number>; key: string }): number {
  const count = counts.get(key);
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * The first `limit` items, with the limit clamped to `[0, length]` — the `slice(0, Math.max(0, limit))`
 * guard the hybrid ranker used so a negative limit yields `[]` rather than dropping the tail. Pure.
 *
 * @param items the items to take from
 * @param limit the requested count (negative ⇒ `[]`, larger-than-length ⇒ all)
 * @returns the clamped prefix
 */
export function takeClamped<T>({ items, limit }: { items: readonly T[]; limit: number }): readonly T[] {
  return items.slice(0, Math.max(0, limit));
}
