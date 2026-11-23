/**
 * The cursor-paging loop reimplemented across the Linear and Slack connectors — "fetch a page, accumulate its
 * items, follow `nextCursor`, stop when the cursor stops advancing". A higher-order async combinator: the
 * effectful `fetchPage` seam is injected, so the loop's stop semantics are tested with a plain fake page list
 * (no mocks, no network).
 *
 * **Termination is decided by the CURSOR alone ({@link cursorStep}), never by whether a page happened to add
 * items.** That distinction is the reason this file has a history. The loop used to `break` when a page
 * appended nothing, BEFORE reading that page's `nextCursor` — and Slack documents the opposite shape
 * outright: "Maybe you'll even receive 0 results but still have a `next_cursor` with 4 more waiting in the
 * wings." One condition was standing in for two different facts ("the cursor is not advancing" and "the page
 * was empty"), and only the first justifies stopping, so an ingest lane could return a prefix of a collection
 * and report it as the whole thing.
 *
 * **A walk also says HOW it ended** ({@link CursorWalkEnd}), because the previous signature could not. A bare
 * array makes a prefix and a complete collection the same value, which is the silent-failure shape this repo
 * forbids: the caller cannot tell truncation from exhaustion, so it cannot warn about it. Only `exhausted`
 * means the collection is whole. Callers turn the rest into a warning with {@link cursorWalkWarning}.
 *
 * **The CURSOR-STEP decision never throws** — {@link cursorStep} and {@link walkEndOf} are pure classification
 * with no failure case — but {@link collectCursorPages} itself is not throw-free: it `await`s the injected
 * `fetchPage` with no try/catch, so a rejected page request propagates straight out to the caller. That is
 * deliberate, not an oversight — `src/corpus/slack/fetch.ts`'s `discoverChannels` relies on exactly this to
 * treat a failed page fetch as fatal: its own caller, `discoverSlackWorkspace`, wraps that call in a
 * `try`/`catch` and turns the throw into a typed `err`. This loop cannot swallow a rejection internally
 * without breaking that contract. "Best-effort" describes what happens when a CURSOR stops or repeats, never
 * a hard failure fetching a page — a caller for whom no page failure is fatal must wrap its own call, the
 * same way.
 *
 * Source-specific stop logic (Notion's `since` cutoff) stays at the call-site: the adapter returns
 * `nextCursor: undefined` when it wants to stop, and this loop just honours that. Notion does not currently
 * call this helper — it pages with its own cursor-only loops, which were always the correct shape.
 */

/** One page from a cursor-paged endpoint: its items plus the cursor for the next page (absent ⇒ last). */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
  /**
   * The endpoint's own "there is more after this page" flag, when it has one, carried SEPARATELY from
   * `nextCursor` because the two can disagree. A Relay connection reporting `hasNextPage: true` with a null
   * `endCursor` is the shape that matters: without this flag it arrives as an absent cursor and reads as
   * exhaustion, so the walk would call a known-short read complete. Omit it when the endpoint offers no such
   * signal — then an absent cursor is all there is to go on, and it means exhausted.
   */
  readonly hasMore?: boolean;
}

/**
 * What a page's `nextCursor` says about continuing. `advance` carries the cursor to request next; `exhausted`
 * means the endpoint said there is no more; `stuck` means the cursor did not move — it repeats one already
 * requested — which is the only shape that would otherwise spin forever.
 */
export type CursorStep =
  | { readonly kind: "advance"; readonly cursor: string }
  | { readonly kind: "exhausted" }
  | { readonly kind: "stuck"; readonly cursor: string };

/**
 * How a completed walk ended. `exhausted` is the ONLY outcome that means the collection is whole; `capped` is
 * a short read the caller asked for; `stuck` and `ceiling` are truncation the caller did not ask for and
 * should report.
 */
export type CursorWalkEnd =
  | { readonly kind: "exhausted" }
  | { readonly kind: "capped"; readonly maxItems: number }
  | { readonly kind: "stuck"; readonly cursor: string }
  | { readonly kind: "ceiling"; readonly pages: number }
  /**
   * The endpoint said there is another page and gave no cursor to reach it. Cursor logic cannot continue —
   * there is nothing to advance to — so this is the one incomplete ending a walk cannot even attempt to fix.
   * It exists so that ending is REPORTED rather than returned as a prefix nobody can distinguish, which is
   * what a Relay connection with `hasNextPage: true` and a null `endCursor` used to do.
   */
  | { readonly kind: "no-cursor" };

/**
 * A backstop page ceiling. It is NOT the cycle guard — a repeated cursor is caught on its first repeat by
 * {@link cursorStep} — so the only shape left for it to catch is an endpoint issuing an unbounded stream of
 * DISTINCT cursors. That shape cannot be bounded by a per-lane item cap either, because an empty page consumes
 * no item budget.
 *
 * 5,000 pages is far above any lane measured here (the largest page size in the repo is 250 and the smallest
 * is 15, so this is 75,000 items in a single lane at the worst page size — reproduce with
 * `grep -rn "PAGE_SIZE = " src --include="*.ts"`), and it can be this low precisely BECAUSE hitting it is
 * reported rather than silent: truncation that announces itself cannot masquerade as completeness, which is
 * what made the previous ceiling-less loop dangerous.
 */
const MAX_CURSOR_PAGES = 5_000;

/**
 * Refuse a page ceiling that would not bound anything. `pages >= maxPages` is FALSE for `NaN` and for a
 * negative ceiling, so either would silently disable the one backstop against an endpoint that issues
 * endlessly distinct cursors — the failure this whole module exists to prevent, reintroduced through its own
 * guard. This throws rather than substituting a default because a caller passing a non-integer ceiling has a
 * bug, and quietly correcting it is how the bug survives.
 *
 * @param maxPages the ceiling a caller supplied
 * @returns the same ceiling, once it is known to bound the walk
 */
function checkedCeiling({ maxPages }: { maxPages: number }): number {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    // SAFE integer, not merely integer: past 2^53 `pages += 1` stops advancing, so a larger ceiling would be
    // accepted while bounding nothing — which is the sentence above being false rather than merely imprecise.
    throw new TypeError(`paging: maxPages must be a positive safe integer, got ${String(maxPages)}`);
  }
  return maxPages;
}

/**
 * The items still allowed under an optional per-lane fetch cap. `undefined` maxItems ⇒ uncapped (returns
 * `undefined`, so a caller omits any page-size hint and the seam uses its own default). Otherwise the
 * non-negative remainder — a bespoke paging loop stops when this hits 0 and requests only this many. Pure.
 *
 * @param collected how many items are already collected
 * @param maxItems the cap (undefined ⇒ uncapped)
 * @returns the remaining budget, or `undefined` when uncapped
 */
export function remainingBudget({
  collected,
  maxItems,
}: {
  collected: number;
  maxItems: number | undefined;
}): number | undefined {
  return maxItems === undefined ? undefined : Math.max(0, maxItems - collected);
}

/**
 * Whether a per-lane item cap has been reached. Pure. Separate from {@link remainingBudget} because the two
 * answer different questions — that one sizes the NEXT request, this one decides whether there should be one.
 *
 * @param collected how many items are already collected
 * @param maxItems the cap (undefined ⇒ uncapped, so never reached)
 * @returns true when the cap is met or exceeded
 */
export function capReached({ collected, maxItems }: { collected: number; maxItems: number | undefined }): boolean {
  return maxItems !== undefined && collected >= maxItems;
}

/**
 * Classify a page's next cursor. Pure, and deliberately the ONLY place a walk's stop decision lives, so
 * "the page was empty" cannot leak back in as a stop reason: a page that added nothing but moved the cursor
 * is an `advance`. The five bespoke connector loops call this too, so "stuck" has one definition rather than
 * six.
 *
 * `stuck` covers the re-served-page case the integration lane produces — under its lenient
 * method+path replay the same page comes back carrying the cursor that was just used — and it catches that
 * whether or not the replayed page has items, which the old `items.length === before` guard did not.
 *
 * @param next the `nextCursor` the page carried
 * @param seen every cursor already requested in this walk, including the one that fetched this page
 * @returns the step to take
 */
export function cursorStep({ next, seen }: { next: string | undefined; seen: ReadonlySet<string> }): CursorStep {
  if (next === undefined || next.length === 0) {
    return { kind: "exhausted" };
  }
  if (seen.has(next)) {
    return { cursor: next, kind: "stuck" };
  }
  return { cursor: next, kind: "advance" };
}

/**
 * The warning an incomplete walk deserves, or `undefined` when the walk needs none. `exhausted` is complete
 * and `capped` is a short read the caller asked for, so neither warns; `stuck` and `ceiling` are truncation
 * nobody asked for. One place for the wording, so six loops report incompleteness the same way.
 *
 * @param end how the walk ended
 * @param lane a human label for the lane being paged, used to open the message
 * @returns the warning line, or `undefined` when the walk was complete or deliberately capped
 */
export function cursorWalkWarning({ end, lane }: { end: CursorWalkEnd; lane: string }): string | undefined {
  switch (end.kind) {
    case "exhausted":
    case "capped":
      return undefined;
    case "stuck":
      return `${lane} may be incomplete: the endpoint repeated pagination cursor ${end.cursor} instead of advancing`;
    case "ceiling":
      return `${lane} may be incomplete: stopped at the ${String(end.pages)}-page ceiling with the cursor still advancing`;
    case "no-cursor":
      return `${lane} is incomplete: the endpoint reported another page but gave no cursor to reach it`;
  }
}

/**
 * The walk end a non-advancing step implies. The parameter type EXCLUDES `advance` rather than handling it,
 * because "the cursor advanced" is not an ending and a runtime branch for it could only ever be dead code or a
 * lie.
 *
 * @param step the step that ended the walk — `exhausted` or `stuck`
 * @returns the matching walk end
 */
function cursorEndOf({ step }: { step: Exclude<CursorStep, { kind: "advance" }> }): CursorWalkEnd {
  return step.kind === "stuck" ? { cursor: step.cursor, kind: "stuck" } : { kind: "exhausted" };
}

/**
 * Append {@link cursorWalkWarning}'s line to a lane's running warning list when the walk was incomplete, and
 * do nothing when it was not. The connectors' house idiom is a `warnings: string[]` mutated in place — a lane
 * problem warns rather than aborting — so this is the one-line call every paging site makes.
 *
 * @param end how the walk ended
 * @param lane a human label for the lane being paged
 * @param warnings the running warning list, MUTATED in place
 */
export function pushCursorWarning({
  end,
  lane,
  warnings,
}: {
  end: CursorWalkEnd;
  lane: string;
  warnings: string[];
}): void {
  const warning = cursorWalkWarning({ end, lane });
  if (warning !== undefined) {
    warnings.push(warning);
  }
}

/**
 * Open the next page of a hand-written cursor walk, or refuse to. ONE call answers every question that is not
 * specific to the lane: is the caller's item cap already met, has the page ceiling been reached, how big should
 * this request be, and which cursor must be remembered so a later repeat of it reads as `stuck`.
 *
 * It is one call rather than four because five connector loops cannot use {@link collectCursorPages} — one polls
 * threads per page, one dedupes by key, the rest interleave progress heartbeats — yet all five need exactly this
 * bookkeeping, and five inlined copies of it is how the defect this module was rewritten for came to have six
 * homes. Checking the cap HERE, before the fetch, also settles a precedence question by construction: a walk the
 * caller bounded never reaches {@link advanceOrWarn}, so it cannot warn about a truncation it was asked for.
 *
 * @param cursor the cursor about to be requested (undefined ⇒ first page, nothing to remember)
 * @param pages how many pages this walk has already fetched
 * @param seen the walk's requested-cursor set, MUTATED in place
 * @param lane a human label for the lane being paged
 * @param warnings the lane's running warning list, MUTATED in place
 * @param collected how many items the walk holds
 * @param maxItems the per-lane item cap, when there is one
 * @param maxPages the backstop page ceiling (defaults to {@link MAX_CURSOR_PAGES})
 * @returns the size to request, or `undefined` to stop the walk
 */
export function openCursorPage({
  cursor,
  pages,
  seen,
  lane,
  warnings,
  collected,
  maxItems,
  maxPages = MAX_CURSOR_PAGES,
}: {
  cursor: string | undefined;
  pages: number;
  seen: Set<string>;
  lane: string;
  warnings: string[];
  collected: number;
  maxItems: number | undefined;
  maxPages?: number;
}): { pageSize: number | undefined } | undefined {
  if (capReached({ collected, maxItems })) {
    return undefined;
  }
  if (pages >= checkedCeiling({ maxPages })) {
    pushCursorWarning({ end: { kind: "ceiling", pages }, lane, warnings });
    return undefined;
  }
  if (cursor !== undefined && cursor.length > 0) {
    seen.add(cursor);
  }
  return { pageSize: remainingBudget({ collected, maxItems }) };
}

/**
 * The cursor to request next, or `undefined` when the walk is over — warning first if it ended incompletely.
 * The counterpart to {@link openCursorPage} for the same five loops.
 *
 * @param next the `nextCursor` the page just fetched carried
 * @param seen the walk's requested-cursor set
 * @param lane a human label for the lane being paged
 * @param warnings the lane's running warning list, MUTATED in place
 * @returns the next cursor, or `undefined` to stop
 */
export function advanceOrWarn({
  next,
  seen,
  lane,
  warnings,
}: {
  next: string | undefined;
  seen: ReadonlySet<string>;
  lane: string;
  warnings: string[];
}): string | undefined {
  const step = cursorStep({ next, seen });
  if (step.kind === "advance") {
    return step.cursor;
  }
  pushCursorWarning({ end: cursorEndOf({ step }), lane, warnings });
  return undefined;
}

/**
 * The ending a stopped walk actually has, in precedence order. Pure.
 *
 * Exhaustion outranks everything: if the endpoint ran out and never claimed otherwise, the collection is whole.
 * Otherwise a met cap outranks `stuck`, `ceiling` and `no-cursor`, because the caller asked for a short read and
 * does not need warning about the truncation they requested. This is also what keeps the shared loop and the five
 * hand-written ones classifying the same walk identically.
 *
 * @param step the non-advancing step that stopped the walk
 * @param page the page just fetched, for its own `hasMore` claim
 * @param collected how many items the walk holds
 * @param maxItems the per-lane cap, when there is one
 * @returns the walk's ending
 */
function walkEndOf<T>({
  step,
  page,
  collected,
  maxItems,
}: {
  step: Exclude<CursorStep, { kind: "advance" }>;
  page: CursorPage<T>;
  collected: number;
  maxItems: number | undefined;
}): CursorWalkEnd {
  const base: CursorWalkEnd =
    step.kind === "exhausted" && page.hasMore === true ? { kind: "no-cursor" } : cursorEndOf({ step });
  if (base.kind !== "exhausted" && maxItems !== undefined && capReached({ collected, maxItems })) {
    return { kind: "capped", maxItems };
  }
  return base;
}

/**
 * Apply the item cap to a finished walk. Pure, and separate from the loop for a reason beyond tidiness: the
 * trim can itself drop items from an otherwise-exhausted walk, and that has to change the reported ending or
 * the result is a prefix calling itself complete.
 *
 * @param items every item collected, before the cap
 * @param maxItems the cap (undefined ⇒ uncapped, nothing to do)
 * @param end how the walk itself ended
 * @returns the capped items and the ending that is true of them
 */
function trimToCap<T>({
  items,
  maxItems,
  end,
}: {
  items: readonly T[];
  maxItems: number | undefined;
  end: CursorWalkEnd;
}): { items: readonly T[]; end: CursorWalkEnd } {
  if (maxItems === undefined) {
    return { end, items };
  }
  const kept = items.slice(0, maxItems);
  return { end: kept.length < items.length ? { kind: "capped", maxItems } : end, items: kept };
}

/**
 * Walk every page from `firstCursor` onward, concatenating items in page order, and report how the walk
 * ended. Stops when the cursor stops advancing — absent or empty (`exhausted`), or repeating one already
 * requested (`stuck`). **A page that returns ZERO items does not stop the walk**: if its cursor moved, the
 * walk follows it (see {@link cursorStep}).
 *
 * When `maxItems` is set (the per-lane fetch cap), the loop stops as soon as that many items are collected AND
 * passes a `pageSize` = the remaining budget to `fetchPage`, so the underlying request asks for only what's
 * needed (a capped run makes fewer + smaller calls, not one full-size call it then slices). A page that
 * overshoots is trimmed to exactly `maxItems`. Absent ⇒ unbounded, `pageSize` undefined (the seam uses its own
 * default).
 *
 * A page whose forward pointer is `stuck` still contributes its items: it came back from a real cursor, and
 * only `nextCursor` is non-advancing. Discarding it would be data loss whenever an endpoint legitimately
 * repeats a cursor.
 *
 * A page that reports `hasMore` with no cursor ends the walk as `no-cursor` rather than `exhausted`: the
 * endpoint has said there is more and given nothing to ask with, which is incomplete rather than finished.
 *
 * @param fetchPage the effectful page fetch (`cursor` undefined ⇒ first page; `pageSize` undefined ⇒ default)
 * @param firstCursor the cursor to start from (defaults to `undefined` ⇒ first page); primed into the seen set
 *   when non-empty, so a return-to-seed cycle is caught without fetching the seed twice
 * @param maxItems the optional per-lane cap on total items collected
 * @param maxPages the backstop page ceiling (defaults to {@link MAX_CURSOR_PAGES})
 * @returns every item across all pages in order, at most `maxItems`, plus how the walk ended
 */
export async function collectCursorPages<T>({
  fetchPage,
  firstCursor = undefined,
  maxItems = undefined,
  maxPages = MAX_CURSOR_PAGES,
}: {
  fetchPage: (args: { cursor: string | undefined; pageSize: number | undefined }) => Promise<CursorPage<T>>;
  firstCursor?: string | undefined;
  maxItems?: number | undefined;
  maxPages?: number;
}): Promise<{ items: readonly T[]; end: CursorWalkEnd }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor = firstCursor;
  let pages = 0;
  let end: CursorWalkEnd = { kind: "exhausted" };
  for (;;) {
    const remaining = remainingBudget({ collected: items.length, maxItems });
    if (remaining !== undefined && remaining <= 0 && maxItems !== undefined) {
      end = { kind: "capped", maxItems };
      break;
    }
    if (pages >= checkedCeiling({ maxPages })) {
      end = { kind: "ceiling", pages };
      break;
    }
    if (cursor !== undefined && cursor.length > 0) {
      seen.add(cursor);
    }
    const page = await fetchPage({ cursor, pageSize: remaining });
    pages += 1;
    items.push(...page.items);
    const step = cursorStep({ next: page.nextCursor, seen });
    if (step.kind !== "advance") {
      end = walkEndOf({ collected: items.length, maxItems, page, step });
      break;
    }
    cursor = step.cursor;
  }
  return trimToCap({ end, items, maxItems });
}
