/**
 * The dashboard's navigation surface, taken from the application's OWN route table rather than from a list
 * somebody guessed.
 *
 * ## Where the routes come from
 *
 * `app.inngest.com` is a TanStack Router application, and the bundle it serves a SIGNED-OUT visitor carries
 * its whole route tree: every route is declared as `X.update({ id, path, getParentRoute: () => PARENT })`,
 * so composing a full address is walking the parent chain. This is the vendor's own statement of its
 * navigation surface — every settings page, every integration, every environment-scoped page — obtained with
 * no credential and no browser. Reproduce it with `slopweaver atlas inngest sync`.
 *
 * The entry bundle's filename is content-hashed and changes on every deploy, so it is read from the
 * `modulepreload` links on the sign-in page rather than pinned. A pinned filename would compile a stale
 * route table for exactly as long as nobody noticed.
 *
 * ## The environment slug is the application's, not this module's
 *
 * Most of the surface lives under `/env/$envSlug/…`, and substituting a guessed slug would make every probe
 * below it evidence about an address the vendor never named. The sign-in page states its own default in the
 * Clerk bootstrap it inlines — `"__signInFallbackRedirectUrl":"/env/production/apps"` — so the slug is READ
 * from there. When it cannot be read, every `$envSlug` route stays `unprobeable-parameterised` rather than
 * being probed against an invention.
 *
 * ## The control is per-DEPTH, because the discrimination is
 *
 * MEASURED, and this is the finding that shapes the whole page kind:
 *
 * ```text
 * GET /zzzsyntheticzzz-control                        404
 * GET /settings/zzzsyntheticzzz-control               307 → /sign-in?redirect_url=…
 * GET /settings/api-keys                              307 → /sign-in?redirect_url=…
 * GET /env/production/zzzsyntheticzzz-control         307 → /sign-in?redirect_url=…
 * ```
 *
 * At the root the application discriminates and a probe establishes existence. Below a layout segment it
 * serves the identical sign-in redirect to any address at all, so a probe there establishes NOTHING — and
 * recording those routes as confirmed would be reporting the layout's behaviour as the route's. So a control
 * is probed for every parent prefix this run is about to visit, and only prefixes whose control answers 404
 * yield existence evidence. The rest are `unprobeable-control-agrees`, which the walk is what closes.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { InngestAtlasErrors, inngestAtlasErrorLines } from "./errors.js";

/** The dashboard's origin. */
export const INNGEST_DASHBOARD_ORIGIN = "https://app.inngest.com";

/** The page whose bundle carries the route table, and whose Clerk bootstrap names the default environment. */
export const INNGEST_DASHBOARD_BOOTSTRAP_URL = `${INNGEST_DASHBOARD_ORIGIN}/sign-in`;

/**
 * The invented final segment every depth control is built from.
 *
 * @internal
 */
export const INNGEST_ROUTE_CONTROL_SEGMENT = "zzzsyntheticzzz-control";

/** One route the application's own table declares. */
export interface InngestDashboardRoute {
  /** Whether the composed path carries a `$param` segment, so no concrete address exists. */
  readonly parameterised: boolean;
  /** The composed address, `$param` segments intact. */
  readonly routePath: string;
  /** The section this route sits in — its first path segment, or `root` for the top level. */
  readonly section: string;
}

/** `VAR = SOMETHING.update({id:"…",path:"…",getParentRoute:()=>PARENT})`, as the bundle minifies it. */
const ROUTE_DECLARATION =
  /([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\.update\(\{id:"([^"]*)",path:"([^"]*)",getParentRoute:\(\)=>([A-Za-z_$][\w$]*)\}\)/g;

/** The client entry the sign-in page preloads. Content-hashed, so it is read rather than pinned. */
const ENTRY_ASSET = /["']\/(assets\/index-[A-Za-z0-9_-]+\.js)["']/;

/** The application's own default post-sign-in address, which names its default environment slug. */
const FALLBACK_REDIRECT = /"__signInFallbackRedirectUrl":"(\/env\/[^/"]+\/[^"]*)"/;

/**
 * The client entry bundle's address, read off the page that preloads it.
 *
 * @param html the sign-in page exactly as served
 * @returns the absolute address of the entry bundle, or why it could not be found
 */
export function entryBundleUrl({ html }: { html: string }): Result<string> {
  const match = ENTRY_ASSET.exec(html);
  const asset = match?.[1];
  if (asset === undefined) {
    return err(
      inngestAtlasErrorLines({ error: InngestAtlasErrors.entryUndeclared({ url: INNGEST_DASHBOARD_BOOTSTRAP_URL }) }),
    );
  }
  return ok(`${INNGEST_DASHBOARD_ORIGIN}/${asset}`);
}

/**
 * The default environment slug, as the application itself declares it.
 *
 * @param html the sign-in page exactly as served
 * @returns the slug, or `null` when the page names none
 */
export function defaultEnvironmentSlug({ html }: { html: string }): string | null {
  const match = FALLBACK_REDIRECT.exec(html);
  const path = match?.[1];
  if (path === undefined) {
    return null;
  }
  // FALLBACK_REDIRECT only matches `/env/<slug>/…` with a non-empty slug, so index 2 is always that slug.
  return path.split("/")[2]!;
}

/** One declaration as the bundle carries it, before parents are resolved. */
interface RawRoute {
  readonly parent: string;
  readonly path: string;
}

/** Compose one route's full path by walking its parent chain, dropping empty and root segments. */
function composePath({
  variable,
  byVariable,
}: {
  variable: string;
  byVariable: ReadonlyMap<string, RawRoute>;
}): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let current = variable;
  while (!seen.has(current)) {
    seen.add(current);
    const route: RawRoute | undefined = byVariable.get(current);
    if (route === undefined) {
      break;
    }
    const trimmed = route.path.replaceAll(/^\/+|\/+$/g, "");
    if (trimmed !== "") {
      segments.unshift(trimmed);
    }
    current = route.parent;
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Read the application's own route table out of its entry bundle.
 *
 * @param bundle the entry bundle's source exactly as served
 * @returns every route it declares, sorted and de-duplicated, or why none could be read
 */
export function compileDashboardRoutes({ bundle }: { bundle: string }): Result<readonly InngestDashboardRoute[]> {
  const byVariable = new Map<string, RawRoute>();
  for (const match of bundle.matchAll(ROUTE_DECLARATION)) {
    const [, variable, , path, parent] = match;
    if (variable !== undefined && path !== undefined && parent !== undefined) {
      byVariable.set(variable, { parent, path });
    }
  }
  if (byVariable.size === 0) {
    return err(inngestAtlasErrorLines({ error: InngestAtlasErrors.routesUnreadable() }));
  }
  const paths = new Set<string>();
  for (const variable of byVariable.keys()) {
    paths.add(composePath({ byVariable, variable }));
  }
  return ok(
    [...paths].toSorted().map((routePath) => ({
      parameterised: routePath.split("/").some((segment) => segment.startsWith("$")),
      routePath,
      // composePath answers `/` or `/<non-empty segment>…`, so past the root, index 1 is that first segment.
      section: routePath === "/" ? "root" : routePath.split("/")[1]!,
    })),
  );
}

/**
 * The concrete address one declared route is probed at, substituting only the environment slug the
 * application itself named.
 *
 * A route carrying any other `$param` has no concrete address — an id this atlas invented would answer
 * whatever the application does about a resource that does not exist, which is a fact about the invention
 * rather than about the route.
 *
 * @param route the declared route
 * @param environmentSlug the slug the application named, or `null` when it named none
 * @returns the path to probe, or `null` when the route has no concrete address
 */
export function probePathFor({
  route,
  environmentSlug,
}: {
  route: InngestDashboardRoute;
  environmentSlug: string | null;
}): string | null {
  if (!route.parameterised) {
    return route.routePath;
  }
  const segments = route.routePath.split("/");
  const substituted = segments.map((segment) =>
    segment === "$envSlug" && environmentSlug !== null ? environmentSlug : segment,
  );
  return substituted.some((segment) => segment.startsWith("$")) ? null : substituted.join("/");
}

/**
 * The parent prefix whose control decides whether one address's answer means anything.
 *
 * @param path the concrete address about to be probed
 * @returns the prefix a control is built under; `""` for a root-level address
 */
export function controlPrefixFor({ path }: { path: string }): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.length <= 1 ? "" : `/${segments.slice(0, -1).join("/")}`;
}

/**
 * The invented address that decides whether one prefix discriminates.
 *
 * @param prefix the parent prefix, `""` for the root
 * @returns the control address
 */
export function controlPathFor({ prefix }: { prefix: string }): string {
  return `${prefix}/${INNGEST_ROUTE_CONTROL_SEGMENT}`;
}
