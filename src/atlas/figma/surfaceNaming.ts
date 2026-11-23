/**
 * The vocabulary the generated Figma registry is written in: how an operation pages, what may present a
 * credential to it, and which HTTP methods the document uses.
 *
 * Kept beside the generator's output rather than inside it, for the reason `atlas/datadog/surfaceRow.ts`
 * gives: a generated file nobody reads is a poor place to discover that a field changed meaning.
 *
 * ## Figma pages three different ways, and the shape is the reproduction handle
 *
 * A reader who asks the atlas "how do I walk this" needs the answer that is true for the endpoint they are
 * holding, and on this platform there are three of them. The library-analytics and webhook surfaces page on
 * an opaque `cursor`; the team-library and file-version surfaces page on a `page_size` plus a `before`/`after`
 * pair of numeric ids; the activity log pages by narrowing a `start_time`/`end_time` window under a `limit`.
 * Forty of the 54 operations page not at all, which is itself worth recording — most of this API returns one
 * bounded document and the walking problem is a property of five families.
 *
 * ## `authMethods` is read from the document's own `security`, and it is what a reader cannot guess
 *
 * Figma declares four security schemes and every operation names which of them it accepts. MEASURED on the
 * pinned document: 50 operations accept a personal access token, 50 accept an OAuth2 grant, 44 accept a plan
 * access token, and exactly ONE accepts an organisation-scoped OAuth grant. That last number is the useful
 * one — it says an org-level integration can read the activity log and nothing else — and it is invisible
 * without reading all 54 `security` blocks by hand.
 */

/** How one operation walks a result set larger than one response. */
const FIGMA_PAGING_SHAPES = ["cursor", "page-size-cursor", "time-window-limit", "none"] as const;

/** How one operation walks a result set larger than one response. */
export type FigmaPaging = (typeof FIGMA_PAGING_SHAPES)[number];

/**
 * What may present itself to one operation, read from the document's own `security` requirements.
 *
 * `PersonalAccessToken` and `PlanAccessToken` are both `X-Figma-Token` header keys and are distinguished
 * only by who issued them — a person or a plan admin — which is precisely why the atlas records the
 * document's own names rather than collapsing them to "api key". The distinction decides which operations a
 * held token can reach, and nothing in the request shape reveals it.
 *
 * @internal
 */
export const FIGMA_AUTH_METHODS = ["OAuth2", "OrgOAuth2", "PersonalAccessToken", "PlanAccessToken"] as const;

/** What may present itself to one operation. */
export type FigmaAuthMethod = (typeof FIGMA_AUTH_METHODS)[number];

/**
 * Every HTTP method the pinned document uses. There is no PATCH on this surface.
 *
 * @internal
 */
export const FIGMA_HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

/** One HTTP method. */
export type FigmaHttpMethod = (typeof FIGMA_HTTP_METHODS)[number];

/**
 * Which paging shape an operation's own query parameters describe.
 *
 * Derived from the parameter NAMES the document declares rather than from the path, because two operations
 * under one tag page differently — `getWebhooks` takes a `cursor` while `getWebhookRequests`, one path
 * segment away, takes nothing at all.
 *
 * The order of the checks is load-bearing and not alphabetical: `getAiUsageDaily` declares `cursor` AND
 * `limit`, and it is a cursor walk with a limit on the page, not a window walk. Testing `cursor` first is
 * what makes that come out right.
 *
 * @param queryParams every query parameter name the operation declares, its path item's shared ones included
 * @returns the shape a caller must implement to walk it
 */
export function figmaPagingOf({ queryParams }: { queryParams: readonly string[] }): FigmaPaging {
  const names = new Set(queryParams);
  if (names.has("cursor")) {
    return "cursor";
  }
  if (names.has("page_size")) {
    return "page-size-cursor";
  }
  if (names.has("limit")) {
    return "time-window-limit";
  }
  return "none";
}
