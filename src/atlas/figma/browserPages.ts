/**
 * The closed inventory of Figma's browser navigation surface, and the evidence class each route carries.
 *
 * ## The routes are MEASURED, not recalled, and the measurement needs no account
 *
 * A hand list of a platform's pages is a confident lie waiting to happen — the exact failure
 * `docs/atlas-intent/settled-decisions.md` warns about when it says an atlas must be honest about its gaps. So this inventory
 * was probed instead, and Figma answers the question generously: an unknown path is normalised to a
 * trailing slash and then answers a real `404`, while a route that exists answers a redirect to `/login`, a
 * `403`, a `200` or an off-host `301` depending on what kind of route it is.
 *
 * MEASURED, with a control. Reproduce every row:
 *
 * ```bash
 * yarn tsx tools/probeFigmaRoutes.ts            # print each route's evidence class
 * yarn tsx tools/probeFigmaRoutes.ts --verify   # exit non-zero if any row disagrees with this file
 * ```
 *
 * `/nope-not-a-real-route-zzz` is in every run as the control and answers 404, which is what makes every
 * other answer a signal rather than a guess.
 *
 * ## The gate matches on a PREFIX, so most redirects confirm less than they look like they do
 *
 * This is the finding that shaped the vocabulary, and it is the reason there are six evidence classes here
 * rather than the three the Airtable inventory needed. MEASURED: `/files/team/{teamId}/zzz-not-a-real-subroute`
 * answers exactly the same `302 → /login?is_not_gen_0=true&resource_type=team` as
 * `/files/team/{teamId}/members` does. The authentication gate refuses before the router resolves the leaf,
 * so a redirect under a gated prefix cannot distinguish a real page from an invented sibling.
 *
 * The finding arrived the way it should: the first draft of this table graded those six team sub-routes as
 * confirmed, and `tools/probeFigmaRoutes.ts` disagreed with the file that had generated it. A gated route
 * is therefore graded by a SECOND request whose whole job is to fail — an invented sibling in the same
 * position for a route ending in a literal, and the `resource_type` discriminator for one ending in a
 * parameter, since there the id is already synthetic. The tool's header carries both tests. Sixteen rows
 * here are `auth-gated-prefix` because that second request answered identically, and an inventory that
 * collapsed the two classes would be claiming sixteen confirmations it has not got.
 *
 * ## `resource_type=folder` on a route Figma calls a project is a corroboration, not a curiosity
 *
 * `generated/specLock.ts` records that all three operations under the REST document's `Projects` tag are
 * deprecated. Here the browser gate answers `resource_type=folder` for `/files/project/{projectId}` — the
 * v2 `Folders` vocabulary, arriving in the sign-in redirect for the noun the v1 API still calls a project.
 * Neither surface states the succession on its own. `docs/atlas-intent/04-corroboration.md` is the reason both records
 * are kept and the disagreement itself is published.
 *
 * ## Why the org and admin routes are the ones that matter most
 *
 * Figma's REST surface has no operation that returns a team, an organisation, a membership or an
 * organisation setting — its whole `Users` tag is one endpoint describing the caller. Every one of those
 * lives behind a route in this table and nowhere else, which is `docs/atlas-intent/02-both-surfaces.md`'s "things via the
 * browser you can't get by API" arriving as a measured property of this platform rather than as a
 * principle. It is also why `/admin` is in here answering 404: a reader who guesses it learns from the
 * atlas that Figma has no such route, instead of from a browser.
 *
 * ## No private identifier is in here
 *
 * Every parameterised route is a TEMPLATE. This organisation's team, project, org and file ids are provider
 * identifiers this repository may not carry, so they live only in a generation under `$SLOPWEAVER_HOME`,
 * and the probe uses obviously synthetic ids for the same reason.
 */

/**
 * What an unauthenticated probe established about one route.
 *
 * - `auth-gated-confirmed` — it answered `302 → /login`, AND the invented sibling that decides the question
 *   for this route's shape did NOT answer the same way. The router reached this route's own last segment
 *   before the gate refused, so the route EXISTS. The strongest thing a signed-out probe establishes about
 *   a gated route on this platform.
 * - `auth-gated-prefix` — it answered `302 → /login`, and so did the invented sibling. Confirms the gated
 *   PREFIX and nothing beyond it. Not an existence claim about the leaf at all.
 * - `resource-forbidden` — it answered `403`. The path resolved to a resource handler that refused an
 *   unauthenticated caller, which confirms the route pattern exists.
 * - `public-200` — it answered `200` with no session. Evidence that nothing refused the request, and of
 *   nothing else; what such a page renders for a signed-in person is a separate question a walk answers.
 * - `offsite-redirect` — it answered `301` to a different host, so this path is a doorway to Figma's
 *   documentation site rather than a page of the product.
 * - `absent-404` — it answered `404` after the trailing-slash normalisation. Probed, and NOT there. In the
 *   inventory to record a negative a reader would otherwise have to discover.
 */
export const FIGMA_ROUTE_EVIDENCE = [
  "auth-gated-confirmed",
  "auth-gated-prefix",
  "resource-forbidden",
  "public-200",
  "offsite-redirect",
  "absent-404",
] as const;

/**
 * What an unauthenticated probe established about one route.
 *
 * @internal
 */
export type FigmaRouteEvidence = (typeof FIGMA_ROUTE_EVIDENCE)[number];

/** One route in the declared browser navigation surface. */
export interface FigmaBrowserPage {
  /** What the signed-out probe established. See {@link FigmaRouteEvidence}. */
  readonly evidence: FigmaRouteEvidence;
  /** What this page is, in a reader's words rather than Figma's. */
  readonly holds: string;
  /** The route template, `{brace}` parameters intact. Never a real identifier. */
  readonly route: string;
  /**
   * Whether a walk should photograph this page. The owner's ruling: settings and admin pages get a
   * screenshot; a page whose content is the organisation's own data does not, because photographing that
   * is holding the entities by another route.
   */
  readonly screenshot: boolean;
}

/**
 * Every route this atlas declares, sorted, each with what a signed-out probe established about it.
 *
 * Forty-one routes. Four are `auth-gated-confirmed`, thirteen `resource-forbidden`, four `public-200` and
 * two `offsite-redirect` — twenty-three whose existence is CONFIRMED. Sixteen are `auth-gated-prefix`,
 * whose prefix is confirmed and whose leaf is not, and they become open `browser-page-not-attempted` gaps
 * until a walk with a signed-in session reaches them. Two are `absent-404`, recorded so the negative is in
 * the atlas rather than in somebody's memory.
 */
export const FIGMA_BROWSER_PAGES: readonly FigmaBrowserPage[] = [
  {
    evidence: "resource-forbidden",
    holds: "a public Community profile — the person's published files, plugins and widgets",
    route: "/@{handle}",
    screenshot: false,
  },
  {
    evidence: "absent-404",
    holds:
      "NOTHING. Probed and absent, and in the inventory for exactly that reason: Figma has no `/admin`, and organisation administration lives under `/files/org/{orgId}` and `/settings/organization` instead. The two names invite the wrong guess",
    route: "/admin",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one FigJam board's canvas",
    route: "/board/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "the Community home — published files, plugins and widgets across Figma",
    route: "/community",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "the Community file directory",
    route: "/community/files",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds:
      "the plugin and widget directory. The REST document declares no plugin operation of any kind, so what an organisation has installed is visible here and in `/files/team/{teamId}/resources`, and in no API response",
    route: "/community/plugins",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one Slides deck under its newer path",
    route: "/deck/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds:
      "one design file's canvas. NOT screenshotted: its content is the organisation's own design work, and photographing it would be holding the entities by another route",
    route: "/design/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "offsite-redirect",
    holds:
      "a doorway to `developers.figma.com`, which is a different host entirely. Recorded so a reader learns the developer documentation is not part of the product's own route space",
    route: "/developers",
    screenshot: false,
  },
  {
    evidence: "offsite-redirect",
    holds:
      "a doorway to `developers.figma.com/docs/rest-api/` — the REST reference the pinned OpenAPI document describes",
    route: "/developers/api",
    screenshot: false,
  },
  {
    evidence: "public-200",
    holds:
      "the OAuth application registry: which apps this person has registered, their redirect URIs and their client ids. The REST document names the OAuth authorization, token and refresh endpoints and declares an operation for none of them, so this page is the only place that surface is administered",
    route: "/developers/apps",
    screenshot: true,
  },
  {
    evidence: "public-200",
    holds: "registering a new OAuth application",
    route: "/developers/apps/new",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds:
      "the legacy file URL. Still served, and still the shape most pasted Figma links carry, which is why an atlas that recorded only `/design/{fileKey}` would fail to recognise half the links it is shown",
    route: "/file/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "auth-gated-confirmed",
    holds: "the signed-in person's file browser root — the entry point a walk fans out from",
    route: "/files",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "the person's own drafts, which belong to no team and appear in no team-scoped API response",
    route: "/files/drafts",
    screenshot: false,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "files this person has starred",
    route: "/files/favorites",
    screenshot: false,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "the organisation's own file browser and, on an organisation plan, the surface its administration hangs off. No REST operation returns an organisation at all",
    route: "/files/org/{orgId}",
    screenshot: true,
  },
  {
    evidence: "auth-gated-confirmed",
    holds:
      "one project's files. The gate answers `resource_type=folder` here — Figma's v2 vocabulary for the noun its deprecated v1 `Projects` tag still calls a project, which is the browser corroborating a succession the REST document only implies",
    route: "/files/project/{projectId}",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "files shared with this person directly",
    route: "/files/shared",
    screenshot: false,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "recently opened files. Contents, not configuration — a corpus question rather than an atlas one, which is why the page's existence is recorded and its contents are not photographed",
    route: "/files/recent",
    screenshot: false,
  },
  {
    evidence: "auth-gated-confirmed",
    holds:
      "one team's projects. The API has NO operation that lists teams, so this URL is the only place a `team_id` comes from — every team-scoped REST call in the document depends on a value only the browser supplies",
    route: "/files/team/{teamId}",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "every project in one team, on one page",
    route: "/files/team/{teamId}/all-projects",
    screenshot: false,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "team-level usage analytics. No REST operation returns team analytics; the analytics endpoints are per published library",
    route: "/files/team/{teamId}/analytics",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "the team's published libraries and which of them are enabled. `getTeamComponents` returns a team's published components; whether a library is switched ON for that team is visible only here",
    route: "/files/team/{teamId}/libraries",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "team membership and each person's role. No REST operation returns either — the whole `Users` tag is one endpoint describing the caller",
    route: "/files/team/{teamId}/members",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "the team's installed plugins and widgets, for which the REST document declares no operation at all",
    route: "/files/team/{teamId}/resources",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "team settings — sharing defaults, who may invite, and library permissions. Unserved by REST",
    route: "/files/team/{teamId}/settings",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "deleted files that are still recoverable. No REST operation returns them, so a file that has vanished from an API listing is distinguishable from one that was destroyed only here",
    route: "/files/trash",
    screenshot: false,
  },
  {
    evidence: "public-200",
    holds:
      "the sign-in page. Recorded because its redirect — and the `resource_type` it carries — is what makes every gated route in this table measurable without an account",
    route: "/login",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one Figma Make file. Figma Make is a product the REST document declares no operation for",
    route: "/make/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one Figma Buzz file. Likewise unserved by any REST operation",
    route: "/buzz/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "absent-404",
    holds:
      "NOTHING. Probed and absent. An organisation is addressed as `/files/org/{orgId}`, not as a route of its own, and recording the miss stops the next reader re-testing it",
    route: "/organization/{orgId}",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one file's prototype presentation view",
    route: "/proto/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "auth-gated-confirmed",
    holds:
      "account settings, and the page personal access tokens are created on — which is what `slopweaver secrets set figma-token` needs and the reason this route is the unblock named on every not-configured cell",
    route: "/settings",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "the account tab — name, email, profile image and connected accounts",
    route: "/settings/account",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "notification preferences",
    route: "/settings/notifications",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds:
      "organisation-level settings — SSO, domain capture, seat policy and sharing restrictions. No REST operation returns any of it, so this is the single most load-bearing page in the table",
    route: "/settings/organization",
    screenshot: true,
  },
  {
    evidence: "auth-gated-prefix",
    holds: "password, two-factor and active sessions",
    route: "/settings/security",
    screenshot: true,
  },
  {
    evidence: "public-200",
    holds: "the sign-up page",
    route: "/signup",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one Figma Sites file. Likewise unserved by any REST operation, and note the path is singular",
    route: "/site/{fileKey}",
    screenshot: false,
  },
  {
    evidence: "resource-forbidden",
    holds: "one Slides deck",
    route: "/slides/{fileKey}",
    screenshot: false,
  },
];

/**
 * The routes a signed-out probe CONFIRMED exist, which is the honest denominator before any walk runs.
 *
 * A confirmation is any evidence class that resolved the route itself: the typed gate redirect, a
 * forbidden resource, a public page and an off-host doorway. `auth-gated-prefix` is deliberately excluded —
 * it confirms a prefix, not the route — and so is `absent-404`, which confirms the opposite.
 *
 * @returns every page whose own existence the probe established
 */
export function figmaConfirmedRoutes(): readonly FigmaBrowserPage[] {
  return FIGMA_BROWSER_PAGES.filter(
    (page) =>
      page.evidence === "auth-gated-confirmed" ||
      page.evidence === "resource-forbidden" ||
      page.evidence === "public-200" ||
      page.evidence === "offsite-redirect",
  );
}

/**
 * The routes the probe found are NOT there.
 *
 * @returns every page whose evidence is a 404
 */
export function figmaAbsentRoutes(): readonly FigmaBrowserPage[] {
  return FIGMA_BROWSER_PAGES.filter((page) => page.evidence === "absent-404");
}
