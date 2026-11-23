/**
 * The warnings one GitHub item crawl can raise, worded here and nowhere else. Pure: `fetch.ts`'s search and
 * enrichment lanes count what went wrong and hand the counts to these functions.
 *
 * Search is capped at GitHub's hard 1000-result / 10-page ceiling; a caller wanting more must window finer.
 */

/**
 * The "hits dropped for a missing core field" warning (empty when none dropped). Pure.
 *
 * @param dropped how many search hits lacked a core field
 * @returns the warning lines, or empty when nothing was dropped — silence means nothing was lost
 */
export function searchDropWarnings({ dropped }: { dropped: number }): readonly string[] {
  return dropped > 0
    ? [`skipped ${String(dropped)} GitHub search hit(s) missing a core field (number/title/url/timestamp)`]
    : [];
}

/**
 * The "this window hit the search ceiling" warning (empty when the window was exhausted). Pure.
 *
 * GitHub's issue search stops at 1000 results however many exist, so a window wider than that returns its
 * first 1000 and says nothing about the rest. The module docstring has always told a caller to window
 * finer; what it could not do is tell them WHICH window needed it, because a truncated window and an
 * exhausted one both came back as a clean count. That distinction is decidable at the exact moment the loop
 * ends — a run that stopped because it reached the cap, on a page that was FULL, left results behind — and
 * it is the property a whole-history refetch rests on: a repo with 3,000 pull requests refetched in one
 * window silently captures the most recent 1000 of them.
 *
 * @param truncated whether paging stopped at the cap with a full page still coming
 * @param cap the result ceiling the window ran into
 * @returns a one-element warning list, or an empty one when the window was exhausted
 */
export function searchCapWarnings({ truncated, cap }: { truncated: boolean; cap: number }): readonly string[] {
  if (!truncated) {
    return [];
  }
  return [
    `window hit GitHub's ${String(cap)}-result search ceiling — items beyond it were NOT fetched; split the window (--since/--until) and run again`,
  ];
}

/**
 * The "items shipped without their activity" warning (empty when every item enriched). Pure.
 *
 * Enrichment failing is not fatal — one bad item must never sink a refresh — but it used to be SILENT, and
 * silence is indistinguishable from a query the whole population rejects. A selection set naming one field
 * GitHub does not have fails EVERY item identically, and the run still writes a bare atom per item and
 * reports a clean number. This line is what makes that visible in the second it happens rather than in a
 * corpus audit weeks later.
 *
 * @param failed how many items could not be enriched
 * @param total how many items the window discovered
 * @param firstError the first failure's message, so the cause is in the line and not only the count
 * @returns a one-element warning list, or an empty one when nothing failed
 */
export function enrichFailureWarnings({
  failed,
  total,
  firstError,
}: {
  failed: number;
  total: number;
  firstError: string | undefined;
}): readonly string[] {
  if (failed === 0) {
    return [];
  }
  const cause = firstError !== undefined && firstError.length > 0 ? ` — first: ${firstError}` : "";
  return [
    `${String(failed)} of ${String(total)} item(s) shipped WITHOUT activity (no reviews, comments or state)${cause}`,
  ];
}
