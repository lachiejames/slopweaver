/**
 * The three bounds one Notion capture runs under, as ONE value threaded through the crawl.
 *
 * They exist as a struct rather than as constants because they have to be LIFTABLE without being edited.
 * MEASURED on a catch-up run (`refresh --source notion --no-derive` over a 36h gap, 4h 37m):
 * 1,565 nodes were cut short by our own bounds — 1,324 by the depth cap and 241 by the per-item request
 * budget — and 28.5% of bronze carries `capture: "partial"` as a result. A whole re-pull has to be able to
 * run without them.
 *
 * ## Why lifting them needs a TIME bound to come with it
 *
 * The same run is why an uncapped crawl is not simply "the capped one, slower". It named individual pages
 * that spent the whole 400-request budget and were STILL truncated — one after 23.5 minutes of wall clock,
 * others at 13.3, 13.6 and 13.7 — and there are 241 of that class. Removing the request bound from those
 * pages removes the only thing that ended them, and nothing measured says where they would stop. A run whose
 * upper bound is unknown cannot be scheduled, which is the same property `--if-stale` and the refresh slot
 * exist to protect.
 *
 * So the per-item TIME bound is not a second flavour of the same knob. The request budget bounds the WORK an
 * item may do; the time bound bounds how long it may take to do it, and only the second one survives the
 * first being lifted. {@link liftedCapsAreBounded} is what refuses the combination that has neither.
 */

/** The bounds one Notion crawl reads before every descent and every request. */
export interface NotionCaptureCaps {
  /** How deep the block recursion descends before recording a `depth-cap` skip. */
  readonly maxBlockDepth: number;
  /** How many requests ONE page or row may issue before recording an `item-deadline` skip. */
  readonly itemCallBudget: number;
  /**
   * How long ONE page or row may spend before recording an `item-time-cap` skip, or `undefined` for no time
   * bound at all — the shipped default, since under the default request budget nothing has ever needed one.
   */
  readonly itemTimeBudgetMs: number | undefined;
}

/**
 * The shipped defaults.
 *
 * `maxBlockDepth` 6 and `itemCallBudget` 400 are the values these were as constants, unchanged: this module
 * makes them liftable, never different. 400 is the measured equivalent of the wall-clock bound it replaced —
 * the pre-concurrency crawl achieved roughly 1.4 req/s, so five minutes bought an item about 420 requests,
 * and the items that tripped the old bound trip this one. Counting REQUESTS rather than minutes is what makes
 * the bound invariant to how many items happen to be crawling concurrently: six items sharing one ~3 req/s
 * scheduler each get about a sixth of the slots, so a wall-clock budget would truncate pages that were fine
 * the run before, and scaling the minutes by the concurrency is worse still — an item running while the other
 * slots are idle would then be handed six times the requests, so a pathological page would cost MORE the
 * quieter the crawl was.
 */
export const DEFAULT_NOTION_CAPTURE_CAPS: NotionCaptureCaps = {
  itemCallBudget: 400,
  itemTimeBudgetMs: undefined,
  maxBlockDepth: 6,
};

/**
 * Whether these caps raise either of the two default bounds. Pure.
 *
 * @param caps the caps a run is about to use
 * @returns true when the depth cap or the request budget is above its shipped default
 */
export function capsAreLifted({ caps }: { caps: NotionCaptureCaps }): boolean {
  return (
    caps.maxBlockDepth > DEFAULT_NOTION_CAPTURE_CAPS.maxBlockDepth ||
    caps.itemCallBudget > DEFAULT_NOTION_CAPTURE_CAPS.itemCallBudget
  );
}

/**
 * Whether a lifted run still has an upper bound. Pure.
 *
 * The one invariant this module enforces: raising a bound is fine, raising every bound is not. A crawl with
 * a lifted request budget and no time bound has no measured worst case per item at all, and the catch-up
 * measurement is the reason that is a refusal rather than a warning.
 *
 * @param caps the caps a run is about to use
 * @returns true when the caps are at their defaults, or lifted WITH a per-item time bound
 */
export function liftedCapsAreBounded({ caps }: { caps: NotionCaptureCaps }): boolean {
  return !capsAreLifted({ caps }) || caps.itemTimeBudgetMs !== undefined;
}

/**
 * The note a run reports about the bounds it ran under, so a crawl's output says what it was allowed to do
 * rather than leaving a reader to infer it from the skip counts. Pure.
 *
 * @param caps the caps the run used
 * @returns the one-line note
 */
export function notionCapsNote({ caps }: { caps: NotionCaptureCaps }): string {
  const time =
    caps.itemTimeBudgetMs === undefined
      ? "no per-item time bound"
      : `${(caps.itemTimeBudgetMs / 60_000).toFixed(1)}m per item`;
  const lifted = capsAreLifted({ caps }) ? " (LIFTED above the shipped defaults)" : "";
  return `caps: block depth ${String(caps.maxBlockDepth)}, ${String(caps.itemCallBudget)} requests per item, ${time}${lifted}`;
}
