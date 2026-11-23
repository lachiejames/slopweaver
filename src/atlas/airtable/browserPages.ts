/**
 * The closed inventory of Airtable's browser navigation surface, and the evidence class each route carries.
 *
 * ## The routes are MEASURED, not recalled, and the measurement needs no account
 *
 * Every sibling atlas's page inventory is a hand list, and a hand list of a platform the atlas may hold no
 * sign-in for would be a confident lie — the exact failure `docs/atlas-intent/settled-decisions.md` warns about when it says an
 * atlas must be honest about its gaps. So the inventory below was probed instead, and Airtable turns out to
 * answer the question for free: an unauthenticated request to a route that EXISTS and is gated answers
 * `302 → /login?continue=<the route>`, while a route that does not exist answers a flat `404`.
 *
 * MEASURED, with a control. Reproduce every row:
 *
 * ```bash
 * yarn tsx tools/probeAirtableRoutes.ts
 * ```
 *
 * `/nope-not-a-real-route-zzz` is in the probe as the control and answers `404`, which is what makes the
 * `302` a signal rather than a guess. Eleven routes were confirmed this way — the whole account and
 * enterprise-admin surface — without an Airtable account existing.
 *
 * ## Three evidence classes, because a 200 proves nothing here
 *
 * Airtable is a single-page application, so its shell renders `200` for a signed-out visitor at a route it
 * will later populate — including `/{baseId}` and `/{baseId}/automations` with a base id that is pure
 * invention. A 200 is therefore recorded as AMBIGUOUS rather than as a reached page, and this distinction
 * is the difference between an inventory and a wish list. {@link AirtableRouteEvidence} carries it, and a
 * walk that later signs in replaces it with a real observation.
 *
 * ## Why the automations routes are in here at all
 *
 * `generated/specLock.ts` records that Airtable declares a `workflow` tag and publishes zero operations
 * under it: there is no REST call that lists a base's automations. The browser is the only channel that can
 * see them, which is `docs/atlas-intent/02-both-surfaces.md`'s "things via the browser you can't get by API" arriving as
 * a measured fact rather than a principle. Their evidence class is honest about being ambiguous, and that
 * is exactly why the surface stays declared rather than being dropped.
 *
 * ## No private identifier is in here
 *
 * Every parameterised route is a TEMPLATE. The enterprise account id, the workspace ids and the base ids of
 * this organisation are provider identifiers this repository may not carry, so they live only in a
 * generation under `$SLOPWEAVER_HOME`. The probe uses obviously synthetic ids for the same reason.
 */

/**
 * What an unauthenticated probe established about one route.
 *
 * - `auth-gated-redirect` — it answered `302 → /login?continue=<route>`. The route EXISTS and is gated.
 *   The strongest thing a signed-out probe can establish, and the class the whole admin surface falls in.
 * - `shell-200-ambiguous` — it answered `200`, which the single-page shell does for a signed-out visitor
 *   whatever the path resolves to. Evidence that nothing refused the request, and of nothing else.
 * - `marketing-redirect` — it answered `301 → www.airtable.com/...`, so this path is the marketing site
 *   rather than the product.
 */
const AIRTABLE_ROUTE_EVIDENCE = ["auth-gated-redirect", "shell-200-ambiguous", "marketing-redirect"] as const;

/**
 * What an unauthenticated probe established about one route.
 *
 * @internal
 */
export type AirtableRouteEvidence = (typeof AIRTABLE_ROUTE_EVIDENCE)[number];

/** One route in the declared browser navigation surface. */
export interface AirtableBrowserPage {
  /** What the signed-out probe established. See {@link AirtableRouteEvidence}. */
  readonly evidence: AirtableRouteEvidence;
  /** What this page is, in a reader's words rather than Airtable's. */
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
 * Twenty-two routes. Eleven are `auth-gated-redirect`, which is a confirmed existence; the rest are
 * declared because the product plainly has them and the shell will not say so — those become open
 * `browser-page-not-attempted` gaps until a walk with a signed-in session reaches them.
 */
export const AIRTABLE_BROWSER_PAGES: readonly AirtableBrowserPage[] = [
  {
    evidence: "auth-gated-redirect",
    holds: "the signed-in person's own account settings — email, password, two-factor and connected accounts",
    route: "/account",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "the enterprise admin panel's entry point, which redirects to the account this person administers",
    route: "/admin",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds:
      "the enterprise audit-log surface. Its EVENTS are the shape-indexed voluminous family; this page is the control that produces them",
    route: "/admin/{enterpriseAccountId}/audit-logs",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "the enterprise plan, seat count and billing configuration",
    route: "/admin/{enterpriseAccountId}/billing",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "every user group in the enterprise account and who is in it",
    route: "/admin/{enterpriseAccountId}/groups",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds:
      "the enterprise usage reports — which bases and workspaces are actually being used, which no REST operation returns",
    route: "/admin/{enterpriseAccountId}/reports",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "enterprise-wide settings — SSO, sharing restrictions, the AI allowlist and data-residency controls",
    route: "/admin/{enterpriseAccountId}/settings",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds:
      "every user in the enterprise account, with their state and admin status. The page an organisation's SSO tile points at",
    route: "/admin/{enterpriseAccountId}/users",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "one base's default table and view — the ops table itself. NOT screenshotted: its content is the organisation's data, and photographing it would be holding the entities by another route",
    route: "/{baseId}",
    screenshot: false,
  },
  {
    evidence: "auth-gated-redirect",
    holds:
      "the base's own generated REST documentation, which names its tables and fields in that base's real vocabulary",
    route: "/{baseId}/api/docs",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "a base's AUTOMATIONS — their triggers, actions and enabled state. The specification declares a `workflow` tag and ships no operation, so this page is the only channel that can see them at all",
    route: "/{baseId}/automations",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "a base's INTERFACES — the published layouts built on top of its tables. `GET /v0/meta/bases/{baseId}/interfaces/{pageBundleId}` returns only an interface's collaborators, never its layout",
    route: "/{baseId}/interfaces",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "one view's configuration — its filters, sorts, grouping, row height and hidden fields. `GET /v0/meta/bases/{baseId}/views/{viewId}` returns a view's name and type; its CONFIGURATION lives here",
    route: "/{baseId}/{tableId}/{viewId}",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "the OAuth integrations this person has registered",
    route: "/create/oauth",
    screenshot: true,
  },
  {
    evidence: "auth-gated-redirect",
    holds: "the personal access tokens this person holds, with their scopes and resource grants",
    route: "/create/tokens",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "the Web API reference, which server-renders the whole OpenAPI document this atlas's registry is generated from. Public, and the one page here that needs no account",
    route: "/developers/web/api/introduction",
    screenshot: false,
  },
  {
    evidence: "shell-200-ambiguous",
    holds: "the extensions (blocks) SDK reference",
    route: "/developers/extensions",
    screenshot: false,
  },
  {
    evidence: "marketing-redirect",
    holds:
      "the public enterprise marketing page. In the inventory so that a reader learns this path is NOT the admin panel, which is the mistake the two names invite",
    route: "/enterprise",
    screenshot: false,
  },
  {
    evidence: "shell-200-ambiguous",
    holds:
      "the sign-in page. Recorded because its `continue` parameter is what makes every auth-gated route in this table measurable without an account",
    route: "/login",
    screenshot: false,
  },
  {
    evidence: "shell-200-ambiguous",
    holds: "the extension marketplace, which is where an installed block comes from",
    route: "/marketplace",
    screenshot: false,
  },
  {
    evidence: "shell-200-ambiguous",
    holds: "every workspace this person can see, which is the entry point a walk fans out from",
    route: "/workspaces",
    screenshot: true,
  },
  {
    evidence: "shell-200-ambiguous",
    holds: "one workspace — its bases, its collaborators and its own restrictions",
    route: "/{workspaceId}",
    screenshot: true,
  },
];

/**
 * The routes a signed-out probe CONFIRMED exist, which is the honest denominator before any walk runs.
 *
 * @returns every page whose evidence is an auth-gated redirect
 */
export function airtableConfirmedRoutes(): readonly AirtableBrowserPage[] {
  return AIRTABLE_BROWSER_PAGES.filter((page) => page.evidence === "auth-gated-redirect");
}
