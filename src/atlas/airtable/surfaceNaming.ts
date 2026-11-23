/**
 * The vocabulary the generated Airtable registry is written in: how an operation pages, what may present a
 * credential to it, and which atlas kind it feeds.
 *
 * Kept beside the generator's output rather than inside it, for the reason `atlas/datadog/surfaceRow.ts`
 * gives: a generated file nobody reads is a poor place to discover that a field changed meaning.
 *
 * ## Airtable pages four different ways, and the shape is the reproduction handle
 *
 * Datadog's registry can say `cursor` or `none` and be done. Airtable cannot: its own REST surface pages on
 * an opaque `offset`, its webhook payload stream pages on `cursor`+`limit`, its audit-log event feed pages
 * on a `previous`/`next` PAIR, and its SCIM surface pages the way SCIM says to — `startIndex` and `count`,
 * one-based. Four shapes across one platform is not a quirk to normalise away; a reader who asks the atlas
 * "how do I walk this" needs the answer that is true for the endpoint they are holding.
 *
 * ## `authMethods` is Airtable's own annotation, and it is the one thing an atlas reader cannot guess
 *
 * The specification carries `x-airtable-auth-methods` per operation. MEASURED on the pinned document: all
 * 103 operations accept a personal access token, 99 accept an OAuth access token, and 64 still accept the
 * deprecated user API key. That third number is the interesting one — it says which surface a legacy
 * integration could still be reaching, which is a security question the atlas can answer for free.
 */

/** How one operation walks a result set larger than one response. */
const AIRTABLE_PAGING_SHAPES = ["offset", "cursor-limit", "previous-next", "scim-start-index", "none"] as const;

/** How one operation walks a result set larger than one response. */
export type AirtablePaging = (typeof AIRTABLE_PAGING_SHAPES)[number];

/**
 * What may present itself to one operation, read from the specification's `x-airtable-auth-methods`.
 *
 * `userApiKey` is Airtable's deprecated legacy key. It stays in the vocabulary because the atlas's job is
 * to say what the platform accepts, not what it recommends — and an endpoint a legacy key can still reach
 * is exactly the kind of thing a reader wants enumerated.
 *
 * @internal
 */
export const AIRTABLE_AUTH_METHODS = ["personalAccessToken", "oauthAccessToken", "userApiKey"] as const;

/** What may present itself to one operation. */
export type AirtableAuthMethod = (typeof AIRTABLE_AUTH_METHODS)[number];

/**
 * Every HTTP method the pinned specification uses.
 *
 * @internal
 */
export const AIRTABLE_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One HTTP method. */
export type AirtableHttpMethod = (typeof AIRTABLE_HTTP_METHODS)[number];

/**
 * Which paging shape an operation's own query parameters describe.
 *
 * Derived from the parameter NAMES the specification declares rather than from the path, because two
 * endpoints under one tag page differently — `list-audit-log-requests` takes `offset` while
 * `audit-log-events`, one path segment away, takes the `previous`/`next` pair.
 *
 * @param queryParams every query parameter name the operation declares
 * @returns the shape a caller must implement to walk it
 */
export function airtablePagingOf({ queryParams }: { queryParams: readonly string[] }): AirtablePaging {
  const names = new Set(queryParams);
  if (names.has("previous") && names.has("next")) {
    return "previous-next";
  }
  if (names.has("cursor")) {
    return "cursor-limit";
  }
  if (names.has("startIndex") || (names.has("count") && names.has("filter"))) {
    return "scim-start-index";
  }
  if (names.has("offset")) {
    return "offset";
  }
  return "none";
}
