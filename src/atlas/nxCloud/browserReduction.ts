/**
 * Reducing what a walked page ASKED FOR into shape: operations, parameter names, response field names — and
 * never a value.
 *
 * ## Two things are harvested from one capture, and only one of them is obvious
 *
 * The obvious half is the operations: every first-party call a page made while it rendered, keyed by method
 * and by a path PATTERN with its ids replaced, so a page walked in two workspaces contributes one row.
 *
 * The other half is the route table, and it is the reason this atlas's page denominator is honest.
 * Nx Cloud's client uses React Router's lazy route discovery — MEASURED, `window.__reactRouterManifest`
 * holds only the routes matched so far — so there is no build-time list of routes to walk against. What
 * there IS is the client's own `/__manifest` call, which it makes on every navigation and which answers
 * with the routes it has just learned: an id, a path segment and a parent for each. Those responses are
 * already in the capture, so the walk gets the platform's OWN declaration of what routes exist without
 * anything being added to the browser transport.
 *
 * That distinction matters for the same reason CrowdStrike walks its console's published sitemap rather
 * than a page list written here: a denominator this repository chose cannot show that this repository chose
 * the wrong pages.
 */
import type { CapturedResponse } from "../../browser/pageTransport.js";
import { isRecord } from "../../lib/parsers.js";
import { responseFieldPaths } from "../kit/responseShape.js";

import { classifyNxCloudSegment, NX_CLOUD_SHAPE_DEPTH_CAP } from "./shape.js";

/** One first-party operation a page was seen to call. */
export interface NxCloudObservedCall {
  readonly method: string;
  /** The path with every id segment replaced by its placeholder. */
  readonly pathPattern: string;
  /** Every query parameter NAME the call carried, sorted. Never a value. */
  readonly queryParams: readonly string[];
  /** Every response field path, sorted and redacted. */
  readonly responseFields: readonly string[];
  readonly statusCode: number;
  /** The client route ids a single-fetch payload named, when it named any. */
  readonly loaderRouteIds: readonly string[];
}

/** One route the client's own manifest declared. */
export interface NxCloudDeclaredRoute {
  /** The client's route id, e.g. `routes/_auth.orgs.$orgId.workspaces.$workspaceId.runs`. */
  readonly routeId: string;
  /** The path SEGMENT this route contributes, which may be empty for a layout route. */
  readonly path: string;
  /** The route this one nests under, or `null` for the root. */
  readonly parentId: string | null;
  /** Whether this is an index route. */
  readonly index: boolean;
}

/**
 * A URL's path with every id segment replaced, so one row covers every workspace.
 *
 * @param pathname the URL path
 * @returns the pattern
 */
export function patternOfPath({ pathname }: { pathname: string }): string {
  return pathname
    .split("/")
    .map((segment) => {
      const verdict = classifyNxCloudSegment({ segment });
      if (verdict === null) {
        // Not an id: the segment is part of the route's own shape and is kept as it is.
        return segment;
      }
      return verdict.placeholder;
    })
    .join("/");
}

/** The names an operation already held before this response, so it folds in: none for its first response. */
function heldNames({
  held,
}: {
  held: NxCloudObservedCall | undefined;
}): Pick<NxCloudObservedCall, "loaderRouteIds" | "queryParams" | "responseFields"> {
  if (held === undefined) {
    // The operation's first response this page made: nothing came before it to fold in.
    return { loaderRouteIds: [], queryParams: [], responseFields: [] };
  }
  return held;
}

/**
 * Reduce one page's captured responses to the first-party operations it made.
 *
 * A response from another origin is dropped: the walk observes what NX CLOUD asks for, and the analytics
 * and support widgets a page also loads are somebody else's surface.
 *
 * @param responses everything the page's capture held
 * @param origin the first-party origin
 * @returns one row per distinct operation, sorted by method and pattern
 */
export function reduceNxCloudCalls({
  responses,
  origin,
}: {
  responses: readonly CapturedResponse[];
  origin: string;
}): readonly NxCloudObservedCall[] {
  const byKey = new Map<string, NxCloudObservedCall>();
  for (const response of responses) {
    let url: URL;
    try {
      url = new URL(response.url);
    } catch {
      continue;
    }
    if (url.origin !== origin) {
      continue;
    }
    const pathPattern = patternOfPath({ pathname: url.pathname });
    const key = `${response.method} ${pathPattern}`;
    const held = heldNames({ held: byKey.get(key) });
    const merged: NxCloudObservedCall = {
      loaderRouteIds: mergeSorted({
        left: held.loaderRouteIds,
        right: isRecord(response.body) ? Object.keys(response.body) : [],
      }),
      method: response.method,
      pathPattern,
      queryParams: mergeSorted({
        left: held.queryParams,
        right: [...url.searchParams.keys()],
      }),
      responseFields: mergeSorted({
        left: held.responseFields,
        right: responseFieldPaths({
          body: response.body,
          classify: classifyNxCloudSegment,
          depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
        }),
      }),
      statusCode: response.statusCode,
    };
    byKey.set(key, merged);
  }
  return [...byKey.values()].toSorted((left, right) =>
    `${left.method} ${left.pathPattern}`.localeCompare(`${right.method} ${right.pathPattern}`),
  );
}

/**
 * The union of two name lists, sorted and deduplicated.
 *
 * @param left the names already held
 * @param right the names just observed
 * @returns the union
 */
function mergeSorted({ left, right }: { left: readonly string[]; right: readonly string[] }): readonly string[] {
  return [...new Set([...left, ...right])].toSorted();
}

/**
 * Every route the client's own `__manifest` responses declared during one page's capture.
 *
 * The response body is a record keyed by route id, each value carrying `path`, `index` and `parentId`
 * alongside the module URLs this atlas has no use for. A value that does not look like a route entry is
 * dropped rather than guessed at.
 *
 * @param responses everything the page's capture held
 * @returns one row per declared route, in payload order
 */
export function declaredRoutesFrom({
  responses,
}: {
  responses: readonly CapturedResponse[];
}): readonly NxCloudDeclaredRoute[] {
  return responses
    .filter((response) => response.url.includes("/__manifest"))
    .flatMap((response) => routesInManifestBody({ body: response.body }));
}

/**
 * The routes one `__manifest` response body declares.
 *
 * A value that does not look like a route entry is dropped rather than guessed at: the same body carries
 * the module URLs and import lists this atlas has no use for, and reading one of those as a route would put
 * a build artifact in the page surface.
 *
 * @param body the manifest response's parsed body
 * @returns one row per declared route, in payload order
 *
 * @internal
 */
export function routesInManifestBody({ body }: { body: unknown }): readonly NxCloudDeclaredRoute[] {
  if (!isRecord(body)) {
    return [];
  }
  return Object.entries(body).flatMap(([routeId, entry]): readonly NxCloudDeclaredRoute[] => {
    if (!isRecord(entry) || !("hasLoader" in entry)) {
      return [];
    }
    const path = entry["path"];
    const parentId = entry["parentId"];
    return [
      {
        index: entry["index"] === true,
        parentId: typeof parentId === "string" ? parentId : null,
        path: typeof path === "string" ? path : "",
        routeId,
      },
    ];
  });
}

/**
 * Fold every declared route seen across a whole walk into one table.
 *
 * Lazy route discovery means a later page can declare a route an earlier one did not, so the union across
 * the walk is the client's fullest declaration this run could obtain — and a run that walked fewer pages
 * honestly reports a smaller table rather than the same one.
 *
 * @param routes every route declared on every page, in walk order
 * @returns one row per route id, sorted
 */
export function foldDeclaredRoutes({
  routes,
}: {
  routes: readonly NxCloudDeclaredRoute[];
}): readonly NxCloudDeclaredRoute[] {
  const byId = new Map<string, NxCloudDeclaredRoute>();
  for (const route of routes) {
    byId.set(route.routeId, route);
  }
  return [...byId.values()].toSorted((left, right) => left.routeId.localeCompare(right.routeId));
}

/**
 * The full path PATTERN one declared route resolves to, by walking its parents.
 *
 * React Router's manifest gives each route only its own segment, so `runs` under
 * `orgs/:orgId/workspaces/:workspaceId` is `orgs/:orgId/workspaces/:workspaceId/runs` and neither half says
 * so on its own. A cycle or a missing parent stops the walk rather than looping.
 *
 * @param route the route to resolve
 * @param byId every declared route, keyed by id
 * @returns the full pattern, leading slash included
 */
export function fullRoutePattern({
  route,
  byId,
}: {
  route: NxCloudDeclaredRoute;
  byId: ReadonlyMap<string, NxCloudDeclaredRoute>;
}): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  let cursor: NxCloudDeclaredRoute | undefined = route;
  while (cursor !== undefined && !seen.has(cursor.routeId)) {
    seen.add(cursor.routeId);
    if (cursor.path !== "") {
      segments.unshift(cursor.path);
    }
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
  }
  return `/${segments.join("/")}`.replace(/\/+/g, "/");
}
