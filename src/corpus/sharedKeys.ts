/**
 * Which keys more than one distinct value shares — the collision question a key-injectivity check asks of a
 * whole corpus, answered without a set per key.
 *
 * Across a whole corpus nearly every key is unshared, so a key seen with one value holds that value and
 * nothing more; a set is built only for a key a second, different value actually arrives under.
 */

/**
 * Every key two or more distinct values share, with those values.
 *
 * @param pairs each `[key, value]` observation, in read order
 * @returns how many distinct keys were seen, and the shared ones in first-seen order, each with its
 *   distinct values in first-seen order
 */
export function sharedKeys({ pairs }: { pairs: Iterable<readonly [string, string]> }): {
  readonly keys: number;
  readonly shared: readonly (readonly [string, ReadonlySet<string>])[];
} {
  const byKey = new Map<string, string | Set<string>>();
  for (const [key, value] of pairs) {
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, value);
    } else if (typeof seen !== "string") {
      seen.add(value);
    } else if (seen !== value) {
      byKey.set(key, new Set([seen, value]));
    }
  }
  const shared = [...byKey].flatMap(([key, values]) => (typeof values === "string" ? [] : [[key, values] as const]));
  return { keys: byKey.size, shared };
}
