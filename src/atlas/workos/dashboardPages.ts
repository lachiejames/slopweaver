/**
 * The BROWSER surface's declared page map: every dashboard address this atlas expects to exist, and the
 * runtime expansion that turns one into a URL.
 *
 * ## Why this half is DECLARED and the API half is MEASURED
 *
 * The API's route table is measured against the running server with no credential, because WorkOS answers
 * a distinguishable `404` for a route it does not serve (`routeProbe.ts`). The dashboard gives no such
 * oracle. MEASURED against `dashboard.workos.com` with no session: `/organizations`,
 * `/api-keys`, `/directory-sync` and a deliberately nonsense `/zzz_nope` ALL answer the same
 * `307 → /signin?redirect=<path>`. The redirect is a catch-all, so an unauthenticated prober cannot tell a
 * real page from an invented one, and any claim this table made about existence would be unfalsifiable.
 *
 * That is why the page map is `compiled` and its walk is a separate surface: the addresses below are an
 * expectation, and only a signed-in walk can turn one into evidence. It is also the sharpest instance of
 * `docs/atlas-intent/02-both-surfaces.md` in this repository — the two surfaces do not merely diverge in content here,
 * they differ in what can be KNOWN about them at all.
 *
 * ## One address that IS measured, and it is worth the row
 *
 * `/settings` answers `307 → /settings/team` rather than the sign-in catch-all — a real internal redirect
 * that names a sub-route to anyone, signed in or not. It is the only structural fact the dashboard gives up
 * for free, and `syncCoverage.ts` records it as such rather than letting it sit in the same undifferentiated
 * `unverified` bucket as the rest.
 *
 * ## Most of the dashboard hangs off an environment SEGMENT, and that segment is per-install state
 *
 * MEASURED by a signed-in walk: `/organizations`, `/users`, `/roles`, `/events`, `/audit-logs`,
 * `/environments` and `/directory-sync` each answer the dashboard's own not-found page at their bare path,
 * while WorkOS itself redirects `/api-keys` and `/webhooks` to `/environment_<id>/…`. So the environment is
 * a PATH SEGMENT, not the session state this file once claimed it was, and the id in it is this
 * installation's own — per-install state that resolves at runtime from `$SLOPWEAVER_HOME` and never lives
 * in this repository (AGENTS.md, "tools in the codebase, state outside it"). `environmentId.ts` resolves
 * it; {@link workosDashboardRouteUrl} is the only place a concrete address is ever built.
 *
 * **A route's `path` is its provider id, and stays bare.** The environment moves the ADDRESS; making it
 * part of the key would churn every page entity on every install and store this installation's id in one.
 *
 * ## The bootstrap address is load-bearing
 *
 * An environment route whose id is not resolved yet is published at its BARE path, and that is deliberate
 * rather than a fallback: `declaredPagesFrom` (`atlas/kit/walkVerb.ts`) drops a page with no `deepLink`
 * from the walk's brief, so publishing `null` would leave every environment route — `/api-keys` included —
 * unwalkable, and the redirect that reveals the id would never be followed. `syncGaps.ts` raises
 * `dashboard-environment-unresolved` whenever that is the state, so a reader can tell a bootstrap address
 * from a current one.
 *
 * ## `needsAdmin` is a bound, not an excuse
 *
 * Access that arrives through an identity provider's SaaS-management account says nothing about which
 * dashboard team role it lands on. A row marked `needsAdmin` that a walk cannot open becomes a
 * declared GAP naming the role, so the atlas stays honest about what its access could not reach rather than
 * reporting the page as absent — the same treatment `docs/atlas-intent/06-holdings.md` gives Slack's admin-only settings.
 */

/**
 * Which scope a dashboard route hangs off.
 *
 * `root` pages are the same address for every environment. `environment` pages hang off this
 * installation's own environment segment, which is why they cannot be written down here at all.
 *
 * @internal
 */
export const WORKOS_DASHBOARD_SCOPES = ["root", "environment"] as const;

/**
 * Which scope a dashboard route hangs off.
 *
 * @internal
 */
export type WorkosDashboardScope = (typeof WORKOS_DASHBOARD_SCOPES)[number];

/**
 * One declared dashboard route.
 *
 * @internal
 */
export interface WorkosDashboardRoute {
  /** The path beneath the environment segment, or beneath the origin for a `root` route. Never an id. */
  readonly path: string;
  readonly scope: WorkosDashboardScope;
  /** What this page is for, in one line. Written here rather than scraped, so it is stable. */
  readonly purpose: string;
  /** Whether reaching it is expected to need a dashboard role above the ordinary member one. */
  readonly needsAdmin: boolean;
}

/** The dashboard's own origin. The REST API is a different host — see `routeCandidates.ts`. */
export const WORKOS_DASHBOARD_ORIGIN = "https://dashboard.workos.com";

/**
 * Every dashboard route this atlas declares, root pages first and then the environment-scoped product
 * pages in the order the dashboard's own navigation lists them.
 */
export const WORKOS_DASHBOARD_ROUTES: readonly WorkosDashboardRoute[] = [
  {
    needsAdmin: false,
    path: "/get-started",
    purpose: "the signed-in landing page — the environment selector and the setup checklist",
    scope: "root",
  },
  {
    needsAdmin: false,
    path: "/settings",
    purpose: "account and workspace settings; redirects to /settings/team even without a session",
    scope: "root",
  },
  {
    needsAdmin: true,
    path: "/settings/team",
    purpose: "who is on the dashboard team and which role each of them holds",
    scope: "root",
  },
  {
    needsAdmin: true,
    path: "/environments",
    purpose: "every environment in this workspace — the boundary each API key is scoped to",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/organizations",
    purpose: "the organisations in this environment, and the domains claimed for each",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/users",
    purpose: "User Management's own user list for this environment",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/directory-sync",
    purpose: "the SCIM directories configured, and the sync state of each",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/audit-logs",
    purpose: "the audit-log stream and its export history — enumerated here, never stored whole",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/events",
    purpose: "the platform event feed for this environment",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/webhooks",
    purpose: "the webhook endpoints registered, and what each subscribes to",
    scope: "environment",
  },
  {
    needsAdmin: true,
    path: "/api-keys",
    purpose: "the environment's API keys — the page that would mint what fills this atlas's content half",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/applications",
    purpose: "the applications configured, and the redirect URIs each returns an authenticated user to",
    scope: "environment",
  },
  {
    needsAdmin: false,
    path: "/roles",
    purpose: "the roles and permissions defined for the environment",
    scope: "environment",
  },
];

/**
 * The exact URL one declared route resolves to.
 *
 * An `environment` route with no resolved id answers its bare path — the bootstrap address this file's
 * header explains, which is what a walk has to be given before anything can learn the id.
 *
 * @param route the declared route
 * @param environmentId this installation's `environment_<id>` segment, or `null` when nothing has
 *   resolved one yet
 * @returns the absolute address a human or a walk opens
 */
export function workosDashboardRouteUrl({
  route,
  environmentId,
}: {
  route: WorkosDashboardRoute;
  environmentId: string | null;
}): string {
  if (route.scope === "root" || environmentId === null) {
    return `${WORKOS_DASHBOARD_ORIGIN}${route.path}`;
  }
  return `${WORKOS_DASHBOARD_ORIGIN}/${environmentId}${route.path}`;
}

/**
 * The exact URL the declared route with this path resolves to.
 *
 * The content projections deep-link to a dashboard SURFACE rather than to a route they hold, so they name
 * a path and this resolves it through the same table the page map uses — a path the table does not declare
 * has no address at all, which is what stops a content kind pointing at a page nobody expects to exist.
 *
 * @param path the declared route's own path
 * @param environmentId this installation's `environment_<id>` segment, or `null` when none is resolved
 * @returns the absolute address, or `null` when no declared route carries that path
 */
export function workosDashboardUrl({
  path,
  environmentId,
}: {
  path: string;
  environmentId: string | null;
}): string | null {
  for (const route of WORKOS_DASHBOARD_ROUTES) {
    if (route.path === path) {
      return workosDashboardRouteUrl({ environmentId, route });
    }
  }
  return null;
}

/**
 * The one route whose existence the dashboard proves without a session, and what it proves.
 *
 * Pulled out as a constant rather than a comment because `syncCoverage.ts` reads it: that route's page row gets
 * a different provenance from the rest, and a reader has to be able to see WHICH row that is.
 *
 * @internal
 */
export const WORKOS_DASHBOARD_SELF_EVIDENT_ROUTE = {
  observedRedirect: "/settings/team",
  path: "/settings",
} as const;
