/**
 * How a Clerk path becomes an API, a wire path and a provider key.
 *
 * Every function here is pure and total over a path template, so the whole naming layer is testable without
 * the four documents it is normally fed. Nothing here invents a name: the API is decided by the document
 * that declared it and by Clerk's own path prefix, and the provider key is the method and the wire path
 * exactly as they go over the network.
 *
 * ## The key is the WIRE path, and that is the only reason the two channels can be compared at all
 *
 * A document writes a path relative to its own `servers[0]`, and the browser sees the whole path. So
 * `GET /users` in the Backend API document and `GET /v1/users` in a captured response are the same
 * operation written twice, and a comparator keying on the declared path alone would report every Backend
 * API operation as "declared only" and every dashboard call as undocumented. `docs/atlas-intent/04-corroboration.md`
 * carries the Linear atlas's version of this mistake: its first run reported disagreements that were the
 * comparison rather than the platform. The fix there and here is the same — match on what the provider
 * itself put on the wire.
 *
 * ## The API, not the host, is the second half of the key
 *
 * Clerk serves two of its documented APIs from ONE host and splits them by path prefix, and serves the
 * Frontend API from a host a document can only write as `{domain}.clerk.accounts.dev` — while the
 * dashboard's own Frontend API is reached at a production custom domain instead. Keying on the host would
 * therefore split one API across two keys and merge two APIs into one. {@link clerkApiForHost} is that
 * judgement written down in one place, and the host it decided from is stored on the browser detail so a
 * reader can check the call rather than trust the mapping.
 */
import { CLERK_APIS, type ClerkApi } from "./model.js";

/**
 * The registrable domain Clerk's own product surfaces sit under.
 *
 * @internal
 */
export const CLERK_DOMAIN = "clerk.com";

/**
 * The second domain Clerk serves first-party traffic from: every development instance's Frontend API is
 * `<slug>.clerk.accounts.dev`, and that is the host the Frontend API document writes as its server template.
 *
 * Two registrable domains rather than one, stated as a constant so the departure is visible: a first-party
 * test that named only `clerk.com` would have dropped every development Frontend API call a walk sees,
 * which is most of what the Frontend API surface is on a non-production instance. `accounts.dev` is Clerk's
 * own and is never a customer's.
 *
 * @internal
 */
export const CLERK_ACCOUNTS_DOMAIN = "accounts.dev";

/**
 * The host the Backend API and the beta Platform API are both served from.
 *
 * @internal
 */
export const CLERK_API_HOST = "api.clerk.com";

/**
 * The host the dashboard's own, undocumented API is served from.
 *
 * No pinned document declares it, which is the finding rather than an omission — see `disagreement.ts`.
 *
 * @internal
 */
export const CLERK_DASHBOARD_API_HOST = "dapi.clerk.com";

/**
 * The suffix every Frontend API development host carries, which is also what the Frontend API document
 * writes as its server template.
 *
 * @internal
 */
export const CLERK_FAPI_DEV_SUFFIX = ".clerk.accounts.dev";

/**
 * The host prefix a production Frontend API custom domain carries.
 *
 * Clerk fronts every application's Frontend API at `clerk.<the application's own domain>`, and the
 * dashboard's own is `clerk.clerk.com`. Matching the leading label is what lets a captured
 * `clerk.clerk.com/v1/environment` fold onto the Frontend API operation the document declares at
 * `/v1/environment`, rather than becoming a fifth API nobody can account for.
 *
 * @internal
 */
export const CLERK_FAPI_HOST_PREFIX = "clerk.";

/**
 * The path prefix that separates the beta Platform API from the Backend API on their shared host.
 *
 * MEASURED against the pinned documents: the two share a server URL and their path sets intersect in
 * exactly ZERO operations, because every Platform API path begins with this segment. So the split is the
 * vendor's own rather than a heuristic — reproduce with `slopweaver atlas clerk sync --json`, whose census
 * fails if the two ever collide.
 *
 * @internal
 */
export const CLERK_PLATFORM_PATH_PREFIX = "/v1/platform/";

/**
 * The wire path one declared path sits at: the document's own server prefix, plus the path.
 *
 * @param serverPath the path component of the document's `servers[0].url`, e.g. `/v1`, or `""` when it has
 *   none — the Frontend API document's server is a bare host, so its own paths already carry `/v1`
 * @param declaredPath the document's own path key
 * @returns the absolute path the request goes to
 */
export function clerkWirePath({ serverPath, declaredPath }: { serverPath: string; declaredPath: string }): string {
  const prefix = serverPath.replace(/\/+$/, "");
  return `${prefix}${declaredPath}`;
}

/**
 * The path component of a server URL, or `""` when the URL is a bare host or a template this cannot read.
 *
 * A `{template}` in the HOST is fine and expected — the Frontend API's server is one — and the path is
 * still readable from the text after the authority. Written as a text split rather than through `URL`
 * because `new URL("https://{domain}.clerk.accounts.dev")` is not a URL at all.
 *
 * @param serverUrl the document's own `servers[0].url`
 * @returns the path component with no trailing slash, or `""`
 */
export function clerkServerPath({ serverUrl }: { serverUrl: string }): string {
  const withoutScheme = serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  if (slash < 0) {
    return "";
  }
  return withoutScheme.slice(slash).replace(/\/+$/, "");
}

/**
 * The provider's own key for one operation: the method, the API it belongs to, and the wire path.
 *
 * Byte-exact rather than derived, because this is what the channels are matched on. A compiled row and a
 * browser observation of the same endpoint must fold onto one entity, and the only thing both can produce
 * without agreeing on a naming scheme is the triple the request itself carries.
 *
 * @param method the HTTP method
 * @param api which of Clerk's APIs it belongs to
 * @param wirePath the absolute path the request goes to
 * @returns `<METHOD> <api>:<wire path>`
 */
export function clerkProviderId({
  method,
  api,
  wirePath,
}: {
  method: string;
  api: ClerkApi;
  wirePath: string;
}): string {
  return `${method.toUpperCase()} ${api}:${wirePath}`;
}

/**
 * Whether a host is Clerk's own rather than a third party a dashboard page also talks to.
 *
 * A SUFFIX test written to reject `notclerk.com` and `clerk.com.evil.test` alike: a sloppy `includes` here
 * would admit somebody else's telemetry into a first-party surface map. `clerk-telemetry.com` is
 * deliberately NOT first party by this test even though Clerk owns it — the two registrable domains above
 * are the line, and a line drawn by a list of names is a line that goes stale.
 *
 * @param host the hostname to judge
 * @returns whether it is `clerk.com` or `accounts.dev`, or a subdomain of either
 */
export function isFirstPartyClerkHost({ host }: { host: string }): boolean {
  const lower = host.toLowerCase();
  const under = ({ domain }: { domain: string }): boolean => lower === domain || lower.endsWith(`.${domain}`);
  return under({ domain: CLERK_DOMAIN }) || under({ domain: CLERK_ACCOUNTS_DOMAIN });
}

/**
 * Which of Clerk's APIs a captured call belongs to, from the host it went to and the path it asked for.
 *
 * The one place the host-to-API judgement lives. A first-party host this does not recognise becomes
 * `other` rather than a refusal: the walk's job is to record what the client talks to, and a host nobody
 * anticipated is exactly the unknown unknown the browser half exists to surface.
 *
 * @param host the hostname the call went to
 * @param wirePath the absolute path it asked for, which is what separates the two APIs sharing a host
 * @returns the API, or `null` when the host is not Clerk's at all
 */
export function clerkApiForHost({ host, wirePath }: { host: string; wirePath: string }): ClerkApi | null {
  const lower = host.toLowerCase();
  if (!isFirstPartyClerkHost({ host: lower })) {
    return null;
  }
  if (lower === CLERK_DASHBOARD_API_HOST) {
    return "dashboard";
  }
  if (lower === CLERK_API_HOST) {
    return wirePath.startsWith(CLERK_PLATFORM_PATH_PREFIX) ? "platform" : "bapi";
  }
  if (lower.endsWith(CLERK_FAPI_DEV_SUFFIX) || lower.startsWith(CLERK_FAPI_HOST_PREFIX)) {
    return "fapi";
  }
  return "other";
}

/**
 * Whether a name is one of this atlas's APIs, so a stored row can be checked without a cast.
 *
 * A type PREDICATE cannot destructure its subject (TypeScript error TS1230), so this one parameter is
 * positional — the compiler's decision rather than this repository's, and the exemption
 * `.claude/rules/typescript-patterns.md` names for exactly this shape.
 *
 * @param value the candidate name
 * @returns whether it is a declared API
 *
 * @internal
 */
export function isClerkApi(value: string): value is ClerkApi {
  return CLERK_APIS.some((api) => api === value);
}

/**
 * The pagination style one operation declares, read from its parameter names.
 *
 * Clerk pages with `limit` and `offset` on its list endpoints and declares neither on a single-entity read.
 * Recorded because "can this be paged, and how" is the first thing a caller has to know and the last thing
 * a path shape tells them.
 *
 * @param parameterNames every parameter name the operation declares
 * @returns `limit-offset`, `limit-only`, or `none`
 */
export function clerkPaginationOf({ parameterNames }: { parameterNames: readonly string[] }): string {
  const names = new Set(parameterNames);
  if (names.has("limit") && names.has("offset")) {
    return "limit-offset";
  }
  if (names.has("limit")) {
    return "limit-only";
  }
  return "none";
}
