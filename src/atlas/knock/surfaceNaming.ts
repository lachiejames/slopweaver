/**
 * The vocabulary the generated Knock registries are written in: which of Knock's two APIs an operation
 * belongs to, how it pages, and which HTTP methods the documents use.
 *
 * Kept beside the generators' output rather than inside it, for the reason `atlas/datadog/surfaceRow.ts`
 * gives: a generated file nobody reads is a poor place to discover that a field changed meaning.
 *
 * ## Knock pages its two APIs DIFFERENTLY, and that is the sharpest thing in this file
 *
 * MEASURED on the two pinned documents, and reproduce it with
 * `yarn tsx tools/generateKnockSurfaces.ts --verify`:
 *
 * - the **data API** declares `after` / `before` / `page_size` on 16 operations
 * - the **Management API** declares `after` / `before` / `limit` on 18
 *
 * Same vendor, same cursor field names, different name for the page SIZE. A client written against one and
 * pointed at the other still pages correctly and silently takes the server's default size, which is the
 * kind of defect that shows up as a slow job rather than as an error. {@link KNOCK_PAGING_SHAPES} names the
 * two separately rather than calling both `cursor`, because a reader asking this atlas how to walk a
 * collection needs the parameter name and not the family.
 *
 * ## The Management API is ENVIRONMENT-scoped and the data API is not
 *
 * MEASURED the same way: `environment` is a query parameter on 71 of the Management API's 98 operations and
 * `branch` on 52, while the data API declares neither anywhere. The data API's environment is a property of
 * the KEY presented; the Management API's is a property of the REQUEST. That is why one service token can
 * read every environment and one data-API key cannot, and it is recorded per operation rather than asserted
 * here so a reader can check it.
 */

/**
 * Which of Knock's two published APIs an operation belongs to.
 *
 * - `data` — `api.knock.app`, the runtime API a product calls to trigger notifications and read a
 *   recipient's messages. Authenticated by an environment-scoped API key.
 * - `management` — `control.knock.app`, the API the dashboard itself is a client of: workflows, guides,
 *   broadcasts, channels, commits, branches. Authenticated by an account-scoped service token.
 *
 * Two SURFACES of one platform, never two atlases — `kit/contract.ts`'s header is why this is a field
 * rather than a second `platform`.
 */
export const KNOCK_APIS = ["data", "management"] as const;

/** Which of Knock's two published APIs an operation belongs to. */
export type KnockApi = (typeof KNOCK_APIS)[number];

/**
 * How one operation walks a result set larger than one response.
 *
 * - `cursor-page-size` — `after` / `before` / `page_size`. The data API's only paging shape.
 * - `cursor-limit` — `after` / `before` / `limit`. The Management API's only paging shape.
 * - `none` — one bounded response.
 *
 * The two cursor shapes are not interchangeable and are not collapsed into one member: see this file's
 * header. There is deliberately no page-number or offset member — neither document declares a `page`,
 * an `offset` or a `skip` parameter anywhere.
 */
export const KNOCK_PAGING_SHAPES = ["cursor-page-size", "cursor-limit", "none"] as const;

/** How one operation walks a result set larger than one response. */
export type KnockPaging = (typeof KNOCK_PAGING_SHAPES)[number];

/**
 * Every HTTP method the two pinned documents use.
 *
 * `PATCH` is deliberately absent, and the absence is a fact about Knock rather than an oversight: it
 * updates by `PUT` upsert everywhere, on both APIs. The generator refuses a method it cannot name, so a
 * document that starts declaring one fails the run instead of writing an unnamed row.
 */
export const KNOCK_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

/** One HTTP method. */
export type KnockHttpMethod = (typeof KNOCK_HTTP_METHODS)[number];

/**
 * The origin the data API is served from.
 * @internal
 */
export const KNOCK_DATA_API_ORIGIN = "https://api.knock.app";

/**
 * The origin the Management API is served from — the same host the dashboard's own client calls.
 * @internal
 */
export const KNOCK_MANAGEMENT_API_ORIGIN = "https://control.knock.app";

/** The origin the dashboard is served from. */
export const KNOCK_DASHBOARD_ORIGIN = "https://dashboard.knock.app";

/**
 * Which paging shape an operation's own query parameters describe.
 *
 * Derived from what the operation DECLARES rather than from which document it came out of, so a Knock
 * release that harmonised the two would show up as rows changing shape rather than as this function
 * quietly continuing to answer by host.
 *
 * @param queryParams every query parameter name the operation declares, its path item's shared ones included
 * @returns the shape a caller must implement to walk it
 * @internal
 */
export function knockPagingOf({ queryParams }: { queryParams: readonly string[] }): KnockPaging {
  const names = new Set(queryParams);
  if (!names.has("after")) {
    return "none";
  }
  return names.has("page_size") ? "cursor-page-size" : "cursor-limit";
}
