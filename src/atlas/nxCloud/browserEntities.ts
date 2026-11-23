/**
 * What a walk saw, as the `route` and `endpoint` entities on the `browser` channel.
 *
 * Pure: observations in, entity records out. `browserSurface.ts` is the caller, and grades, gaps and
 * publishes what these build.
 */
import type { NxCloudRouteObservation } from "./browserObservation.js";
import type { NxCloudDeclaredRoute } from "./browserReduction.js";
import { fullRoutePattern } from "./browserReduction.js";
import { endpointEntityId, routeEntityId } from "./identity.js";
import type { NxCloudAtlasEntity, NxCloudChannelEntity, NxCloudSource } from "./model.js";
import type { NxCloudScope } from "./webData.js";

/**
 * The channel record one fresh browser observation carries.
 *
 * @param detail what this channel knows
 * @param endpoint the reproduction handle
 * @param deepLink the URL a human opens to see this, or `null` when there is none
 * @param artifacts the proof screenshots backing it
 * @param at this run's ISO timestamp
 * @returns the channel entity
 */
function browserChannel({
  detail,
  endpoint,
  deepLink,
  artifacts,
  at,
}: {
  detail: unknown;
  endpoint: string;
  deepLink: string | null;
  artifacts: NxCloudSource["artifacts"];
  at: string;
}): NxCloudChannelEntity {
  const source: NxCloudSource = {
    artifacts: artifacts.map((artifact) => ({ ...artifact })),
    channel: "browser",
    deepLink,
    // A link this walk actually drove to is `browser-discovered`, which is the state only a driven browser
    // can write and the one `kit/contract.ts` exists to distinguish from a link a provider handed back.
    deepLinkStatus: deepLink === null ? "unavailable" : "browser-discovered",
    endpoint,
    observedAt: at,
  };
  return { channel: "browser", detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/**
 * One route entity per route the walk actually opened.
 *
 * @param routes the walk's observations
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns the entities
 */
export function walkedRouteEntities({
  routes,
  scope,
  at,
}: {
  routes: readonly NxCloudRouteObservation[];
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasEntity[] {
  return routes.map((route): NxCloudAtlasEntity => {
    const detail = {
      callCount: route.calls.length,
      captureComplete: route.captureComplete,
      finalUrl: route.finalUrl === "" ? null : route.finalUrl,
      manifestRouteId: null,
      pathPattern: route.pathPattern,
      redirected: route.redirected,
      responseAccounting: { ...route.responseAccounting },
      statusCode: route.statusCode,
      title: route.title,
      unreachableBecause: route.unreachableBecause,
    };
    return {
      channels: {
        browser: browserChannel({
          artifacts: [...route.artifacts],
          at,
          deepLink: route.requestedUrl === "" ? null : route.requestedUrl,
          detail,
          endpoint: `GET ${route.pathPattern}`,
        }),
        "web-data": null,
      },
      id: routeEntityId({ pathPattern: route.pathPattern }),
      kind: "route",
      providerId: route.pathPattern,
      scope: scope.workspaceId,
    };
  });
}

/**
 * One route entity per route the CLIENT declared that the walk never opened.
 *
 * This is the half that makes the coverage claim checkable: the walk's own list is a choice this repository
 * made, and a route only the client knows about is exactly what that choice can miss.
 *
 * @param declaredRoutes the client's own route table, folded across the walk
 * @param walked every route pattern the walk opened
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns one entity per undiscovered route
 */
export function undiscoveredRouteEntities({
  declaredRoutes,
  walked,
  scope,
  at,
}: {
  declaredRoutes: readonly NxCloudDeclaredRoute[];
  walked: readonly string[];
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasEntity[] {
  const byId = new Map(declaredRoutes.map((route) => [route.routeId, route]));
  const walkedSet = new Set(walked);
  // A layout route and its own index child both resolve to the same pattern — the index route contributes
  // an empty segment — so the client's table names one address twice. Emitting both would mint two entities
  // for one route and `mergeKind` would refuse the whole publish, which is exactly the double-count that
  // check exists to catch. MEASURED: one walk of the declared pages met more than one such pair.
  const emitted = new Set<string>();
  return declaredRoutes.flatMap((route): readonly NxCloudAtlasEntity[] => {
    const pattern = fullRoutePattern({ byId, route });
    if (pattern === "/" || walkedSet.has(pattern) || emitted.has(pattern)) {
      return [];
    }
    emitted.add(pattern);
    const detail = {
      callCount: 0,
      captureComplete: false,
      finalUrl: null,
      manifestRouteId: route.routeId,
      pathPattern: pattern,
      redirected: false,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
      statusCode: null,
      title: "",
      unreachableBecause:
        "the Nx Cloud client declared this route in its own manifest and this walk never opened it — so the" +
        " atlas knows the page EXISTS and holds no screenshot of it",
    };
    return [
      {
        channels: {
          browser: browserChannel({
            artifacts: [],
            at,
            deepLink: null,
            detail,
            endpoint: `MANIFEST ${route.routeId}`,
          }),
          "web-data": null,
        },
        id: routeEntityId({ pathPattern: pattern }),
        kind: "route",
        providerId: pattern,
        scope: scope.workspaceId,
      },
    ];
  });
}

/**
 * One endpoint entity per distinct operation the walk saw, carrying which routes fired it.
 *
 * An operation is a LEAD rather than a capability: seeing the first-party client call something establishes
 * that it exists, and nothing about what this account may ask for directly. The route it fires on is what
 * makes the lead reproducible, which is why `seenOnRoutes` is carried rather than a bare count.
 *
 * @param routes the walk's observations
 * @param at this run's ISO timestamp
 * @returns one entity per operation, sorted by provider id
 */
export function observedEndpointEntities({
  routes,
  at,
}: {
  routes: readonly NxCloudRouteObservation[];
  at: string;
}): readonly NxCloudAtlasEntity[] {
  const byKey = Map.groupBy(
    routes.flatMap((route) => route.calls.map((call) => ({ call, seenOn: route.pathPattern }))),
    (sighting) => `${sighting.call.method} ${sighting.call.pathPattern}`,
  );
  return [...byKey.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, sightings]): NxCloudAtlasEntity => {
      // Non-null: `Map.groupBy` only makes a group for a sighting it has, and the first one's call is kept.
      const { call } = sightings[0]!;
      const detail = {
        callCount: sightings.length,
        loaderRouteIds: [...call.loaderRouteIds],
        queryParams: [...call.queryParams],
        responseFields: [...call.responseFields],
        seenOnRoutes: [...new Set(sightings.map((sighting) => sighting.seenOn))].toSorted(),
        statusCode: call.statusCode,
      };
      return {
        channels: {
          browser: browserChannel({ artifacts: [], at, deepLink: null, detail, endpoint: key }),
          "web-data": null,
        },
        id: endpointEntityId({ method: call.method, pathPattern: call.pathPattern }),
        kind: "endpoint",
        providerId: key,
        scope: "platform",
      };
    });
}
