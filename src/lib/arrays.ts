/**
 * Array accumulation that is safe at data scale.
 *
 * ## The defect class this exists to close
 *
 * `into.push(...from)` passes every element of `from` as a separate ARGUMENT. Once `from` is longer than the
 * engine's argument limit the call throws `RangeError: Maximum call stack size exceeded`. That limit is
 * STACK-dependent, not a spec constant — measured at 123,947 elements on the Node 24 baseline, and lower
 * under a deeper call stack — so no length is portably "safe".
 *
 * **The direction is what matters, and it is easy to misread.** The argument count is the size of the
 * SPREAD SOURCE, never the size of the accumulator:
 *
 * - `accumulator.push(...onePage)` is safe however large `accumulator` grows — the page bounds the arguments.
 * - `accumulator.push(...wholeFileOrWholeSubtree)` is NOT safe — the data bounds the arguments.
 *
 * Classify by what PRODUCES the spread source, never by the variable's name. The real outage came from
 * `records.push(...parsed.value)`, where `parsed.value` reads like a chunk and was in fact an entire bronze
 * window file of well over a hundred thousand records, which took down every verb that reads bronze at once.
 *
 * A `readFileSync`/`readdirSync` in the same file is the tell that sizes are data-driven rather than
 * page-driven, which is why the `unbounded-spread` devLint gate scopes itself to exactly those files.
 */

/**
 * Append every element of `from` onto `into`, one at a time.
 *
 * Use this instead of `into.push(...from)` wherever `from` is produced by reading a file, walking a
 * directory tree, or otherwise sized by data rather than by a fixed page/batch.
 *
 * @param into the array to append onto (mutated)
 * @param from the elements to append
 */
export function appendAll<T>({ into, from }: { into: T[]; from: readonly T[] }): void {
  for (const item of from) {
    into.push(item);
  }
}

/**
 * Push one value onto a map-of-lists, minting the list on first use.
 *
 * The shape every grouping pass in this repo reaches for. Written as a named helper rather than inlined
 * because the inline form is four lines of if/else per call site, and repeating it is what took three Linear
 * reference functions over the cognitive-complexity ceiling at once.
 *
 * @param into the map to group into (mutated)
 * @param key the group to append to
 * @param value the value to append
 */
export function appendUnder<K, V>({ into, key, value }: { into: Map<K, V[]>; key: K; value: V }): void {
  const bucket = into.get(key);
  if (bucket === undefined) {
    into.set(key, [value]);
    return;
  }
  bucket.push(value);
}
