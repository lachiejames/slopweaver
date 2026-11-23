/**
 * How a JumpCloud collection is walked, and how a walk knows it reached the end.
 *
 * Every decision here is a total function over a response the client already returned, so the whole paging
 * contract is testable without a network call. Three of them exist because getting them wrong produces a
 * generation that is confidently short rather than an error anybody sees.
 *
 * ## Offset paging without a pinned sort silently omits records
 *
 * 289 of this atlas's operations page with `limit`/`skip`. An offset walk over a collection with no
 * declared order is not a walk over a stable sequence: the provider is free to return page 2 from a
 * different ordering than page 1, so a record can be skipped while `totalCount` stays exactly right and no
 * id ever repeats. Neither of the two obvious completeness checks catches it. So `sort=_id` is pinned on
 * every offset walker — `_id` is JumpCloud's own immutable key, so the order is total and stable — and
 * {@link offsetWalkComplete} refuses to call a walk complete when the count came up short even though
 * nothing repeated.
 *
 * ## Directory Insights does not stop offering a cursor
 *
 * The obvious terminal rule — page until `X-Search_after` is absent — never terminates: JumpCloud returns
 * that header on the LAST page too. A 90-day event walk built on it runs forever, so no first generation
 * can exist at all. The real rule is {@link insightsPageIsLast}: a page shorter than the limit it asked for
 * is the last page.
 *
 * ## A collection response has four shapes and only one of them is a list
 *
 * v1 wraps a list as `{ totalCount, results }`; v2 usually returns a bare array with the count in
 * `X-Total-Count`; some v2 operations wrap it as `{ results }`; and a by-id read returns one object. A
 * reader that guessed would read a single system as zero systems, so nothing here guesses: each surface
 * declares its carrier in `responseBoundary.ts`, and a page in any other is refused as drift.
 */
import type { JumpcloudPagination } from "./surfaceNaming.js";

/**
 * How many records a page ASKS for.
 *
 * MEASURED against the live tenancy: `GET /api/v2/systeminsights/certificates` declares a
 * `totalCount` that, at a page size of 100, needs more pages than `MAX_PAGES` allows, while it serves pages
 * larger than 100 records when asked. System Insights tables were abandoned mid-walk for exactly that
 * reason. Reproduce with `slopweaver atlas jumpcloud sync` and read what it refuses.
 *
 * A thousand is what is asked for, not what arrives. Several JumpCloud families cap the limit silently and
 * answer a hundred, which is why the walk measures its own effective page size from the first page rather
 * than assuming it got what it requested — see {@link effectivePageSize}.
 */
export const JUMPCLOUD_PAGE_SIZE = 1000;

/**
 * The smallest limit a walk will step down to before it stops negotiating.
 *
 * A thousand is not universally accepted, and the refusal is a 400 rather than a silent cap — which is the
 * half the note above missed and the reason three of this atlas's most useful families published EMPTY.
 * MEASURED on the live tenancy, one request per row:
 *
 * ```
 * /api/systems?limit=1000        400  request parameter "limit" exceeds maximum value of 100
 * /api/systemusers?limit=1000    400  request parameter "limit" exceeds maximum value of 100
 * /api/v2/policies?limit=1000    400  invalid limit (max 100)
 * /api/v2/groups?limit=1000      400  invalid limit (max 500)
 * /api/v2/systemgroups?limit=1000  400  invalid limit (max 500)
 * /api/v2/usergroups?limit=1000    400  invalid limit (max 500)
 * /api/v2/systeminsights/apps?limit=1000  200
 * ```
 *
 * Every one of those answers 200 at `limit=100`. So the cap is a property of the ENDPOINT — 100, 500 and
 * 1,000 all appear — and no per-spec rule or static table could be right about it. The walk therefore
 * NEGOTIATES: it asks for {@link JUMPCLOUD_PAGE_SIZE}, halves on a refusal, and keeps what the provider
 * accepts. Halving reaches every observed cap in at most four extra calls, once per operation, and this
 * floor is where it stops so a genuinely broken operation falls through to the bare read instead of
 * stepping down forever. Reproduce with one `fetch` per row above.
 * @internal — {@link steppedDownLimit} and this module's own tests are the only readers.
 */
export const JUMPCLOUD_MIN_PAGE_SIZE = 100;

/**
 * The next limit to ask for after the provider refused this one.
 *
 * @param limit the limit that was refused
 * @returns the halved limit, or `null` once the floor is reached and there is nothing left to try
 */
export function steppedDownLimit({ limit }: { limit: number }): number | null {
  if (limit <= JUMPCLOUD_MIN_PAGE_SIZE) {
    return null;
  }
  return Math.max(JUMPCLOUD_MIN_PAGE_SIZE, Math.floor(limit / 2));
}

/**
 * The page size a walk is ACTUALLY getting, taken from the first page rather than from the request.
 *
 * A provider that silently caps `limit` breaks the obvious end-of-walk test. Asking for 1,000, receiving
 * 100 because the family caps there, and reading "shorter than requested" as the end would stop every
 * capped walk after one page while reporting it complete. So the LARGEST page this walk has seen defines
 * the size, and every later page is compared against that.
 *
 * The largest rather than the first, because a first page can be short for a reason that is not a cap. A
 * collection smaller than one page is the ordinary case, and taking its size as the cap would make the very
 * next page look full and keep a finished walk going.
 *
 * @param largestPageRecords the most records any page of this walk has carried
 * @param asked the limit this walk is actually asking for, which a step-down may have lowered
 * @returns the size later pages are judged against, never larger than what was asked for
 */
export function effectivePageSize({
  largestPageRecords,
  asked = JUMPCLOUD_PAGE_SIZE,
}: {
  largestPageRecords: number;
  asked?: number;
}): number {
  return largestPageRecords > 0 && largestPageRecords < asked ? largestPageRecords : asked;
}

/** The sort pinned on every offset walker, so the sequence a walk pages over is total and stable. */
export const JUMPCLOUD_OFFSET_SORT = "_id";

/**

 * How a collection response was shaped, so a caller can tell one record from an empty list.
 * @internal
 */
export type JumpcloudPageShape = "wrapped-results" | "bare-array" | "single-object" | "empty";

/**

 * One page of a collection, as it was actually shaped.
 * @internal
 */
export interface JumpcloudPage {
  /** The records this page carried. A single-object response contributes exactly one. */
  readonly records: readonly unknown[];
  /** The provider's own total, when it reported one in the body or a header. */
  readonly totalCount: number | null;
  readonly shape: JumpcloudPageShape;
}

/**
 * The total a v2 collection states in `X-Total-Count`, its body being a bare array with nowhere else to say it.
 *
 * @param headers the response headers, lowercased
 * @returns the total, or `null` when the provider sent no such header or one that is not a number
 */
export function headerTotal({ headers }: { headers: Readonly<Record<string, string>> }): number | null {
  const header = headers["x-total-count"];
  if (header === undefined) {
    return null;
  }
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The query parameters for one page of a walk.
 *
 * The offset is how many records the walk has ALREADY READ, never a page index times a page size. Those two
 * are the same number only while every page comes back exactly full, and JumpCloud's first page does not:
 * `/api/systems` answers a default page of 100 against a larger declared total with no `limit` sent at all.
 * An index-based offset would then skip past records that were never read.
 *
 * @param pagination the shape this walk is using — the registry's, or the one the provider's own behaviour
 * forced (see {@link forcedPagination})
 * @param alreadyRead how many records the walk has produced so far
 * @param cursor the provider's own cursor, for a token walker
 * @param askLimit the negotiated limit this walk asks for, lowered by a step-down when one was refused
 * @returns the query to send, empty for an operation that is not paged at all
 */
export function pageQuery({
  pagination,
  alreadyRead,
  cursor,
  askLimit = JUMPCLOUD_PAGE_SIZE,
}: {
  pagination: JumpcloudPagination;
  alreadyRead: number;
  cursor: string | null;
  askLimit?: number;
}): Readonly<Record<string, string>> {
  const limit = String(askLimit);
  if (pagination === "limit-skip") {
    return { limit, skip: String(alreadyRead), sort: JUMPCLOUD_OFFSET_SORT };
  }
  if (pagination === "limit-offset") {
    return { limit, offset: String(alreadyRead), sort: JUMPCLOUD_OFFSET_SORT };
  }
  if (pagination === "token") {
    return cursor === null ? { limit } : { limit, pageToken: cursor };
  }
  if (pagination === "limit-only") {
    return { limit };
  }
  return {};
}

/**
 * Whether the provider's own answer forces a walk the registry did not declare.
 *
 * MEASURED against the live tenancy: `GET /api/systems` is generated as `pagination: "none"`,
 * because the pinned specification declares no `limit` or `skip` parameter for it — and it answers 100
 * records under a larger `totalCount`. A walk that believed the registry would publish the first page of
 * devices and call the family complete, which is the confidently-short generation this atlas exists not to produce.
 *
 * So the registry decides what may be CALLED and the provider decides how much there is to read. The
 * disagreement is not swallowed: `readJumpcloudOperation` reports it, because "the specification does not
 * describe how this endpoint pages" is exactly the kind of finding a corroboration report is for.
 *
 * @param declared the pagination the registry recorded
 * @param observed how many records the first page carried
 * @param totalCount the provider's own declared total, or `null` when it declared none
 * @returns the pagination the walk must actually use, or `null` when the registry's was right
 */
export function forcedPagination({
  declared,
  observed,
  totalCount,
}: {
  declared: JumpcloudPagination;
  observed: number;
  totalCount: number | null;
}): JumpcloudPagination | null {
  const unpaged = declared === "none" || declared === "limit-only";
  if (!unpaged || totalCount === null || totalCount <= observed || observed === 0) {
    return null;
  }
  return "limit-skip";
}

/**
 * Whether an offset walk has reached the end of its own sequence, and may be called complete.
 *
 * Three conditions in a deliberate order. Reaching the declared total ends the walk however full the last
 * page was. Otherwise a short page means the provider ran out; and when the provider declared a total and
 * the walk produced fewer than that, the walk is INCOMPLETE even though it saw a short page — which is
 * exactly the shape an unstable order produces, and exactly the shape a naive "short page means done" rule
 * publishes as `synced`.
 *
 * @param pageRecords how many records the last page carried
 * @param observed how many records the whole walk has produced
 * @param totalCount the provider's own declared total, or `null` when it declared none
 * @param pageSize the size this walk is actually getting; omitted takes what a page asks for
 * @returns whether the walk ended, and whether ending it is honest
 */
export function offsetWalkComplete({
  pageRecords,
  observed,
  totalCount,
  pageSize = JUMPCLOUD_PAGE_SIZE,
}: {
  pageRecords: number;
  observed: number;
  totalCount: number | null;
  pageSize?: number;
}): { readonly ended: boolean; readonly complete: boolean; readonly reason: string } {
  // Reaching the provider's own declared total ends the walk FIRST, before the short-page test. A walk that
  // stops on its last full page — every declared record read, the final page exactly full — is finished,
  // and judging it by the page size alone reported every such completed family as incomplete on one live run.
  if (totalCount !== null && observed >= totalCount) {
    return {
      complete: true,
      ended: true,
      reason: `read ${String(observed)} record(s), matching the ${String(totalCount)} the provider declared`,
    };
  }
  const ended = pageRecords < pageSize;
  if (!ended) {
    return { complete: false, ended: false, reason: "a full page came back, so there is more to read" };
  }
  if (totalCount === null) {
    return {
      complete: true,
      ended: true,
      reason: `read ${String(observed)} record(s) to a short page; the provider declared no total, so completeness rests on paging alone`,
    };
  }
  if (observed < totalCount) {
    return {
      complete: false,
      ended: true,
      reason: `paging ended at ${String(observed)} of the ${String(totalCount)} the provider declared — a short page with a shortfall is what an unstable page order produces, so this read is not complete`,
    };
  }
  return {
    complete: true,
    ended: true,
    reason: `read ${String(observed)} record(s), matching the ${String(totalCount)} the provider declared`,
  };
}

/**
 * One numeric response header, as a number that is only finite when the provider actually sent one.
 *
 * @param header the raw header value, absent when the provider sent none
 * @returns the parsed number, or `NaN` when there was nothing to parse
 */
function parsedHeader({ header }: { header: string | undefined }): number {
  return header === undefined ? Number.NaN : Number.parseInt(header, 10);
}

/**
 * Whether a Directory Insights page is the last one.
 *
 * The header this does NOT read is the point: `X-Search_after` is present on the last page too, so a walk
 * that terminated on its absence would never terminate at all.
 *
 * @param headers the response headers, lowercased
 * @param requestedLimit the limit this page asked for, used when the provider echoes none
 * @returns whether the walk has reached the end of the interval
 */
export function insightsPageIsLast({
  headers,
  requestedLimit,
}: {
  headers: Readonly<Record<string, string>>;
  requestedLimit: number;
}): boolean {
  const count = parsedHeader({ header: headers["x-result-count"] });
  const limit = parsedHeader({ header: headers["x-limit"] });
  const effectiveLimit = Number.isFinite(limit) ? limit : requestedLimit;
  if (!Number.isFinite(count)) {
    // No count header at all: the only honest reading is that this page cannot be shown to be full, so the
    // walk stops rather than looping on a header the provider is not sending.
    return true;
  }
  return count < effectiveLimit;
}

/**
 * The opaque cursor Directory Insights offers for the next page.
 *
 * @param headers the response headers, lowercased
 * @returns the cursor, or `null` when the provider offered none
 */
export function insightsCursor({ headers }: { headers: Readonly<Record<string, string>> }): string | null {
  const cursor = headers["x-search_after"];
  return cursor !== undefined && cursor.length > 0 ? cursor : null;
}
