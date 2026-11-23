/**
 * Every page of the Hex web app this atlas declares, and what it deliberately cannot declare.
 *
 * ## The denominator comes from the product's own router, not from a crawl and not from the docs
 *
 * A crawler cannot prove its own completeness — "we visited everything we found" is a claim about the
 * crawler. The sibling Twilio atlas answers that by harvesting routes from Twilio's documentation, which is
 * checkable but is a FLOOR: the console certainly has more. Hex admits a stronger answer, and it is worth
 * naming because it is the better shape wherever a platform ships a single-page application:
 * `generated/clientSurface.ts` compiles the router table out of the JavaScript Hex serves, following the
 * chunk graph to a fixed point. That is the product's own statement of which pages exist, so the
 * denominator is neither harvested nor guessed.
 *
 * ## A route is not a page, and an OPTIONAL parameter is not a required one
 *
 * MEASURED: of 84 route templates, 28 declare a REQUIRED parameter — a project's locator, a
 * collection id, a thread id. Visiting one needs an id this atlas does not hold, and it must not: an id
 * would have to come from the workspace's own contents, which is the half of Hex this atlas deliberately
 * does not reach. The other 56 resolve to 56 visitable paths.
 *
 * **The distinction was learned by getting it wrong, and the failure is worth recording because it is
 * invisible from the code.** A first cut treated any `:` as needing an id, which excluded `/home/:subView?`,
 * `/settings/:subView?` and `/context-studio/:tabView?` — every surface a person actually opens hangs off a
 * template whose parameters are all optional. The resulting declared list was 41 routes that were almost
 * entirely OAuth callbacks and test harnesses, and a walk over it landed pages, not one of them a page a human
 * uses. The atlas would have passed `doctor`, published a filled browser surface, and photographed
 * the product's plumbing. `generateHexClientSurface.ts` carries the rule that replaced it.
 *
 * A template with a required parameter is recorded as a standing gap naming the count rather than dropped.
 * A reader learns that Hex has a project page; what this atlas does not hold is a photograph of one
 * particular project.
 *
 * That bound is also `docs/atlas-intent/06-holdings.md`'s own rule in Hex's terms: an atlas does not pilot a browser to
 * photograph every individual item, and a single project's page is exactly such an item here.
 *
 * ## The routes that are not app pages at all
 *
 * The router carries OAuth landing routes (`/snowflake-oauth-success`), git install callbacks and a handful
 * of test harnesses. They are declared pages like any other: each exists, each has a URL, and a walk that
 * lands on one records what it found. Filtering them out here would be this repository inventing a taxonomy
 * of what counts as a real page, which is the sort of judgement `docs/atlas-intent/01-information-places.md` exists to prevent.
 */
import { HEX_CLIENT_SURFACE, HEX_WEB_APP_ORIGIN } from "./generated/clientSurface.js";

/** Where the web app lives. A route settling on any other origin has not been reached. */
export const HEX_APP_ORIGIN = HEX_WEB_APP_ORIGIN;

/**
 * One stored, slash-less route as every other module expects to see it.
 *
 * @param route the route as `generated/clientSurface.ts` stores it
 * @returns the route with its leading slash
 */
function withLeadingSlash({ route }: { route: string }): string {
  return `/${route}`;
}

/**
 * Every route template the client declares, static and dynamic alike.
 *
 * @returns the templates, sorted, each carrying its leading slash
 *
 * @internal
 */
export function hexRouteTemplates(): readonly { dynamic: boolean; route: string }[] {
  return HEX_CLIENT_SURFACE.routeTemplates.map((template) => ({
    dynamic: template.dynamic,
    route: withLeadingSlash({ route: template.route }),
  }));
}

/**
 * The pages a walk visits: every distinct path a template can be reached at with no id.
 *
 * @returns the visitable paths, sorted
 */
export function hexDeclaredPages(): readonly string[] {
  return HEX_CLIENT_SURFACE.visitablePaths.map((route) => withLeadingSlash({ route }));
}

/**
 * The route templates that exist and cannot be visited without an id this atlas does not hold.
 *
 * @returns the templates carrying a required parameter, sorted
 */
export function hexParameterisedRoutes(): readonly string[] {
  return HEX_CLIENT_SURFACE.routeTemplates
    .filter((template) => template.dynamic)
    .map((template) => withLeadingSlash({ route: template.route }));
}

/**
 * The absolute URL one declared route resolves to.
 *
 * @param route the declared route — a static template, so nothing is substituted
 * @returns the absolute app URL to visit
 */
export function hexAppUrl({ route }: { route: string }): string {
  return `${HEX_APP_ORIGIN}${route}`;
}

/**
 * Whether one path is an app surface this atlas would declare, so a walk can judge a rendered link.
 *
 * The test is deliberately shallow: the walk's job is to notice what the app's own navigation offers, and a
 * narrower filter here would silently shrink the frontier. What keeps the frontier honest is that a route
 * it finds is recorded with the page whose link found it, so a page nobody declared is visible as one.
 *
 * @param path the path to judge, leading slash included
 * @returns whether a walk should treat it as an app page
 */
export function isHexAppPath({ path }: { path: string }): boolean {
  return path.split("/").filter((segment) => segment.length > 0).length > 0;
}
