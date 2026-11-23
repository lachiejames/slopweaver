/**
 * Which pages the Jam walk is commissioned to visit, where each hangs off, and the three families it must
 * never open.
 *
 * ## The application lives under `/s/<team>`, and that is the finding this file is shaped around
 *
 * MEASURED by walking the owner's own signed-in Chrome: `jam.dev/` redirects to
 * `jam.dev/s/<teamId>`, and every administrative page hangs off that root — `/settings`,
 * `/settings/account`, `/settings/mcp` and `/recording-links` all rendered under it, while the same paths
 * at the bare origin did not. Everything else on the same origin is the MARKETING site: `/about`,
 * `/pricing`, `/careers`, `/blog/**`, `/docs/**`, `/legal/**` and `/integrations/<slug>` are public pages
 * served to anybody.
 *
 * So the declared list below is written as ROOT-RELATIVE paths and `kit/pageWalk.ts` composes each one
 * against the root it learns from the client — which is also why the root never leaves the walk: it carries
 * this workspace's own team identifier, and the kit already refuses to carry one out for that reason.
 *
 * ## Admission is by PREFIX, not everything-but-a-refusal
 *
 * That is a fact about Jam rather than a preference. An admin application with an origin to itself can
 * safely admit everything-but-a-refusal. Here the marketing site shares the origin, and the
 * first cut of this walk followed the blog's own footer into post after post and author pages before its page cap
 * stopped it.
 *
 * ## Three refusals, and two of them have a side effect behind them
 *
 * A credential page is refused because a screenshot is this atlas's proof and is KEPT, so a page rendering
 * an access token would put a working secret into the generation as an image, where no field-level denial
 * can reach it. `/v/<jamId>` and `/c/<id>` are refused because they render the recording payload this atlas
 * withholds on disclosure AND, on a shared link, may mark the recording seen; `/to/<id>` is the same
 * footing. Every one is computed from the path rather than listed, so a tab Jam ships next month is refused
 * without this repository changing.
 *
 * ## The denominator is the application's own router table, and it is a FLOOR
 *
 * Jam publishes no sitemap for the application — its `jam.dev/sitemap.xml` carries 33 addresses, every one
 * marketing, legal or a template, and none under `/s/`. Neither is the application probeable from outside:
 * every application path answers the same marketing shell with HTTP 404 to an unauthenticated
 * request, so a signed-out prober cannot tell a real route from an invented one. What DOES exist is the
 * application's own nested router table, shipped in the module the signed-out `jam.dev/login` shell loads,
 * and {@link JAM_BROWSER_PAGES} is what was read out of it — a FLOOR, because a route the bundle builds
 * from a variable never appears in it.
 *
 * **And nothing can widen that floor by crawling.** MEASURED across one signed-in walk: most of the
 * application pages that rendered reported ZERO same-origin links, because the settings navigation is
 * built from controls rather than anchors; the dashboard is the one page that renders a real link list,
 * and every one of its links is a marketing address. The atlas says so through a permanently open
 * `web-denominator-is-harvested` gap rather than letting a coverage fraction imply otherwise.
 */

/** The application's origin. Every page the walk visits is this origin plus a root and a path. */
export const JAM_WEB_ORIGIN = "https://jam.dev";

/**
 * The path the whole application hangs off once a root is resolved.
 *
 * Exported because {@link jamRootFromFinalUrl} recognises it and a test asserts the pair agree.
 *
 * @internal
 */
export const JAM_APPLICATION_PREFIX = "/s/";

/**
 * The application's own not-found route, visited as one of the walk's two CONTROLS.
 *
 * Declared like every other page so it is graded by exactly the code every other page is graded by — a
 * control the walk treated differently would not be evidence about the walk.
 */
export const JAM_NOT_FOUND_ROUTE = "/404";

/**
 * A route at the bare origin that CANNOT exist, visited as the walk's second control.
 *
 * ## Why one control was not enough, and it is the sharper half of this design
 *
 * A Codex review found the first cut's check was tautological: it graded the control against ITSELF, which
 * necessarily succeeds, so it established only that `/404` had been photographed and never that `/404` had
 * rendered a not-found. Its counterexample is concrete — Jam starts serving a real page at `/404`, an
 * ordinary declared route starts rendering the actual not-found at a different size, and the walk publishes
 * that route as reached because a boolean it trusted could not fail. That is the class this repository has
 * paid for before: a check that cannot fail reports clean.
 *
 * Two INDEPENDENTLY ADDRESSED routes rendering the same-sized page is evidence; one route compared to itself
 * is not. This path is unlovely so it cannot become a real route by accident. The method is the WorkOS route
 * probe's invented sibling, one platform over.
 *
 * ## It hangs off the ORIGIN, because Jam stopped rendering a not-found under the team root
 *
 * It was first declared under the team root, to exercise the same shell every declared page does. MEASURED
 * in the owner's signed-in Chrome: `jam.dev/s/<team>/zzz-not-a-real-route` now client-redirects to
 * `jam.dev/404` — the DECLARED control's own address — so the invented control settled somewhere it was not
 * asked, was graded unreached, and every resync refused. The same path at the bare origin,
 * `jam.dev/zzz-not-a-real-route`, still renders "No Jam here :(" in place with the address unchanged, so it
 * is addressed there: a second route the application answers with its not-found by itself, rather than one it
 * forwards to the first control. `browserWalk.test.ts` pins why the team-root spelling cannot come back.
 *
 * @internal
 */
export const JAM_INVENTED_ROUTE = "/zzz-not-a-real-route";

/** The bare origin the walk asks first, to learn which team root this session is signed in to. */
export const JAM_ROOT_PROBE_PATH = "/";

/** One page this walk declares. */
export interface JamBrowserPage {
  /** The stable name coverage is graded against, and the only address ever printed. */
  readonly surface: string;
  /** The path under the resolved root, or under the bare origin when {@link rootRelative} is false. */
  readonly path: string;
  /** Whether this page hangs off the team root. Neither not-found control does. */
  readonly rootRelative: boolean;
}

/**
 * Every page this walk declares, read out of the application's own router table.
 *
 * The bundle also declares `/v/:jamId`, `/c/`, `/to/`, `/login`, `/logout` and the OAuth screens, each of
 * which {@link isJamApplicationPath} refuses for its own stated reason, and `/settings/cli` and
 * `/settings/sdk`, which {@link isJamCredentialRevealPath} refuses because a screenshot of either would
 * carry a working token.
 */
export const JAM_BROWSER_PAGES: readonly JamBrowserPage[] = [
  { path: JAM_NOT_FOUND_ROUTE, rootRelative: false, surface: "not-found-control" },
  { path: JAM_INVENTED_ROUTE, rootRelative: false, surface: "not-found-invented" },
  { path: "", rootRelative: true, surface: "overview" },
  { path: "/recording-links", rootRelative: true, surface: "recording-links" },
  { path: "/settings", rootRelative: true, surface: "settings" },
  { path: "/settings/account", rootRelative: true, surface: "settings/account" },
  { path: "/settings/connected-apps", rootRelative: true, surface: "settings/connected-apps" },
  { path: "/settings/integrations", rootRelative: true, surface: "settings/integrations" },
  { path: "/settings/integrations/ai-agents", rootRelative: true, surface: "settings/integrations/ai-agents" },
  { path: "/settings/integrations/helpdesk", rootRelative: true, surface: "settings/integrations/helpdesk" },
  {
    path: "/settings/integrations/issue-trackers",
    rootRelative: true,
    surface: "settings/integrations/issue-trackers",
  },
  { path: "/settings/integrations/webhooks", rootRelative: true, surface: "settings/integrations/webhooks" },
  { path: "/settings/mcp", rootRelative: true, surface: "settings/mcp" },
  { path: "/settings/members", rootRelative: true, surface: "settings/members" },
  { path: "/settings/notifications", rootRelative: true, surface: "settings/notifications" },
  { path: "/settings/recording-links", rootRelative: true, surface: "settings/recording-links" },
  { path: "/settings/subscription", rootRelative: true, surface: "settings/subscription" },
];

/**
 * Path fragments the walk must never open, because opening one renders or mints a credential.
 *
 * Not a privacy nicety: a screenshot is this atlas's proof and is KEPT, so a page displaying an access token
 * would put a working secret into the generation as an IMAGE. `/settings/cli` and `/settings/sdk` are the
 * two Jam ships today and both are caught by fragment rather than by name, because a near-miss here costs a
 * secret rather than a page.
 */
const CREDENTIAL_REVEAL_FRAGMENTS = [
  "token",
  "api-key",
  "apikey",
  "password",
  "secret",
  "recovery",
  "two-factor",
  "2fa",
  "oauth",
  "authorize",
  "/cli",
  "/sdk",
] as const;

/**
 * Path prefixes that render a recording rather than an administrative page.
 *
 * `/v/` is a jam, `/c/` a shared conversation and `/to/` a share redirect. See this file's header: arriving
 * at one both discloses the payload this atlas withholds and may mark the recording seen.
 */
const RECORDING_PATH_PREFIXES = ["/v/", "/c/", "/to/", "/issues/", "/events/"] as const;

/**
 * Path prefixes the application serves to a signed-OUT visitor.
 *
 * MEASURED: `jam.dev/login` answers HTTP 200 with the application shell on its OWN origin, so a
 * sign-out is invisible to an origin comparison — which is why this list exists rather than an origin check
 * alone.
 */
const AUTH_PATH_PREFIXES = ["/login", "/logout", "/goodbye", "/denied", "/authorize", "/oauth"] as const;

/**
 * Whether a path is the application's own sign-in surface rather than an application page.
 *
 * @param path the same-origin path
 * @returns whether it is an authentication page
 */
export function isJamAuthPath({ path }: { path: string }): boolean {
  return AUTH_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  );
}

/**
 * Whether opening a path would render or mint a credential.
 *
 * @param path the same-origin path
 * @returns whether the walk must refuse it
 */
export function isJamCredentialRevealPath({ path }: { path: string }): boolean {
  const lowered = path.toLowerCase();
  return CREDENTIAL_REVEAL_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}

/**
 * Whether a path renders a recording, so that merely opening it discloses a jam's payload.
 *
 * @param path the same-origin path
 * @returns whether the walk must refuse it
 */
export function isJamRecordingPath({ path }: { path: string }): boolean {
  return RECORDING_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Whether a path is an application page this walk may visit at all.
 *
 * The declared list is checked against this rather than trusted, so a page added to it that names a
 * credential tab or a recording fails a test instead of putting a token in a screenshot.
 *
 * @param path the same-origin path, as the walk would address it
 * @returns whether the walk may open it
 */
export function isJamApplicationPath({ path }: { path: string }): boolean {
  if (isJamCredentialRevealPath({ path }) || isJamAuthPath({ path }) || isJamRecordingPath({ path })) {
    return false;
  }
  return (
    path === "/" ||
    path === JAM_NOT_FOUND_ROUTE ||
    path === JAM_INVENTED_ROUTE ||
    path.startsWith(JAM_APPLICATION_PREFIX)
  );
}

/**
 * The team root the client sent the bare origin to, or `null` when it sent it somewhere with no root.
 *
 * The root is `/s/<teamId>` and carries this workspace's own identifier, which is why it is resolved here
 * and never printed: `kit/pageWalk.ts` keeps it inside the walk for exactly this reason.
 *
 * @param finalUrl where the browser settled after asking for the bare origin
 * @returns the root path, or `null`
 */
export function jamRootFromFinalUrl({ finalUrl }: { finalUrl: string }): string | null {
  let settled: URL;
  try {
    settled = new URL(finalUrl);
  } catch {
    return null;
  }
  if (!settled.pathname.startsWith(JAM_APPLICATION_PREFIX)) {
    return null;
  }
  const team = settled.pathname.slice(JAM_APPLICATION_PREFIX.length).split("/")[0];
  // `split` on a non-empty string always yields a first element, so `undefined` is unreachable — but it is
  // narrowed rather than asserted, because a root built from an empty segment would address the bare prefix
  // and every declared page under it would be a rendered not-found.
  return team === undefined || team.length === 0 ? null : `${JAM_APPLICATION_PREFIX}${team}`;
}

/**
 * The absolute URL for one declared page, or `null` when it needs a root there is none of.
 *
 * @param root the team root the walk resolved, or `null` when it found none
 * @param page the declared page
 * @returns the URL to visit, or `null`
 */
export function jamPageUrl({ root, page }: { root: string | null; page: JamBrowserPage }): string | null {
  if (!page.rootRelative) {
    return `${JAM_WEB_ORIGIN}${page.path}`;
  }
  return root === null ? null : `${JAM_WEB_ORIGIN}${root}${page.path}`;
}

/**
 * Hosts whose traffic is Jam's own rather than a third party's.
 *
 * MEASURED on the signed-out application shell: it loads Stripe, Intercom, Sentry, Google Tag
 * Manager and a YouTube embed. Recording those as Jam operations would put another company's endpoints in
 * this atlas's surface map, which is not a tidiness problem: it is the atlas asserting something false about
 * the platform it maps.
 *
 * Matched as a domain suffix rather than an allowlist of exact hosts, because the application legitimately
 * spreads across several of its own subdomains — `api`, `mcp`, `js`, `recorder` and an asset host all
 * appeared in one page load — and enumerating them would be this repository guessing at Jam's own topology.
 */
const FIRST_PARTY_SUFFIX = ".jam.dev";

/**
 * Whether one observed call was made to Jam's own infrastructure.
 *
 * @param origin the call's own origin, e.g. `https://api.jam.dev`
 * @returns whether it belongs in this atlas's surface map
 */
export function isJamFirstPartyOrigin({ origin }: { origin: string }): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "jam.dev" || host.endsWith(FIRST_PARTY_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Which section of the application a declared page sits in, from its own surface name.
 *
 * The app's own structure rather than an invented taxonomy. A section is a reading convenience on a stored
 * row; nothing branches on it.
 *
 * @param surface the declared page's surface name
 * @returns the section name
 */
export function jamWebSectionOf({ surface }: { surface: string }): string {
  const first = surface.split("/").find((segment) => segment.length > 0);
  if (first === undefined) {
    // A surface with no segment at all is the application root, and that is the section's own name.
    return "root";
  }
  return first;
}
