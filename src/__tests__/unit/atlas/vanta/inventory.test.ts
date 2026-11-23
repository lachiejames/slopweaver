import { describe, expect, it } from "vitest";

import { VANTA_CENSUS_FAMILIES, VANTA_CENSUS_FAMILY_LIST } from "../../../../atlas/vanta/census.js";
import { VANTA_CHILD_FAMILIES } from "../../../../atlas/vanta/childCensus.js";
import {
  VANTA_EVENT_LOGS_SURFACE,
  VANTA_MANAGE_ENDPOINTS,
  VANTA_OUT_OF_SCOPE_GROUPS,
  type VantaListedManageSurface,
  vantaCensusEndpoint,
  vantaControlDetailEndpoint,
  vantaControlTestsEndpoint,
  vantaFrameworksEndpoint,
  vantaManageEndpointFor,
  vantaRequiredSurfacesForKind,
  vantaTestEntitiesEndpoint,
  vantaVulnerabilitiesEndpoint,
  vantaVulnerabilityDetailEndpoint,
} from "../../../../atlas/vanta/inventory.js";
import { VANTA_KINDS } from "../../../../atlas/vanta/model.js";
import { VANTA_POLICY_DOCUMENT_KIND, VANTA_POLICY_DOCUMENT_SURFACE } from "../../../../atlas/vanta/policyDocuments.js";
import { VantaSyncErrors } from "../../../../atlas/vanta/syncErrors.js";
import { roleFor } from "../../../../atlas/vanta/syncKind.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("vantaManageEndpointFor", () => {
  it("resolves a known surface", () => {
    expect(vantaManageEndpointFor({ surface: "controls-active" })).toEqual({
      fixedQuery: {},
      method: "GET",
      path: "/v1/controls",
    });
  });

  // The lookup is total over its closed key type; a browser-only surface has no endpoint and cannot be asked.
  it("refuses a surface with no Manage API endpoint at compile time, and holds no entry for it", () => {
    // @ts-expect-error -- "audits-collection" is a browser-only surface, not a listed Manage API surface
    const browserOnly: VantaListedManageSurface = "audits-collection";
    expect(Object.hasOwn(VANTA_MANAGE_ENDPOINTS, browserOnly)).toBe(false);
  });

  it("carries the type filter that distinguishes risk-scenario from enterprise-risk", () => {
    expect(vantaManageEndpointFor({ surface: "risks-risk-scenario" }).fixedQuery).toEqual({ type: "Risk Scenario" });
    expect(vantaManageEndpointFor({ surface: "risks-enterprise-risk" }).fixedQuery).toEqual({
      type: "Enterprise Risk",
    });
  });

  it("resolves every census family through its own row, and the combined record agrees", () => {
    expect(VANTA_CENSUS_FAMILY_LIST.length).toBeGreaterThan(0);
    expect(
      VANTA_CENSUS_FAMILY_LIST.filter(
        (family) =>
          vantaCensusEndpoint({ family }).path !== family.path ||
          VANTA_MANAGE_ENDPOINTS[family.surface]?.path !== family.path,
      ).map((family) => family.surface),
    ).toStrictEqual([]);
  });
});

describe("roleFor", () => {
  it("resolves every manage-api surface the inventory declares, for every kind", () => {
    const declared = VANTA_KINDS.flatMap((kind) =>
      vantaRequiredSurfacesForKind({ kind })
        .filter((row) => row.channel === "manage-api")
        .map((row) => ({ kind, role: row.role, surface: row.surface })),
    );
    expect(declared.length).toBeGreaterThan(0);
    expect(
      declared.filter((row) => unwrap(roleFor({ kind: row.kind, surface: row.surface })) !== row.role),
    ).toStrictEqual([]);
  });

  it("refuses a pair no manage-api row declares, so an unknown surface is never graded authoritative", () => {
    const error = unwrapErr(roleFor({ kind: "policy", surface: "vendors-list" }));
    expect(error).toEqual(VantaSyncErrors.surfaceUndeclared({ kind: "policy", surface: "vendors-list" }));
  });

  // Read against the inventory's own rows as a second, independent witness to what `roleFor` answers.
  const declaresManageRow = ({ kind, surface }: { kind: (typeof VANTA_KINDS)[number]; surface: string }): boolean =>
    vantaRequiredSurfacesForKind({ kind }).some((row) => row.surface === surface && row.channel === "manage-api");

  it("declares every literal pair the syncs pass", () => {
    const literalCallSitePairs = [
      { kind: "control", surface: "controls-active" },
      { kind: "control", surface: "controls-deactivated" },
      { kind: "risk", surface: "risks-risk-scenario" },
      { kind: "risk", surface: "risks-enterprise-risk" },
      { kind: "evidence", surface: "evidence-documents" },
      { kind: "policy", surface: "policies-list" },
      { kind: "vendor", surface: "vendors-list" },
      { kind: "event-shape", surface: VANTA_EVENT_LOGS_SURFACE },
      { kind: VANTA_POLICY_DOCUMENT_KIND, surface: VANTA_POLICY_DOCUMENT_SURFACE },
    ] as const;
    expect(literalCallSitePairs.filter((pair) => !declaresManageRow(pair))).toStrictEqual([]);
  });

  it("declares every census and child family pair the fan-out syncs pass", () => {
    const familyPairs = [
      ...Object.values(VANTA_CENSUS_FAMILIES).map((family) => ({ kind: family.kind, surface: family.surface })),
      ...Object.values(VANTA_CHILD_FAMILIES).flatMap((family) =>
        family.surfaces.map((surface) => ({ kind: family.kind, surface: surface.surface })),
      ),
    ];
    expect(familyPairs.length).toBeGreaterThan(0);
    expect(familyPairs.filter((pair) => !declaresManageRow(pair))).toStrictEqual([]);
  });

  it("declares no manage-api row for a pair no sync passes", () => {
    const manageRows = ({ kind }: { kind: "policy" | "audit" }): readonly string[] =>
      vantaRequiredSurfacesForKind({ kind })
        .filter((row) => row.channel === "manage-api")
        .map((row) => row.surface);
    expect(manageRows({ kind: "policy" })).toStrictEqual(["policies-list"]);
    expect(manageRows({ kind: "audit" })).toStrictEqual([]);
  });
});

describe("per-id endpoint builders", () => {
  it("URL-encodes the control id", () => {
    expect(vantaControlDetailEndpoint({ controlId: "a/b" }).path).toBe("/v1/controls/a%2Fb");
  });

  it("builds the control-tests endpoint", () => {
    expect(vantaControlTestsEndpoint({ controlId: "c1" }).path).toBe("/v1/controls/c1/tests");
  });

  it("builds the test-entities endpoint with no status filter, which Vanta answers as FAILING", () => {
    expect(vantaTestEntitiesEndpoint({ entityStatus: null, testId: "t1" })).toEqual({
      fixedQuery: {},
      method: "GET",
      path: "/v1/tests/t1/entities",
    });
  });

  it("sends entityStatus under the spec's own parameter name when one is asked for", () => {
    expect(vantaTestEntitiesEndpoint({ entityStatus: "DEACTIVATED", testId: "t/1" })).toEqual({
      fixedQuery: { entityStatus: "DEACTIVATED" },
      method: "GET",
      path: "/v1/tests/t%2F1/entities",
    });
  });

  it("builds the frameworks endpoint with no params", () => {
    expect(vantaFrameworksEndpoint()).toEqual({ fixedQuery: {}, method: "GET", path: "/v1/frameworks" });
  });
});

describe("vantaRequiredSurfacesForKind", () => {
  it("returns only the surfaces for the requested kind", () => {
    const surfaces = vantaRequiredSurfacesForKind({ kind: "vendor" });
    expect(surfaces.every((surface) => surface.kind === "vendor")).toBe(true);
    expect(surfaces.length).toBeGreaterThan(0);
  });

  it("audit has no manage-api surface, only a browser one", () => {
    const surfaces = vantaRequiredSurfacesForKind({ kind: "audit" });
    expect(surfaces.map((surface) => surface.channel)).toEqual(["browser"]);
  });

  // This test used to assert the policy body was a BROWSER surface "because no Manage
  // API route holds one" — which was established from nine guessed routes that answered 404, not from
  // Vanta's own published document. `GET /v1/knowledge-base/resources` holds every one of them.
  it("declares the policy document as an authoritative manage-api surface, reached through the knowledge base", () => {
    const body = vantaRequiredSurfacesForKind({ kind: "policy-document" }).find(
      (surface) => surface.surface === "knowledge-base-resources",
    )!;
    expect(body.channel).toBe("manage-api");
    expect(body.role).toBe("authoritative");
    expect(vantaManageEndpointFor({ surface: "knowledge-base-resources" }).path).toBe("/v1/knowledge-base/resources");
  });

  it("leaves the policy list's own role alone, so declaring the body changes no synced surface", () => {
    expect(unwrap(roleFor({ kind: "policy", surface: "policies-list" }))).toBe("authoritative");
  });
});

describe("VANTA_OUT_OF_SCOPE_GROUPS", () => {
  it("names a measured reason for every family it does not hold", () => {
    expect(VANTA_OUT_OF_SCOPE_GROUPS.length).toBe(5);
    expect(VANTA_OUT_OF_SCOPE_GROUPS[0]).toContain("GET /v1/audits answers HTTP 403");
    expect(VANTA_OUT_OF_SCOPE_GROUPS[1]).toContain("GET /v1/contracts answers HTTP 403");
  });

  it("no longer excludes integration resources, because the fan-out holds them whole", () => {
    expect(VANTA_OUT_OF_SCOPE_GROUPS.filter((entry) => entry.includes("resource-kinds/{kind}/resources"))).toEqual([]);
  });

  it("no longer excludes vulnerabilities, because the census stores them", () => {
    expect(VANTA_OUT_OF_SCOPE_GROUPS.filter((entry) => entry.startsWith("vulnerabilities"))).toEqual([]);
  });
});

describe("vantaVulnerabilitiesEndpoint", () => {
  it("sends no filter params when the caller asked for everything", () => {
    const endpoint = vantaVulnerabilitiesEndpoint({
      filters: { isDeactivated: null, isFixAvailable: null, severity: null },
    });
    expect(endpoint.path).toBe("/v1/vulnerabilities");
    expect(endpoint.method).toBe("GET");
    expect(endpoint.fixedQuery).toEqual({});
  });

  it("folds every supplied filter into the fixed query, so pagination.ts still owns the cursor params", () => {
    const endpoint = vantaVulnerabilitiesEndpoint({
      filters: { isDeactivated: false, isFixAvailable: true, severity: "CRITICAL" },
    });
    expect(endpoint.fixedQuery).toEqual({ isDeactivated: "false", isFixAvailable: "true", severity: "CRITICAL" });
  });
});

describe("vantaVulnerabilityDetailEndpoint", () => {
  it("encodes the finding id into the path", () => {
    expect(vantaVulnerabilityDetailEndpoint({ vulnerabilityId: "a/b" }).path).toBe("/v1/vulnerabilities/a%2Fb");
  });
});
