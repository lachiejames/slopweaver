import { describe, expect, it } from "vitest";

import {
  observedEndpointEntities,
  undiscoveredRouteEntities,
  walkedRouteEntities,
} from "../../../../atlas/nxCloud/browserEntities.js";
import type {
  NxCloudBrowserWalkResult,
  NxCloudRouteObservation,
} from "../../../../atlas/nxCloud/browserObservation.js";
import type { NxCloudDeclaredRoute } from "../../../../atlas/nxCloud/browserReduction.js";
import { buildNxCloudBrowserSurface } from "../../../../atlas/nxCloud/browserSurface.js";

const AT = "2026-09-05T00:00:00.000Z";
const SCOPE = { orgId: "aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: "bbbbbbbbbbbbbbbbbbbbbbbb" };

/** One walked route observation, healthy unless the caller says otherwise. */
function route({
  pattern,
  over = {},
}: {
  pattern: string;
  over?: Partial<NxCloudRouteObservation>;
}): NxCloudRouteObservation {
  return {
    artifacts: [
      {
        byteLength: 4,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: `a/${pattern}.png`,
        sha256: "a".repeat(64),
      },
    ],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `https://cloud.nx.app${pattern}`,
    observedAt: AT,
    pathPattern: pattern,
    redirected: false,
    requestedUrl: `https://cloud.nx.app${pattern}`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 1, eligible: 1, seen: 1 },
    screenshotMissingBecause: null,
    statusCode: 200,
    title: "Overview",
    unreachableBecause: null,
    ...over,
  };
}

/** The declared route table, in the shape the client's own manifest hands back. */
const DECLARED: readonly NxCloudDeclaredRoute[] = [
  { index: false, parentId: null, path: "", routeId: "root" },
  { index: false, parentId: "root", path: "profile/tokens", routeId: "routes/_auth.profile.tokens" },
  { index: false, parentId: "root", path: "cipes/:cipeId", routeId: "routes/_auth.cipes.$cipeId" },
  { index: true, parentId: "routes/_auth.cipes.$cipeId", path: "", routeId: "routes/_auth.cipes.$cipeId._index" },
];

function walk({ over = {} }: { over?: Partial<NxCloudBrowserWalkResult> } = {}): NxCloudBrowserWalkResult {
  return { declaredRoutes: DECLARED, routes: [route({ pattern: "/profile/tokens" })], sessionLost: false, ...over };
}

describe("walkedRouteEntities", () => {
  it("keys a route by its declared path pattern", () => {
    const entities = walkedRouteEntities({ at: AT, routes: [route({ pattern: "/orgs" })], scope: SCOPE });
    expect(entities[0]!.providerId).toBe("/orgs");
  });

  it("records a link the walk actually drove to as browser-discovered", () => {
    const entities = walkedRouteEntities({ at: AT, routes: [route({ pattern: "/orgs" })], scope: SCOPE });
    expect(entities[0]!.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("carries the screenshot as an artifact on the record's own source", () => {
    const entities = walkedRouteEntities({ at: AT, routes: [route({ pattern: "/orgs" })], scope: SCOPE });
    expect(entities[0]!.channels.browser!.source!.artifacts.length).toBe(1);
  });

  it("writes nothing at all into the web-data channel", () => {
    const entities = walkedRouteEntities({ at: AT, routes: [route({ pattern: "/orgs" })], scope: SCOPE });
    expect(entities[0]!.channels["web-data"]).toBe(null);
  });
});

describe("undiscoveredRouteEntities", () => {
  it("holds a route the client declared and the walk never opened", () => {
    const entities = undiscoveredRouteEntities({ at: AT, declaredRoutes: DECLARED, scope: SCOPE, walked: [] });
    expect(entities.map((entity) => entity.providerId).toSorted()).toEqual(["/cipes/:cipeId", "/profile/tokens"]);
  });

  it("says WHY it holds no screenshot of one", () => {
    const entities = undiscoveredRouteEntities({ at: AT, declaredRoutes: DECLARED, scope: SCOPE, walked: [] });
    const detail = entities[0]!.channels.browser!.detail as { unreachableBecause: string };
    expect(detail.unreachableBecause).toContain("never opened it");
  });

  it("omits a route the walk did open", () => {
    const entities = undiscoveredRouteEntities({
      at: AT,
      declaredRoutes: DECLARED,
      scope: SCOPE,
      walked: ["/profile/tokens"],
    });
    expect(entities.map((entity) => entity.providerId)).toEqual(["/cipes/:cipeId"]);
  });

  it("emits ONE entity when a layout route and its index child collapse to the same address", () => {
    const entities = undiscoveredRouteEntities({ at: AT, declaredRoutes: DECLARED, scope: SCOPE, walked: [] });
    expect(entities.filter((entity) => entity.providerId === "/cipes/:cipeId").length).toBe(1);
  });

  it("never holds the bare root as a route of its own", () => {
    const entities = undiscoveredRouteEntities({ at: AT, declaredRoutes: DECLARED, scope: SCOPE, walked: [] });
    expect(entities.some((entity) => entity.providerId === "/")).toBe(false);
  });
});

describe("observedEndpointEntities", () => {
  it("names which walked routes fired an operation, so the lead is reproducible", () => {
    const call = {
      loaderRouteIds: [],
      method: "GET",
      pathPattern: "/orgs/<id>/workspaces/<id>/runs.data",
      queryParams: [],
      responseFields: ["runs[]"],
      statusCode: 200,
    };
    const entities = observedEndpointEntities({
      at: AT,
      routes: [route({ over: { calls: [call] }, pattern: "/a" }), route({ over: { calls: [call] }, pattern: "/b" })],
    });
    const detail = entities[0]!.channels.browser!.detail as { seenOnRoutes: readonly string[] };
    expect(detail.seenOnRoutes).toEqual(["/a", "/b"]);
  });

  it("counts how many pages made the call", () => {
    const call = {
      loaderRouteIds: [],
      method: "GET",
      pathPattern: "/x.data",
      queryParams: [],
      responseFields: [],
      statusCode: 200,
    };
    const entities = observedEndpointEntities({
      at: AT,
      routes: [route({ over: { calls: [call] }, pattern: "/a" }), route({ over: { calls: [call] }, pattern: "/b" })],
    });
    const detail = entities[0]!.channels.browser!.detail as { callCount: number };
    expect(detail.callCount).toBe(2);
  });
});

describe("buildNxCloudBrowserSurface", () => {
  it("grades the route surface synced when every walked route was reached and photographed", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk() });
    expect(built.coverage.route[0]!.state).toBe("synced");
  });

  it("grades it DEFERRED when a route was reached and not photographed", () => {
    const unphotographed = route({
      over: { artifacts: [], screenshotMissingBecause: "the browser returned no screenshot" },
      pattern: "/profile/tokens",
    });
    const built = buildNxCloudBrowserSurface({
      at: AT,
      scope: SCOPE,
      walk: walk({ over: { routes: [unphotographed] } }),
    });
    expect(built.coverage.route[0]!.state).toBe("deferred");
  });

  it("raises a gap for a route the account was refused", () => {
    const refused = route({ over: { unreachableBecause: "HTTP 403: role does not reach it" }, pattern: "/settings" });
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk({ over: { routes: [refused] } }) });
    expect(built.gaps.map((gap) => gap.condition)).toContain("route-unreachable");
  });

  it("raises a gap for a route the client declared and the walk never opened", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk() });
    expect(built.gaps.map((gap) => gap.condition)).toContain("route-undiscovered");
  });

  it("counts what was walked, reached, held and declared, which is what a report prints", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk() });
    expect(built.counts).toEqual({ clientDeclared: 4, held: 1, reached: 1, walked: 1 });
  });

  it("gives the observed-operation cell the DISCOVERY role, never authoritative", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk() });
    expect(built.coverage.endpoint[0]!.role).toBe("discovery");
  });

  it("writes no organisation or workspace rows at all, because the other channel owns those kinds", () => {
    const built = buildNxCloudBrowserSurface({ at: AT, scope: SCOPE, walk: walk() });
    expect([built.entities.organization, built.entities.workspace, built.entities.family]).toEqual([[], [], []]);
  });
});
