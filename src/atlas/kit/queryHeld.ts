/**
 * The query half of `./pageWalk.ts`'s `addressDisagreement`: whether the settled URL kept every parameter the request
 * carried, value for value. Its own module because it is the one part of that comparison with a counting rule.
 */

/**
 * A total map key for one query parameter, so two decoded halves can never be confused for another pair.
 *
 * LENGTH-PREFIXED rather than joined on a separator, because both halves are decoded values a provider
 * chose: any literal separator can appear inside a name or a value, and `encodeURIComponent` — the obvious
 * alternative — THROWS on a lone surrogate. This key is total, and a comparison every atlas's coverage
 * claim rests on should not have a throwing path in it at all, reachable or not.
 */
function queryKey({ name, value }: { name: string; value: string }): string {
  return `${String(name.length)}:${name}${value}`;
}

/**
 * Whether every parameter the REQUEST carried is matched in the settled URL, value for value.
 *
 * A MULTISET containment per name, not a lookup, and that is the correction rather than a detail:
 * `URLSearchParams.get` answers only the FIRST value, so a declaration carrying `status=A&status=B`
 * compared that way tests both requested values against the settled `"A"` and reports a disagreement
 * against a settled URL holding exactly `status=A&status=B`. Counting the settled values per name and
 * spending one per requested value is what makes a repeated parameter comparable at all.
 *
 * @param requested the address the walk asked for
 * @param settled where the browser settled
 * @returns whether the settled address holds every requested parameter
 */
export function requestedQueryHeld({ requested, settled }: { requested: URL; settled: URL }): boolean {
  const remaining = new Map<string, number>();
  for (const [name, value] of settled.searchParams.entries()) {
    const key = queryKey({ name, value });
    const seen = remaining.get(key);
    remaining.set(key, seen === undefined ? 1 : seen + 1);
  }
  for (const [name, value] of requested.searchParams.entries()) {
    const key = queryKey({ name, value });
    const left = remaining.get(key);
    if (left === undefined || left === 0) {
      return false;
    }
    remaining.set(key, left - 1);
  }
  return true;
}
