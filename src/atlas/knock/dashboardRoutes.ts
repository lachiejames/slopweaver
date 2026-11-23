/**
 * The vocabulary the generated Knock dashboard route inventory is written in, and the rule that decides
 * which of its 154 routes a walk can actually visit.
 *
 * ## The inventory needs no credential, because the dashboard hands over its own route table
 *
 * `dashboard.knock.app` is a Next.js client, and every Next.js build publishes `_buildManifest.js` — a map
 * from every ROUTE PATTERN the application has to the chunks that render it. It is served unauthenticated
 * from the same origin as the sign-in page, so the complete page surface is readable by an installation
 * holding no Knock account at all.
 *
 * That is a stronger artifact than the route PROBE the Airtable and Figma atlases use, and worth naming as
 * such: a probe establishes that a path answers, one request at a time, and infers a route table from what
 * did not 404. This is the table itself, declared by the application, including routes the account's own
 * plan would never render. `docs/atlas-intent/06-holdings.md`'s floor — *"we should at least know all the pages that
 * exist"* — is met exactly rather than approximately.
 *
 * The build id moves on every deploy, so the manifest's URL is not stable and the pin records the id it was
 * read at. Drift is an OBSERVATION rather than a gate, for the reason `atlas/twilio/specFetch.ts` gives:
 * refusing the whole sync on a moved id would make the atlas unbuildable the day Knock ships.
 *
 * ## A route is walkable when its only parameters are the two the session already answers
 *
 * `[slug]` is the account and `[environment]` is the environment; both are in the address bar of a
 * signed-in dashboard and both are resolved once at the start of a walk. Every OTHER parameter —
 * `[workflowKey]`, `[id]`, `[collection]`, `[stepId]` — names one of the organisation's own records, and
 * visiting it would need this atlas to hold an identifier it has no credential to enumerate.
 *
 * So an unwalkable route is not dropped: it is inventoried with `walkable: false`, which is the difference
 * between a page nobody looked at and a page whose address depends on data. The owner's own steer is the
 * reason the distinction is kept — settings and admin pages get a screenshot, and *"I wouldn't expect it to
 * go and pilot a browser and get a screenshot of every single message that's ever been sent."*
 */

/**
 * What kind of thing one dashboard route addresses.
 *
 * - `account` — an account-level page: settings, team, billing, service tokens, the agent workspace.
 * - `environment` — a page inside one environment of one account: workflows, guides, recipients, logs.
 * - `auth` — sign-in, sign-up, MFA, SSO and invite acceptance. Reached signed OUT, by design.
 * - `integration` — an OAuth or install callback a third party sends the browser to.
 * - `internal` — the error page, the dev sign-in shim and the client's own catch-all.
 * @internal
 */
export const KNOCK_ROUTE_SCOPES = ["account", "environment", "auth", "integration", "internal"] as const;

/**
 * What kind of thing one dashboard route addresses.
 * @internal
 */
export type KnockRouteScope = (typeof KNOCK_ROUTE_SCOPES)[number];

/**
 * The two route parameters a signed-in session answers on its own.
 *
 * Everything else names one of the organisation's records — see this file's header.
 * @internal
 */
export const KNOCK_SESSION_PARAMETERS: readonly string[] = ["slug", "environment"];

/** One dashboard route, as the closed inventory holds it. */
export interface KnockRouteRow {
  /**
   * Whether any operation in either published document reads the thing this page displays.
   *
   * `false` is the finding this atlas exists to surface, and it is computed rather than asserted: the
   * route's {@link kind} is matched against the operation registry, so a Knock release that publishes an
   * API for a browser-only page flips this without anyone editing a list.
   */
  readonly apiBacked: boolean;
  /**
   * The atlas kind this page displays, or `null` when it displays something no kind covers — which is
   * exactly the browser-only surface. Named as a plain string rather than the kind union so a route may
   * point at a kind the operation registry does not use.
   */
  readonly kind: string | null;
  /** Every `[bracket]` parameter the route pattern declares, in path order. */
  readonly parameters: readonly string[];
  /** The route pattern exactly as `_buildManifest.js` declares it. */
  readonly route: string;
  readonly scope: KnockRouteScope;
  /** Whether a walk can address this page from a signed-in session alone. */
  readonly walkable: boolean;
}

/**
 * Every `[bracket]` parameter one route pattern declares.
 *
 * `[...path]` — Next.js's catch-all — yields `...path`, kept verbatim rather than normalised, because a
 * catch-all is a different thing from a single segment and flattening the two would hide the client's own
 * fallback route inside the ordinary ones.
 *
 * @param route the route pattern
 * @returns the parameter names, in path order
 * @internal
 */
export function knockRouteParameters({ route }: { route: string }): readonly string[] {
  // `match[1]` is non-nullish because the pattern has one capturing group and the match succeeded.
  return [...route.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!);
}

/**
 * Whether a walk can address this route from a signed-in session alone.
 *
 * @param route the route pattern
 * @returns true when every parameter it declares is one the session already answers
 * @internal
 */
export function isKnockWalkableRoute({ route }: { route: string }): boolean {
  return knockRouteParameters({ route }).every((name) => KNOCK_SESSION_PARAMETERS.includes(name));
}

/**
 * Which scope a route belongs to.
 *
 * Decided by shape rather than by a list of names, so a route Knock adds under an existing tree is scoped
 * without a code change and one added under a NEW tree falls to `internal` and is visible in the diff.
 *
 * @param route the route pattern
 * @returns the scope
 * @internal
 */
export function knockRouteScope({ route }: { route: string }): KnockRouteScope {
  if (route.startsWith("/auth/") || KNOCK_AUTH_ROUTES.has(route)) {
    return "auth";
  }
  if (route.startsWith("/integrations/") || route.startsWith("/slack/") || KNOCK_INTEGRATION_ROUTES.has(route)) {
    return "integration";
  }
  if (route.startsWith("/[slug]/[environment]/")) {
    return "environment";
  }
  if (route.startsWith("/[slug]")) {
    return route.includes("/callback/") || route.includes("/slack/") ? "integration" : "account";
  }
  // `/` is the account PICKER — the one account-scoped page whose pattern carries no slug, because it is
  // where a member with more than one account chooses which slug every other route will carry.
  return route === "/" ? "account" : "internal";
}

/**
 * The signed-out routes that do not sit under `/auth/`.
 *
 * A list rather than a rule because there is no shape they share — Knock reached these names over time and
 * the only thing that makes them auth routes is what they DO. The generator asserts each still exists in
 * the manifest, so a renamed one fails the run instead of being silently rescoped to `internal`.
 * @internal
 */
const KNOCK_AUTH_ROUTES: ReadonlySet<string> = new Set([
  "/create-account",
  "/invites/account/[token]",
  "/join-account",
  "/login",
  "/signup/connect",
  "/signup/profile",
]);

/**
 * The integration callbacks that do not sit under `/integrations/`.
 * @internal
 */
const KNOCK_INTEGRATION_ROUTES: ReadonlySet<string> = new Set(["/[slug]/callback/slack", "/[slug]/slack/link"]);
