/**
 * Sequential cursor-following over one Vanta Manage API surface.
 *
 * Every surface uses the same cursor contract — continue while `results.pageInfo.hasNextPage` is true,
 * follow `endCursor` — so this is written once here rather than once per surface in `client.ts`.
 *
 * Three shapes are refused rather than tolerated, because each one silently produces a wrong answer if
 * treated as data:
 *
 * - `hasNextPage: true` with no cursor to continue from — a pagination fault, not "that was the last page".
 * - A repeated cursor — Vanta's cursor is opaque, so a repeat can only mean the walk is looping.
 * - A duplicate provider id within one surface's read — `merge.ts` downstream assumes every id in a
 *   complete read is unique.
 *
 * An empty final page (`hasNextPage: false`, zero items) is a valid, authoritative zero — not refused.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { VantaPageInfo } from "./apiSchemas.js";
import { type VantaHttpError, VantaHttpErrors, type VantaTransportFailure } from "./httpErrors.js";

/** More pages than any real Vanta surface should ever need. Past this, the walk refuses rather than loops. */
export const VANTA_MAX_PAGES = 500;

/** One page of items plus the cursor metadata to decide whether to continue. */
export interface VantaPage<TItem> {
  readonly items: readonly TItem[];
  readonly pageInfo: VantaPageInfo;
}

/**
 * Fold one page's items into the accumulator, refusing a provider id seen twice within this surface's read.
 *
 * @param items the accumulator every page's items are pushed onto
 * @param seenIds every provider id already accumulated
 * @param pageItems this page's items
 * @param providerId extract one item's stable provider id
 * @returns nothing on success, or the reason a duplicate id was refused
 */
function accumulatePageItems<TItem>({
  items,
  seenIds,
  pageItems,
  providerId,
}: {
  items: TItem[];
  seenIds: Set<string>;
  pageItems: readonly TItem[];
  providerId: (item: TItem) => string;
}): Result<null, VantaHttpError> {
  for (const item of pageItems) {
    const id = providerId(item);
    if (seenIds.has(id)) {
      return err(VantaHttpErrors.duplicateProviderId({ id }));
    }
    seenIds.add(id);
    items.push(item);
  }
  return ok(null);
}

/**
 * The cursor to continue from after one page, refusing the two pagination-fault shapes described above.
 *
 * @param pageInfo the page's own cursor metadata
 * @param seenCursors every cursor already followed this walk
 * @returns the next cursor to fetch, or the reason the walk was refused
 */
function nextPageCursor({
  pageInfo,
  seenCursors,
}: {
  pageInfo: VantaPageInfo;
  seenCursors: Set<string>;
}): Result<string, VantaHttpError> {
  const nextCursor = pageInfo.endCursor;
  if (nextCursor === null || nextCursor === "") {
    return err(VantaHttpErrors.cursorMissing());
  }
  if (seenCursors.has(nextCursor)) {
    return err(VantaHttpErrors.cursorRepeated({ cursor: nextCursor }));
  }
  seenCursors.add(nextCursor);
  return ok(nextCursor);
}

/**
 * Walk every page of one surface, accumulating items and refusing the shapes described above.
 *
 * @param fetchPage fetch one page, given the cursor to continue from (`null` for the first page)
 * @param providerId extract one item's stable provider id, for the duplicate-id refusal
 * @returns every item across every page, or the reason the walk was refused — still typed, so the caller
 *   decides on its `code`; a cursor or id in it can echo a token, so the caller redacts before printing
 */
export async function readVantaPagesSequentially<TItem>({
  fetchPage,
  providerId,
}: {
  fetchPage: (input: { cursor: string | null }) => Promise<Result<VantaPage<TItem>, VantaTransportFailure>>;
  providerId: (item: TItem) => string;
}): Promise<Result<readonly TItem[], VantaTransportFailure>> {
  const items: TItem[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageCount = 1; pageCount <= VANTA_MAX_PAGES; pageCount += 1) {
    const page = await fetchPage({ cursor });
    if (page.isErr()) {
      return err(page.error);
    }
    const accumulated = accumulatePageItems({ items, pageItems: page.value.items, providerId, seenIds });
    if (accumulated.isErr()) {
      return err(accumulated.error);
    }
    if (!page.value.pageInfo.hasNextPage) {
      return ok(items);
    }
    const next = nextPageCursor({ pageInfo: page.value.pageInfo, seenCursors });
    if (next.isErr()) {
      return err(next.error);
    }
    cursor = next.value;
  }
  return err(VantaHttpErrors.pageLimitExceeded({ maxPages: VANTA_MAX_PAGES }));
}
