/**
 * The projections for GitHub's SURFACE kinds: the compiled REST operations, and what the browser walk saw.
 *
 * The configuration kinds live in `projectionConfig.ts`, `projectionConfigExtensions.ts`,
 * `projectionEnvironment.ts` and `projectionSettings.ts` — the split is size alone. All four share
 * `projectionBase.ts`, whose header carries the rules that govern every projection here.
 */
import type { GithubAdminPage, GithubRestOperation, GithubWebRequest } from "./entities.js";
import { baseOf, type ProjectionContext } from "./projectionBase.js";
import type { GithubRestRoute } from "./restSurface.js";
import type { WebRequestObservation } from "./webReduction.js";
import type { AdminPageObservation } from "./webWalk.js";

export * from "./projectionConfig.js";
export * from "./projectionConfigExtensions.js";
export * from "./projectionEnvironment.js";
export * from "./projectionSettings.js";
export type { ProjectionContext };

/**
 * The installed Octokit's dotted method name for one route, or `null` when it declares none.
 *
 * `null` is a real answer rather than a gap: the entity schema carries `sdkMethod` as nullable, and a route the
 * published description has and the installed Octokit does not is exactly the disagreement
 * `disagreement.ts` exists to report.
 *
 * @param sdkMethods every route the installed Octokit declares a method for, keyed `METHOD /path`
 * @param route the route to look up, in the same `METHOD /path` spelling
 * @returns the method name, or `null` when Octokit declares no method for this route
 */
export function declaredSdkMethod({
  sdkMethods,
  route,
}: {
  sdkMethods: ReadonlyMap<string, string>;
  route: string;
}): string | null {
  const method = sdkMethods.get(route);
  if (method === undefined) {
    return null;
  }
  return method;
}

/**
 * Project one declared REST route into a stored operation.
 *
 * The only projection that reaches nothing: its input is GitHub's own published description, already parsed
 * by `restSurface.ts`. The scope is the platform itself, because an operation belongs to GitHub rather than
 * to any organisation of ours.
 *
 * @param route the parsed route
 * @param sdkMethod the installed Octokit's dotted method name for it, or `null` when it declares none
 * @param context the run's provenance
 * @returns the stored operation
 */
export function projectGithubRestOperation({
  route,
  sdkMethod,
  context,
}: {
  route: GithubRestRoute;
  sdkMethod: string | null;
  context: ProjectionContext;
}): GithubRestOperation {
  const [method = "GET", ...rest] = route.route.split(" ");
  return {
    ...baseOf({ context, deepLink: null, kind: "rest-operation", providerId: route.route, scopeRef: "github" }),
    documentationUrl: null,
    method,
    mutating: method !== "GET" && method !== "HEAD" && method !== "OPTIONS",
    operationId: route.operationId,
    pathParams: [...route.pathParams],
    pathTemplate: rest.join(" "),
    queryParams: [...route.queryParams],
    responseFields: [...route.responseFields],
    responseSchema: route.responseSchema,
    sdkMethod,
    summary: route.summary,
  };
}

/**
 * Project one walked admin page.
 *
 * @param page what the walk observed
 * @param scopeRef which organisation or repository the page belongs to, or the account itself
 * @param origin the web origin, used to build the deep link a human opens
 * @param context the run's provenance
 * @returns the stored page
 */
export function projectGithubAdminPage({
  page,
  scopeRef,
  origin,
  context,
}: {
  page: AdminPageObservation;
  scopeRef: string;
  origin: string;
  context: ProjectionContext;
}): GithubAdminPage {
  const base = baseOf({
    context,
    deepLink: `${origin}${page.path}`,
    kind: "admin-page",
    providerId: page.path,
    scopeRef,
  });
  return {
    ...base,
    artifacts: [...page.artifacts],
    discoveredFrom: page.discoveredFrom,
    finalUrl: page.finalUrl,
    linksRendered: [...page.linksRendered],
    outcome: page.outcome === "unphotographed" ? "failed" : page.outcome,
    path: page.path,
    scopeLevel: scopeRef.includes("/") ? "repository" : "organization",
    scopeRef,
    // A page's deep link is `browser-discovered` — it is a URL a browser actually landed on rather than one
    // a provider handed back, and that distinction is the whole reason the kit carries the field.
    source: { ...base.source, artifacts: [...page.artifacts], deepLinkStatus: "browser-discovered" },
    statusCode: page.statusCode,
    title: page.title,
  };
}

/**
 * Project one reduced web request.
 *
 * @param request the reduced observation
 * @param declaredInOpenApi whether GitHub's own published description declares a matching operation
 * @param context the run's provenance
 * @returns the stored request
 */
export function projectGithubWebRequest({
  request,
  declaredInOpenApi,
  context,
}: {
  request: WebRequestObservation;
  declaredInOpenApi: boolean;
  context: ProjectionContext;
}): GithubWebRequest {
  return {
    ...baseOf({
      context,
      deepLink: null,
      kind: "web-request",
      providerId: `${request.method} ${request.pathShape}`,
      scopeRef: "github",
    }),
    callability: "browser-observed-only",
    declaredInOpenApi,
    method: request.method,
    observedOnPages: [...request.observedOnPages],
    paramNames: [...request.paramNames],
    pathShape: request.pathShape,
    responseFieldPaths: [...request.responseFieldPaths],
    statusCodes: [...request.statusCodes],
  };
}
