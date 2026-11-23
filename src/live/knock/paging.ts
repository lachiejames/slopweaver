/**
 * How the Knock door follows a cursor-paged list: `page_info.after`, bounded twice and neither silently.
 *
 * `limit` is the caller's: reaching it with a cursor left says so (`moreRemain`). {@link KNOCK_MAX_PAGES} is this
 * door's: a list that would need more pages, or a cursor that repeats, is refused rather than truncated, because a
 * cut delivery list reads exactly like a complete one.
 */
import type { Boundary } from "#lib/boundary.js";
import { boundaryRefusalWords } from "#lib/boundaryWords.js";

import { err, ok, type Result } from "../../lib/result.js";
import { type KnockReadError, KnockReadErrors } from "./errors.js";
import { buildKnockUrl, type KnockGet, type KnockOperation, type KnockQueryKey } from "./transport.js";

/** The largest page this door asks for — Knock's documented default; no larger maximum is published. */
const KNOCK_MAX_PAGE_SIZE = 50;

/** The most pages one list read follows before refusing. */
export const KNOCK_MAX_PAGES = 20;

/** The largest `limit` a list read accepts. */
export const KNOCK_MAX_LIMIT = 1000;

/** A list read's answer: the views, whether the caller's limit cut it short, and how many pages it took. */
export interface KnockList<T> {
  readonly items: readonly T[];
  readonly moreRemain: boolean;
  readonly pages: number;
}

/** A parsed list page: its items and its forward cursor. */
interface ListPage<W> {
  readonly items: readonly W[];
  readonly page_info: { readonly after?: string | null | undefined };
}

/** Which list to read, and how: everything {@link readPaged} sends on every page. */
interface PagedRead<W> {
  readonly get: KnockGet;
  readonly operation: KnockOperation;
  readonly ids: { messageId: string | null; userId: string | null };
  /** The filter pairs, sent on every page. */
  readonly pairs: readonly (readonly [KnockQueryKey, string])[];
  readonly boundary: Boundary<ListPage<W>>;
}

/**
 * Fetch and parse one page.
 *
 * @param read the list and its filters
 * @param pageSize the page size to ask for
 * @param cursor the `after` cursor, or `null` for the first page
 * @returns the parsed page, or why it could not be read
 */
async function fetchPage<W>({
  read,
  pageSize,
  cursor,
}: {
  read: PagedRead<W>;
  pageSize: string;
  cursor: string | null;
}): Promise<Result<ListPage<W>, KnockReadError>> {
  const { get, operation, ids, pairs, boundary } = read;
  const query: (readonly [KnockQueryKey, string])[] = [...pairs, ["page_size", pageSize]];
  if (cursor !== null) {
    query.push(["after", cursor]);
  }
  const url = buildKnockUrl({ request: { ...ids, operation, query } });
  if (url.isErr()) {
    return err(url.error);
  }
  const text = await get({ operation, url: url.value });
  if (text.isErr()) {
    return err(text.error);
  }
  const page = boundary.parseJson({ text: text.value });
  if (page.isErr()) {
    return err(
      KnockReadErrors.responseRefused({
        endpoint: boundary.endpoint,
        why: boundaryRefusalWords({ refusal: page.error }),
      }),
    );
  }
  return ok(page.value);
}

/**
 * A page's forward cursor, or `null` on the last page.
 *
 * @param page the parsed page
 * @returns the cursor to follow next, or `null`
 */
function nextCursor<W>({ page }: { page: ListPage<W> }): string | null {
  const after = page.page_info.after;
  if (after === undefined || after === null || after.length === 0) {
    return null;
  }
  return after;
}

/**
 * Take one page's items up to `limit` and say what the page decides: the list is done, and whether more remain,
 * or the read follows `after`. One item past the limit proves more remain; reaching it with a cursor left proves
 * the same.
 *
 * @param items the views so far, appended to in place
 * @param page the parsed page
 * @param project one wire item to its view
 * @param limit the most items the read returns
 * @returns `done` with `moreRemain`, or the cursor to follow
 */
function absorbPage<W, V>({
  items,
  page,
  project,
  limit,
}: {
  items: V[];
  page: ListPage<W>;
  project: (item: W) => V;
  limit: number;
}): { done: true; moreRemain: boolean } | { done: false; after: string } {
  const room = limit - items.length;
  for (const item of page.items.slice(0, room)) {
    items.push(project(item));
  }
  const after = nextCursor({ page });
  if (page.items.length > room || (after !== null && items.length === limit)) {
    return { done: true, moreRemain: true };
  }
  if (after === null) {
    return { done: true, moreRemain: false };
  }
  return { after, done: false };
}

/**
 * Follow a cursor-paged list to `limit`, refusing a repeated cursor or one past the page ceiling.
 *
 * @param read the list and its filters
 * @param project one wire item to its view
 * @param limit the most items to return, 1..{@link KNOCK_MAX_LIMIT}
 * @returns the views, or why the read stopped
 */
export async function readPaged<W, V>({
  read,
  project,
  limit,
}: {
  read: PagedRead<W>;
  project: (item: W) => V;
  limit: number;
}): Promise<Result<KnockList<V>, KnockReadError>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > KNOCK_MAX_LIMIT) {
    throw new Error(`readPaged: limit ${String(limit)} is outside 1..${String(KNOCK_MAX_LIMIT)}; the parser bounds it`);
  }
  const pageSize = String(Math.min(limit, KNOCK_MAX_PAGE_SIZE));
  const items: V[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 1; pages <= KNOCK_MAX_PAGES; pages += 1) {
    // Annotated: `cursor` feeds the call and is assigned from its result, so inference alone is circular.
    const page: Result<ListPage<W>, KnockReadError> = await fetchPage({ cursor, pageSize, read });
    if (page.isErr()) {
      return err(page.error);
    }
    const step = absorbPage({ items, limit, page: page.value, project });
    if (step.done) {
      return ok({ items, moreRemain: step.moreRemain, pages });
    }
    const after: string = step.after;
    if (seen.has(after)) {
      return err(KnockReadErrors.paginationRefused({ why: "Knock answered a cursor this read already followed" }));
    }
    seen.add(after);
    cursor = after;
  }
  return err(
    KnockReadErrors.paginationRefused({
      why: `the list needs more than ${String(KNOCK_MAX_PAGES)} pages — narrow the window or the filters`,
    }),
  );
}
