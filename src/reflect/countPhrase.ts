/**
 * Number agreement for the sentence a finding OPENS on — the one line the owner reads before grading it, so "1 pull
 * request(s) … are graded" is a defect there in a way it is not in a backlog line.
 */

/**
 * The wording that agrees with a count: `one` for exactly one, `many` for every other count, zero included
 * ("0 runs", never "0 run").
 *
 * @param one the words a single thing takes ("was", "pull request")
 * @param many the words any other count takes ("were", "pull requests")
 * @returns `one` when `count` is 1, otherwise `many`
 */
export function agreeing({ count, one, many }: { count: number; one: string; many: string }): string {
  if (count === 1) {
    return one;
  }
  return many;
}

/**
 * A count and the noun that agrees with it: `1 run`, `3 runs`.
 *
 * @param one the singular noun
 * @param many the plural noun
 * @returns the count followed by the agreeing noun
 */
export function countOf({ count, one, many }: { count: number; one: string; many: string }): string {
  return `${String(count)} ${agreeing({ count, many, one })}`;
}
