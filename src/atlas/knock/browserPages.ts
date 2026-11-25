/**
 * Knock's dashboard navigation surface, and the four rules a walk of it must obey.
 *
 * ## The declared list is DERIVED from the application's own route table, not read off a screen
 *
 * This is the one place this atlas differs materially from its siblings, and it is worth stating rather
 * than leaving as an absence. The Clerk and CrowdStrike walks declare a hand-read list of candidate pages,
 * because those consoles publish no manifest of their routes; a page they never thought to list is a page
 * their walks cannot report as missing. Knock's dashboard publishes its complete route table in
 * `_buildManifest.js`, so {@link KNOCK_BROWSER_PAGES} is computed from it — which makes the walk's
 * DENOMINATOR the application's own declaration.
 *
 * Two consequences follow, and both are improvements rather than conveniences. A route Knock adds appears
 * in the denominator on the next regeneration rather than when somebody notices it. And a route the walk
 * cannot reach is reported against a list nobody curated, so a walk's declared-against-reached tally is a
 * claim about the dashboard rather than about whoever wrote the list.
 *
 * ## Four rules decide which of the 154 routes are walked
 *
 * 1. **Only routes whose parameters the session already answers.** `[slug]` is the account and
 *    `[environment]` is the environment, both resolved once from where the dashboard sends the bare origin.
 *    Every other parameter names one of the organisation's own records, and a walk
 *    never pilots a browser to photograph every message ever sent.
 * 2. **Only `account` and `environment` scopes.** The auth routes are reached signed OUT and would
 *    photograph a redirect; the integration routes are OAuth and install callbacks, and visiting
 *    `/slack/install` would START an authorisation flow. This atlas's write policy is `refuse-every-write`,
 *    and the strongest form of that is not addressing a route that does something.
 * 3. **No route is visited more than once.** The engine's duplicate-screenshot check
 *    (`kit/pageWalk.ts`'s `markIndistinguishablePages`) is what catches a client that silently rewrote
 *    every address it was sent to onto the same overview.
 * 4. **The account slug and environment slug are never written down HERE.** A dashboard URL is
 *    `dashboard.knock.app/<account slug>/<environment>/<page>`, and the account slug identifies the
 *    organisation — a private identifier this repository may not carry. It is resolved at walk time, lives
 *    only in the generation under `$SLOPWEAVER_HOME`, and is never quoted into a reason or a report.
 */
import { KNOCK_ROUTES } from "./generated/routes.js";
import { KNOCK_DASHBOARD_ORIGIN } from "./surfaceNaming.js";

/** One dashboard page a walk visits. */
export interface KnockBrowserPage {
  /** The surface name its coverage cell and its entity are reported under — the route pattern itself. */
  readonly surface: string;
  /** Whether this page needs an environment slug as well as the account slug. */
  readonly needsEnvironment: boolean;
  /** Whether any operation this atlas would call reads what this page displays. */
  readonly apiBacked: boolean;
  /** The atlas kind this page displays, or `null` when no kind covers it. What the photograph policy reads. */
  readonly kind: string | null;
}

/**
 * The kinds whose index page renders the organisation's own RECIPIENTS or their delivered messages.
 *
 * A page displaying one of these is reached, recorded and never photographed. A walk photographs settings and admin
 * pages, and never pilots a browser to photograph every message ever sent. A Knock recipient list is a page of real
 * people's names, email addresses and phone numbers, and a delivered message carries the notification's rendered body.
 *
 * The refusal is enforced BEFORE the write rather than by clearing the reference afterwards — see
 * `kit/pageWalk.ts`'s `photographPolicy`, which exists because clearing a reference left the bytes on disk
 * on another atlas while every count read clean.
 * @internal
 */
export const KNOCK_UNPHOTOGRAPHED_KINDS: ReadonlySet<string> = new Set([
  "event-shape",
  "object",
  "preference-set",
  "schedule",
  "subscription",
  "tenant",
  "user",
]);

/**
 * Whether this page's picture may be written at all, and why not when it may not.
 *
 * @param page the declared page about to be visited
 * @returns the refusal, or `null` when the page may be photographed
 */
export function knockPhotographPolicy({
  page,
}: {
  page: KnockBrowserPage;
}): { readonly refusedBecause: string } | null {
  if (page.kind === null || !KNOCK_UNPHOTOGRAPHED_KINDS.has(page.kind)) {
    return null;
  }
  return {
    refusedBecause:
      `this page lists the organisation's own ${page.kind} records, which on Knock are real people and the` +
      " notifications delivered to them, so it is reached and recorded and never photographed",
  };
}

/**
 * Every page a walk declares, derived from the dashboard's own route table.
 *
 * 57 of the 154 declared routes: 31 account-scoped and 26 environment-scoped. See this file's header for
 * the four rules, and `generated/routes.ts` for the table this is filtered from.
 */
export const KNOCK_BROWSER_PAGES: readonly KnockBrowserPage[] = KNOCK_ROUTES.filter(
  (route) => route.walkable && (route.scope === "account" || route.scope === "environment"),
).map((route) => ({
  apiBacked: route.apiBacked,
  kind: route.kind,
  needsEnvironment: route.parameters.includes("environment"),
  surface: route.route,
}));

/**
 * Where the walk asks the dashboard to send it, so the account and environment can be read off the answer.
 * @internal
 */
export const KNOCK_ROOT_PROBE_PATH = "/";

/**
 * Whether the browser settled on a Knock sign-in wall, whatever it was asked for.
 *
 * The dashboard answers a signed-out request with a 200 and its own sign-in client rather than a 401, so a
 * walk that graded on status alone would record every page as reached and photograph the same login form
 * fifty-seven times.
 *
 * @param finalUrl where the browser settled
 * @returns true when this is a sign-in, sign-up or invite wall rather than a dashboard page
 */
export function isKnockSignInUrl({ finalUrl }: { finalUrl: string }): boolean {
  const path = parsePath({ url: finalUrl });
  if (path === null) {
    return false;
  }
  return (
    path === "/login" ||
    path === "/create-account" ||
    path === "/join-account" ||
    path.startsWith("/auth/") ||
    path.startsWith("/signup/")
  );
}

/**
 * The account and environment slugs the dashboard sent the bare origin to.
 *
 * A signed-in dashboard redirects `/` to the account and environment it last showed —
 * `/<account>/<environment>/overview` — so one navigation answers both. A session that last left on a page
 * with no environment answers only the account, which is a real state rather than a failure: the walk then
 * holds the account-scoped pages and records the environment-scoped ones as rootless.
 *
 * @param finalUrl where the dashboard sent the bare origin
 * @returns the two slugs, the environment `null` when the landing carried none, or `null` when the address
 *   names no account at all
 */
export function knockRootFromFinalUrl({
  finalUrl,
}: {
  finalUrl: string;
}): { account: string; environment: string | null } | null {
  const path = parsePath({ url: finalUrl });
  if (path === null || isKnockSignInUrl({ finalUrl })) {
    return null;
  }
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const account = segments[0];
  if (account === undefined || RESERVED_FIRST_SEGMENTS.has(account)) {
    return null;
  }
  const second = segments[1];
  return {
    account,
    environment: second === undefined || RESERVED_SECOND_SEGMENTS.has(second) ? null : second,
  };
}

/**
 * First path segments that are the dashboard's own routes rather than an account slug.
 *
 * Taken from the route table's own non-`[slug]` roots, so a landing on `/login` or `/integrations/…` is not
 * mistaken for an account called `login`.
 */
const RESERVED_FIRST_SEGMENTS = new Set(
  // Every route pattern starts with "/", so splitting always yields a segment at index 1.
  KNOCK_ROUTES.map((route) => route.route.split("/")[1]!).filter(
    (segment) => segment.length > 0 && !segment.startsWith("["),
  ),
);

/**
 * Second path segments that are account-level routes rather than an environment slug.
 *
 * `/{account}/settings` and `/{account}/agents` are account-scoped, so a session that last left on one
 * answers no environment — reading `settings` as an environment slug would send every environment-scoped
 * page to a route that does not exist.
 */
const RESERVED_SECOND_SEGMENTS = new Set(
  KNOCK_ROUTES.flatMap((route) => {
    const segment = route.route.split("/")[2];
    if (segment === undefined || segment.length === 0 || segment.startsWith("[")) {
      return [];
    }
    return route.route.startsWith("/[slug]/") ? [segment] : [];
  }),
);

/**
 * The absolute URL for one declared page.
 *
 * @param root the account and environment the probe resolved, or `null` when it resolved none
 * @param page the declared page
 * @returns the address, or `null` when this page needs a slug there is none of
 */
export function knockPageUrl({
  root,
  page,
}: {
  root: { account: string; environment: string | null } | null;
  page: KnockBrowserPage;
}): string | null {
  if (root === null) {
    return null;
  }
  if (page.needsEnvironment && root.environment === null) {
    return null;
  }
  const onAccount = page.surface.replace("[slug]", root.account);
  if (root.environment === null) {
    // Past the guard above, a null environment means this page needs none, so its route carries no
    // `[environment]` to fill — `needsEnvironment` is read off the route's own parameters.
    return `${KNOCK_DASHBOARD_ORIGIN}${onAccount}`;
  }
  return `${KNOCK_DASHBOARD_ORIGIN}${onAccount.replace("[environment]", root.environment)}`;
}

/**
 * A URL's pathname, with any trailing slash removed so `/x` and `/x/` are the same address.
 *
 * @param url the address to read
 * @returns the trimmed path, `"/"` for the bare origin, or `null` when the URL cannot be read at all
 * @internal
 */
export function parsePath({ url }: { url: string }): string | null {
  try {
    const parsed = new URL(url);
    const trimmed = parsed.pathname.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
  } catch {
    return null;
  }
}
