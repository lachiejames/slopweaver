import { describe, expect, it } from "vitest";

import {
  declaredRoutesFrom,
  foldDeclaredRoutes,
  fullRoutePattern,
  type NxCloudDeclaredRoute,
  patternOfPath,
  reduceNxCloudCalls,
} from "../../../../atlas/nxCloud/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

const ORIGIN = "https://cloud.nx.app";

/** One `__manifest` response, in the shape React Router's own lazy route discovery answers with. */
const MANIFEST_RESPONSE: CapturedResponse = {
  body: {
    "routes/_auth": { hasLoader: true, parentId: "root", path: "" },
    "routes/_auth.orgs.$orgId": { hasLoader: true, parentId: "routes/_auth", path: "orgs/:orgId" },
    "routes/_auth.orgs.$orgId.workspaces.$workspaceId.runs": {
      hasLoader: true,
      parentId: "routes/_auth.orgs.$orgId.workspaces.$workspaceId",
      path: "runs",
    },
    "routes/_auth.orgs.$orgId.workspaces.$workspaceId": {
      hasLoader: true,
      parentId: "routes/_auth.orgs.$orgId",
      path: "workspaces/:workspaceId",
    },
  },
  method: "GET",
  statusCode: 200,
  url: `${ORIGIN}/__manifest?paths=%2Forgs&version=4d55d2bf`,
};

describe("patternOfPath", () => {
  it("replaces an object id segment", () => {
    expect(patternOfPath({ pathname: "/orgs/0000000000000000000000a1/workspaces" })).toBe("/orgs/<id>/workspaces");
  });

  it("replaces a run id segment", () => {
    expect(patternOfPath({ pathname: "/runs/XI4wt4hiBm" })).toBe("/runs/<rid>");
  });

  it("leaves a path of plain names alone", () => {
    expect(patternOfPath({ pathname: "/profile/tokens" })).toBe("/profile/tokens");
  });
});

describe("reduceNxCloudCalls", () => {
  it("keeps one row per distinct operation, however many times a page made it", () => {
    const responses: readonly CapturedResponse[] = [
      { body: { a: 1 }, method: "GET", statusCode: 200, url: `${ORIGIN}/orgs/aaaaaaaaaaaaaaaaaaaaaaaa/x.data` },
      { body: { b: 2 }, method: "GET", statusCode: 200, url: `${ORIGIN}/orgs/bbbbbbbbbbbbbbbbbbbbbbbb/x.data` },
    ];
    expect(reduceNxCloudCalls({ origin: ORIGIN, responses }).length).toBe(1);
  });

  it("unions the response field names across every call to one operation", () => {
    const responses: readonly CapturedResponse[] = [
      { body: { a: 1 }, method: "GET", statusCode: 200, url: `${ORIGIN}/orgs/aaaaaaaaaaaaaaaaaaaaaaaa/x.data` },
      { body: { b: 2 }, method: "GET", statusCode: 200, url: `${ORIGIN}/orgs/bbbbbbbbbbbbbbbbbbbbbbbb/x.data` },
    ];
    expect(reduceNxCloudCalls({ origin: ORIGIN, responses })[0]!.responseFields).toEqual(["a", "b"]);
  });

  it("keeps query parameter names and never a value", () => {
    const responses: readonly CapturedResponse[] = [
      { body: {}, method: "GET", statusCode: 200, url: `${ORIGIN}/x.data?dayCount=7&branch=main` },
    ];
    const row = reduceNxCloudCalls({ origin: ORIGIN, responses })[0]!;
    expect(row.queryParams).toEqual(["branch", "dayCount"]);
  });

  it("drops a response from another origin, because the walk observes what NX CLOUD asks for", () => {
    const responses: readonly CapturedResponse[] = [
      { body: {}, method: "POST", statusCode: 200, url: "https://api.example-analytics.com/e/" },
    ];
    expect(reduceNxCloudCalls({ origin: ORIGIN, responses })).toEqual([]);
  });

  it("drops a URL it cannot parse rather than throwing the whole reduction", () => {
    const responses: readonly CapturedResponse[] = [{ body: {}, method: "GET", statusCode: 200, url: "not-a-url" }];
    expect(reduceNxCloudCalls({ origin: ORIGIN, responses })).toEqual([]);
  });

  it("records the loader route ids a single-fetch payload named", () => {
    const responses: readonly CapturedResponse[] = [
      { body: { "routes/_auth": {} }, method: "GET", statusCode: 200, url: `${ORIGIN}/x.data` },
    ];
    expect(reduceNxCloudCalls({ origin: ORIGIN, responses })[0]!.loaderRouteIds).toEqual(["routes/_auth"]);
  });
});

describe("declaredRoutesFrom", () => {
  it("reads the client's own route table out of a manifest response", () => {
    expect(declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] }).length).toBe(4);
  });

  it("carries each route's parent, which is what makes a full pattern resolvable", () => {
    const routes = declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] });
    expect(routes.find((route) => route.routeId === "routes/_auth.orgs.$orgId")!.parentId).toBe("routes/_auth");
  });

  it("ignores a response that is not a manifest", () => {
    const other: CapturedResponse = { body: { a: 1 }, method: "GET", statusCode: 200, url: `${ORIGIN}/x.data` };
    expect(declaredRoutesFrom({ responses: [other] })).toEqual([]);
  });

  it("drops a manifest entry that does not look like a route entry", () => {
    const odd: CapturedResponse = {
      body: { version: "4d55d2bf" },
      method: "GET",
      statusCode: 200,
      url: `${ORIGIN}/__manifest?p=%2F`,
    };
    expect(declaredRoutesFrom({ responses: [odd] })).toEqual([]);
  });
});

describe("foldDeclaredRoutes", () => {
  it("keeps one row per route id across the whole walk", () => {
    const routes = [...declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] })];
    expect(foldDeclaredRoutes({ routes: [...routes, ...routes] }).length).toBe(4);
  });

  it("sorts by route id, so two runs over the same data write identical bytes", () => {
    const folded = foldDeclaredRoutes({ routes: declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] }) });
    expect(folded.map((route) => route.routeId)).toEqual([
      "routes/_auth",
      "routes/_auth.orgs.$orgId",
      "routes/_auth.orgs.$orgId.workspaces.$workspaceId",
      "routes/_auth.orgs.$orgId.workspaces.$workspaceId.runs",
    ]);
  });
});

describe("fullRoutePattern", () => {
  it("resolves a nested route by walking its parents", () => {
    const routes = declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] });
    const byId = new Map(routes.map((route) => [route.routeId, route]));
    const runs = routes.find((route) => route.routeId.endsWith(".runs"))!;
    expect(fullRoutePattern({ byId, route: runs })).toBe("/orgs/:orgId/workspaces/:workspaceId/runs");
  });

  it("resolves a layout route with no path of its own to the root", () => {
    const routes = declaredRoutesFrom({ responses: [MANIFEST_RESPONSE] });
    const byId = new Map(routes.map((route) => [route.routeId, route]));
    expect(fullRoutePattern({ byId, route: byId.get("routes/_auth")! })).toBe("/");
  });

  it("stops rather than looping when a route's parent chain cycles", () => {
    const cyclic: readonly NxCloudDeclaredRoute[] = [
      { index: false, parentId: "b", path: "a", routeId: "a" },
      { index: false, parentId: "a", path: "b", routeId: "b" },
    ];
    const byId = new Map(cyclic.map((route) => [route.routeId, route]));
    expect(fullRoutePattern({ byId, route: cyclic[0]! })).toBe("/b/a");
  });

  it("stops at a parent the manifest never declared", () => {
    const orphan: NxCloudDeclaredRoute = { index: false, parentId: "missing", path: "runs", routeId: "r" };
    expect(fullRoutePattern({ byId: new Map(), route: orphan })).toBe("/runs");
  });
});
