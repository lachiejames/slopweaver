/**
 * Publishing the BROWSER channel: what a walk saw, as entities, coverage and gaps.
 *
 * ## The denominator is the union of two lists, and saying which is which is the point
 *
 * A route this repository declared and walked is one kind of row; a route the CLIENT declared, which the
 * walk never opened, is another. Both are held, because an atlas whose page list is its own choice cannot
 * show that the choice was wrong — and Nx Cloud's lazy route discovery means the client's table grows as
 * the walk moves, so the two lists genuinely differ. A discovered-but-unwalked route carries
 * `unreachableBecause` saying exactly that, rather than being silently absent.
 *
 * ## Coverage is `synced` only when every walked route was reached AND photographed
 *
 * The Notion atlas's rule, adopted here for the reason it was written: a run that landed everywhere and
 * photographed nothing must not read the same as one that photographed everything. A reached page with no
 * verified artifact stops the cell being `synced` and raises its own gap.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { succeededCoverageCell } from "../kit/coverage.js";
import { type AtlasGapRecheck, openGap } from "../kit/gaps.js";

import { observedEndpointEntities, undiscoveredRouteEntities, walkedRouteEntities } from "./browserEntities.js";
import { isRouteHeld, type NxCloudBrowserWalkResult, type NxCloudRouteObservation } from "./browserObservation.js";
import type { NxCloudAtlasEntity, NxCloudAtlasGap, NxCloudAtlasKind, NxCloudCoverageCell } from "./model.js";
import { type NxCloudPublishOutcome, publishNxCloudChannel } from "./publish.js";
import { type NxCloudAtlasPaths, withNxCloudPublishLock } from "./store.js";
import { type NxCloudScope, storedCoverageCell } from "./webData.js";

/**
 * The surface name the browser channel publishes under.
 *
 * @internal
 */
export const NX_CLOUD_BROWSER_SURFACE = "browser-walk";

/** Everything one walk concluded, per kind, ready to merge. */
export interface NxCloudBrowserObservation {
  readonly entities: Readonly<Record<NxCloudAtlasKind, readonly NxCloudAtlasEntity[]>>;
  readonly coverage: Readonly<Record<NxCloudAtlasKind, readonly NxCloudCoverageCell[]>>;
  readonly gaps: readonly NxCloudAtlasGap[];
  /** How many declared routes were walked, reached and photographed — the numbers a report prints. */
  readonly counts: {
    readonly walked: number;
    readonly reached: number;
    readonly held: number;
    readonly clientDeclared: number;
  };
}

/**
 * Turn one walk into everything a publisher needs.
 *
 * @param walk what the walk produced
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns the entities, coverage, gaps and counts this walk concluded
 */
export function buildNxCloudBrowserSurface({
  walk,
  scope,
  at,
}: {
  walk: NxCloudBrowserWalkResult;
  scope: NxCloudScope;
  at: string;
}): NxCloudBrowserObservation {
  const walked = walkedRouteEntities({ at, routes: walk.routes, scope });
  const undiscovered = undiscoveredRouteEntities({
    at,
    declaredRoutes: walk.declaredRoutes,
    scope,
    walked: walk.routes.map((route) => route.pathPattern),
  });
  const endpoints = observedEndpointEntities({ at, routes: walk.routes });
  const held = walk.routes.filter((route) => isRouteHeld({ route }));
  const counts = {
    clientDeclared: walk.declaredRoutes.length,
    held: held.length,
    reached: walk.routes.filter((route) => route.unreachableBecause === null).length,
    walked: walk.routes.length,
  };
  return {
    counts,
    coverage: browserCoverage({ at, counts, endpointCount: endpoints.length, routes: walk.routes, scope }),
    entities: {
      endpoint: endpoints,
      family: [],
      organization: [],
      route: [...walked, ...undiscovered],
      workspace: [],
    },
    gaps: browserGaps({ at, scope, undiscovered, walk }),
  };
}

/**
 * Every gap one walk raises: a route refused, a route reached but unphotographed, and a route the client
 * declared that nothing has opened.
 *
 * @param walk what the walk produced
 * @param undiscovered the route entities for what the client declared and the walk skipped
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns the gaps, in the order they were found
 *
 * @internal
 */
export function browserGaps({
  walk,
  undiscovered,
  scope,
  at,
}: {
  walk: NxCloudBrowserWalkResult;
  undiscovered: readonly NxCloudAtlasEntity[];
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasGap[] {
  const routes = walk.routes.flatMap((route): readonly NxCloudAtlasGap[] => {
    if (route.unreachableBecause !== null) {
      return [
        storedRouteGap({
          at,
          condition: "route-unreachable",
          pattern: route.pathPattern,
          reason: route.unreachableBecause,
          scope,
        }),
      ];
    }
    if (route.screenshotMissingBecause === null) {
      return [];
    }
    return [
      storedRouteGap({
        at,
        condition: "route-unphotographed",
        pattern: route.pathPattern,
        reason: route.screenshotMissingBecause,
        scope,
      }),
    ];
  });
  const skipped = undiscovered.map((entity) =>
    storedRouteGap({
      at,
      condition: "route-undiscovered",
      pattern: entity.providerId,
      reason:
        "the client's own route manifest declares this route and no walk has opened it, so the atlas holds" +
        " its existence and no screenshot",
      scope,
    }),
  );
  return [...routes, ...skipped];
}

/**
 * The two coverage cells a walk earns: the route surface, and the operations it observed.
 *
 * The route cell is `synced` only when every walked route was reached AND photographed — the Notion atlas's
 * rule, for the reason it was written. The operation cell is `discovery` and never authoritative: seeing the
 * client call something establishes that it exists, and nothing about what this account may ask for.
 *
 * @param routes the walk's observations
 * @param counts what the walk reached, held and learned
 * @param endpointCount how many distinct operations it observed
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns the cells, per kind
 *
 * @internal
 */
export function browserCoverage({
  routes,
  counts,
  endpointCount,
  scope,
  at,
}: {
  routes: readonly NxCloudRouteObservation[];
  counts: NxCloudBrowserObservation["counts"];
  endpointCount: number;
  scope: NxCloudScope;
  at: string;
}): NxCloudBrowserObservation["coverage"] {
  const everythingHeld = counts.held === counts.walked && counts.walked > 0;
  const routeCell = succeededCoverageCell({
    artifacts: routes.flatMap((route) => route.artifacts),
    at,
    reason:
      `${String(counts.held)} of ${String(counts.walked)} declared route(s) reached AND photographed;` +
      ` ${String(counts.reached)} reached; the client itself declared ${String(counts.clientDeclared)}` +
      " route(s) during the walk",
    role: "authoritative",
    scope: scope.workspaceId,
    state: everythingHeld ? "synced" : "deferred",
    surface: NX_CLOUD_BROWSER_SURFACE,
    visibilityScope: "session-member-role",
  });
  const endpointCell = succeededCoverageCell({
    artifacts: [],
    at,
    reason: `${String(endpointCount)} distinct first-party operation(s) observed while the pages rendered`,
    role: "discovery",
    scope: "platform",
    state: "synced",
    surface: NX_CLOUD_BROWSER_SURFACE,
    visibilityScope: "session-member-role",
  });
  return {
    endpoint: [storedCoverageCell({ cell: endpointCell, channel: "browser" })],
    family: [],
    organization: [],
    route: [storedCoverageCell({ cell: routeCell, channel: "browser" })],
    workspace: [],
  };
}

/**
 * One route gap, in this atlas's own stored vocabulary.
 *
 * @param condition the gap condition
 * @param pattern the route pattern the gap is about
 * @param reason why, in English
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @returns the gap
 */
function storedRouteGap({
  condition,
  pattern,
  reason,
  scope,
  at,
}: {
  condition: string;
  pattern: string;
  reason: string;
  scope: NxCloudScope;
  at: string;
}): NxCloudAtlasGap {
  const gap = openGap({
    at,
    condition,
    fields: [],
    kind: "route",
    reason,
    scope: `${scope.workspaceId}:${pattern}`,
    surfaces: ["browser"],
  });
  return { ...gap, fields: [], kind: "route", surfaces: ["browser"] };
}

/**
 * Run one browser walk's result through the shared publisher.
 *
 * The walk itself is upstream of this — a caller drives the transport, then hands the result here — so the
 * publish half is testable against a fixture walk with no browser anywhere near it.
 *
 * @param paths the resolved paths
 * @param walk what the walk produced
 * @param scope the organisation and workspace walked
 * @param at this run's ISO timestamp
 * @param denylist the private organisation words
 * @returns what was written and the walk's own counts, or every reason nothing was written
 */
export function publishNxCloudBrowserSurface({
  paths,
  walk,
  scope,
  at,
  denylist,
}: {
  paths: NxCloudAtlasPaths;
  walk: NxCloudBrowserWalkResult;
  scope: NxCloudScope;
  at: string;
  denylist: readonly string[];
}): Result<{ outcome: NxCloudPublishOutcome; counts: NxCloudBrowserObservation["counts"] }> {
  const observation = buildNxCloudBrowserSurface({ at, scope, walk });
  const published = withNxCloudPublishLock({
    nowIso: at,
    paths,
    publish: () =>
      publishNxCloudChannel({
        at,
        channel: "browser",
        denylist,
        observation: { ...observation, rechecks: browserRechecks({ observation }) },
        paths,
        surface: NX_CLOUD_BROWSER_SURFACE,
      }),
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ counts: observation.counts, outcome: published.value });
}

/**
 * What a walk genuinely rechecked: every route it opened, and whether the route is now held.
 *
 * A route this walk never opened contributes nothing — `kit/gaps.ts` closes a gap on a real recheck alone,
 * and a walk that skipped a page has established nothing about it.
 *
 * @param observation what the walk concluded
 * @returns one recheck per condition this walk could speak to
 *
 * @internal
 */
export function browserRechecks({
  observation,
}: {
  observation: NxCloudBrowserObservation;
}): readonly AtlasGapRecheck[] {
  const openScopes = new Set(observation.gaps.map((gap) => `${gap.condition}:${gap.scope}`));
  return observation.entities.route.flatMap((entity): readonly AtlasGapRecheck[] =>
    (["route-unreachable", "route-unphotographed", "route-undiscovered"] as const).map((condition) => {
      const scope = routeGapScope({ entity });
      return { condition, resolved: !openScopes.has(`${condition}:${scope}`), scope };
    }),
  );
}

/**
 * The gap scope one route entity's gaps are keyed by.
 *
 * @param entity the route entity
 * @returns the `<workspaceId>:<pattern>` scope
 */
function routeGapScope({ entity }: { entity: NxCloudAtlasEntity }): string {
  return `${entity.scope}:${entity.providerId}`;
}
