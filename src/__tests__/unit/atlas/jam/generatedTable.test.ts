/**
 * The committed tables, and the invariants a publish depends on them holding.
 *
 * These assert the SHAPE the atlas relies on rather than restating the generator's census — the census is
 * `tools/generateJamSurfaces.ts --verify`'s job and duplicating it here would be two copies of one number.
 * What is here is what would silently corrupt a published generation instead of failing: a control row that
 * has stopped proving the probe's negative fires, and a scope table whose join to the operations is wrong.
 */
import { describe, expect, it } from "vitest";

import { JAM_CENSUS, JAM_SPEC_PINS } from "../../../../atlas/jam/generated/specLock.js";
import { JAM_INTEGRATIONS, JAM_OPERATIONS, JAM_ROUTES, JAM_SCOPES } from "../../../../atlas/jam/generated/surfaces.js";
import { JAM_CONTROL_PATH, jamRouteVerdictFor } from "../../../../atlas/jam/routeProbe.js";

describe("the probe's control", () => {
  it("has at least one entry in JAM_ROUTES, so the guards below are not vacuously green", () => {
    expect(JAM_ROUTES.length).toBeGreaterThan(0);
  });

  it("asks both hosts for a path that cannot exist", () => {
    const controls = JAM_ROUTES.filter((route) => route.control);
    expect(controls.length).toBe(2);
    expect(new Set(controls.map((route) => route.host)).size).toBe(2);
    expect(new Set(controls.map((route) => route.path))).toEqual(new Set([JAM_CONTROL_PATH]));
  });

  it("graded not-routed on every host, which is what makes the negative evidence", () => {
    const verdicts = JAM_ROUTES.filter((route) => route.control).map((route) => route.verdict);
    expect(verdicts).toEqual(["not-routed", "not-routed"]);
  });

  it("agrees with the oracle applied to its own recorded status and content type", () => {
    for (const route of JAM_ROUTES) {
      expect(jamRouteVerdictFor({ contentType: route.contentType, statusCode: route.statusCode })).toBe(route.verdict);
    }
  });
});

describe("the published description", () => {
  it("declares no operation returning a product noun, which is this atlas's sharpest finding", () => {
    const productNouns = ["jam", "team", "member", "recording", "integration"];
    const productOperations = JAM_OPERATIONS.filter((operation) =>
      productNouns.some((noun) => operation.path.toLowerCase().includes(noun)),
    );
    expect(productOperations).toEqual([]);
  });

  it("sends every operation to the one server the document declares", () => {
    expect(new Set(JAM_OPERATIONS.map((operation) => operation.serverUrl))).toEqual(new Set(["https://api.jam.dev"]));
  });

  it("marks every non-GET operation uncallable with a stated reason", () => {
    for (const operation of JAM_OPERATIONS.filter((row) => row.method !== "GET")) {
      expect(operation.callable).toBe(false);
      expect(operation.excludedBecause).toContain("write");
    }
  });
});

describe("the declared scopes", () => {
  it("are named by no published operation at all", () => {
    expect(JAM_SCOPES.filter((scope) => scope.namedBy.length > 0)).toEqual([]);
    expect(JAM_SCOPES.length).toBe(JAM_CENSUS.scopesNamedByNoOperation);
  });

  it("are claimed by the api resource document and only two by the mcp one", () => {
    const claimedByApi = JAM_SCOPES.filter((scope) => scope.claimedByResources.includes("api-protected-resource"));
    const claimedByMcp = JAM_SCOPES.filter((scope) => scope.claimedByResources.includes("mcp-protected-resource"));
    expect(claimedByApi.length).toBe(4);
    expect(claimedByMcp.map((scope) => scope.scope)).toEqual(["mcp:read", "mcp:write"]);
  });
});

describe("the lock", () => {
  it("pins four documents, each at its own address, with no duplicate id", () => {
    expect(JAM_SPEC_PINS.length).toBe(4);
    expect(new Set(JAM_SPEC_PINS.map((pin) => pin.id)).size).toBe(4);
    expect(new Set(JAM_SPEC_PINS.map((pin) => pin.url)).size).toBe(4);
  });

  it("records a sha256 of the right length for every document", () => {
    for (const pin of JAM_SPEC_PINS) {
      expect(pin.sha256.length).toBe(64);
      expect(pin.byteLength).toBeGreaterThan(0);
    }
  });
});

describe("the published integrations", () => {
  it("carry a slug and its own published page address", () => {
    expect(JAM_INTEGRATIONS.length).toBe(JAM_CENSUS.integrations);
    for (const integration of JAM_INTEGRATIONS) {
      expect(integration.pageUrl).toBe(`https://jam.dev/integrations/${integration.slug}`);
    }
  });
});
