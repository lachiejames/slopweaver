/**
 * The dashboard routes this atlas declares, and the honest statement that the declaration is a FLOOR.
 *
 * ## Why this list is short, and why that is not the same as it being incomplete
 *
 * The browser surface never shrinks. Declaring routes nobody has
 * evidence for would satisfy the letter of that and destroy its point: a list of invented addresses cannot
 * shrink either, and every one of them would be a claim this repository could not back. So every entry below
 * is GROUNDED — it is either a route this installation actually reached, or one Braze's own published
 * reference names — and the routes Braze's dashboard certainly has beyond them are carried as a standing gap
 * (`browser-route-inventory-undiscovered`) rather than as guesses.
 *
 * MEASURED: across all 146 endpoint pages of Braze's API reference, exactly ONE literal dashboard
 * address appears (`/app_settings/developer_console/activitylog/`). Braze documents dashboard navigation as
 * breadcrumbs — "**Settings** > **API Keys**" — rather than as URLs, so five destinations below are named
 * with no path at all. That is Braze's publishing choice recorded as a fact, not a gap in this reader.
 *
 * ## The route inventory is exactly what a session would discover
 *
 * `docs/atlas-intent/05-browser-proof.md` wants the exact URL for every thing, because proof is a screenshot. This atlas
 * cannot have that yet: no Braze account exists on this installation. The one thing it CAN say honestly is
 * where a walk would start and what it would be looking for, which is what this file is.
 */

/**
 * One declared dashboard destination.
 *
 * @internal
 */
export interface BrazeBrowserRoute {
  /** Which dashboard area this belongs to. */
  readonly section: string;
  /**
   * The path under the dashboard origin, or `null` when Braze publishes only a navigation breadcrumb for it.
   * A null path is a route a walk must DISCOVER rather than one it can be pointed at.
   */
  readonly path: string | null;
  /** Braze's own name for the destination — the breadcrumb where there is one. */
  readonly description: string;
  /** How this repository knows the destination exists. Never empty: an ungrounded route is not declarable. */
  readonly grounding: string;
  /** The stable scope a coverage cell and a gap are keyed on. */
  readonly surface: string;
}

/**
 * The dashboard origin a route hangs off, for the cluster this organisation is INFERRED to be on.
 *
 * Braze runs one dashboard per cluster and publishes no way to discover which one an organisation uses
 * without signing in. The Cloudflare DNS records tagged `braze` on this organisation's own domain are all
 * `ap-southeast-2` Amazon SES — two DKIM CNAMEs, an MX, an SPF record and a click-tracking CNAME pointing at
 * `r.ap-southeast-2.awstrack.me` — which points at Braze's AU-01 cluster. Both `dashboard.au-01.braze.com`
 * and `rest.au-01.braze.com` resolve.
 *
 * It is an INFERENCE and is labelled one everywhere it is used. `dashboard.braze.com` is what this atlas
 * actually reached, and it is the cluster-agnostic entry point Braze redirects from, so it is what the routes
 * below are expressed against until somebody with an account settles the question.
 *
 * @internal
 */
export const BRAZE_DASHBOARD_ORIGIN = "https://dashboard.braze.com";

/**
 * The cluster this organisation is inferred to use, recorded so the inference is greppable rather than buried
 * in prose. Nothing branches on it.
 *
 * @internal
 */
export const BRAZE_INFERRED_CLUSTER = {
  dashboardOrigin: "https://dashboard.au-01.braze.com",
  evidence:
    "every Cloudflare DNS record tagged `braze` on this organisation's domain is ap-southeast-2 Amazon SES, " +
    "including a click-tracking CNAME to r.ap-southeast-2.awstrack.me",
  name: "AU-01",
  restOrigin: "https://rest.au-01.braze.com",
  status: "inferred",
} as const;

/** Every dashboard destination this atlas declares. */
export const BRAZE_BROWSER_ROUTES: readonly BrazeBrowserRoute[] = [
  {
    description: "the dashboard entry point, which redirects to the sign-in form when there is no session",
    grounding:
      "reached from this installation: it answered a redirect to /sign_in and an " +
      "identifier-first form, which is how this atlas knows the account does not exist",
    path: "/",
    section: "root",
    surface: "dashboard-root",
  },
  {
    description: "the sign-in form",
    grounding: "reached from this installation, where the dashboard root settles with no session",
    path: "/sign_in",
    section: "root",
    surface: "dashboard-sign-in",
  },
  {
    description: "the developer console's activity log",
    grounding: "the only literal dashboard address Braze's own API reference prints, across all 146 endpoint pages",
    path: "/app_settings/developer_console/activitylog/",
    section: "settings",
    surface: "developer-console-activity-log",
  },
  {
    description: "Settings > API Keys",
    grounding: "named as a navigation breadcrumb on 40 of Braze's own endpoint pages, with no URL published",
    path: null,
    section: "settings",
    surface: "settings-api-keys",
  },
  {
    description: "Settings > App Settings",
    grounding: "named as a navigation breadcrumb on 10 of Braze's own endpoint pages, with no URL published",
    path: null,
    section: "settings",
    surface: "settings-app-settings",
  },
  {
    description: "Settings > APIs and Identifiers > API Usage Dashboard",
    grounding: "named as a navigation breadcrumb on 3 of Braze's own endpoint pages, with no URL published",
    path: null,
    section: "settings",
    surface: "settings-api-usage-dashboard",
  },
  {
    description: "Settings > Email Preferences",
    grounding: "named as a navigation breadcrumb on 2 of Braze's own endpoint pages, with no URL published",
    path: null,
    section: "settings",
    surface: "settings-email-preferences",
  },
  {
    description: "Data Settings > Custom Attributes",
    grounding: "named as a navigation breadcrumb on 2 of Braze's own endpoint pages, with no URL published",
    path: null,
    section: "data",
    surface: "data-settings-custom-attributes",
  },
];

/**
 * The address a walk would open for one route.
 *
 * @param route the declared destination
 * @returns the absolute URL, or `null` when Braze publishes only a breadcrumb and a walk must discover it
 */
export function brazeRouteUrl({ route }: { route: BrazeBrowserRoute }): string | null {
  return route.path === null ? null : `${BRAZE_DASHBOARD_ORIGIN}${route.path}`;
}
