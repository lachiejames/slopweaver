/**
 * The committed Chronicle v1 inventory, checked against the properties the generator asserts at write time.
 *
 * These duplicate `tools/generateGoogleSecopsSurfaces.ts --verify` on purpose, as the Google Admin sibling
 * does: the tool runs when somebody remembers to run it, the unit lane runs on every push, and the failure
 * this guards against is a hand-edited row — exactly the edit nobody re-runs a generator after.
 */
import { describe, expect, it } from "vitest";

import { googleSecopsDispositionFor } from "../../../../atlas/googleSecops/dispositions.js";
import {
  GOOGLE_SECOPS_INVENTORY_CENSUS,
  GOOGLE_SECOPS_PINS,
  GOOGLE_SECOPS_PROTO_COMMIT,
  GOOGLE_SECOPS_UNPUBLISHED_SERVICES,
} from "../../../../atlas/googleSecops/generated/protoLock.js";
import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import {
  CHRONICLE_READONLY_SCOPE,
  CLOUD_PLATFORM_SCOPE,
  googleSecopsCensusMatches,
  googleSecopsInventoryCensus,
  googleSecopsScopeClass,
} from "../../../../atlas/googleSecops/inventory.js";
import { unwrap } from "../../../../lib/result.js";

const ENTITIES = GOOGLE_SECOPS_SURFACES.filter((row) => row.disposition === "entity");

describe("the committed Google SecOps inventory", () => {
  it("holds exactly the census protoLock pins", () => {
    expect(GOOGLE_SECOPS_SURFACES.length).toBeGreaterThan(0);
    const census = googleSecopsInventoryCensus({ rows: GOOGLE_SECOPS_SURFACES });
    expect(census).toStrictEqual(GOOGLE_SECOPS_INVENTORY_CENSUS);
    expect(googleSecopsCensusMatches({ census, pinned: GOOGLE_SECOPS_INVENTORY_CENSUS }).isOk()).toBe(true);
  });

  it("holds 92 published methods, 39 of them GETs and every GET an entity", () => {
    expect(GOOGLE_SECOPS_SURFACES.length).toBe(92);
    expect(GOOGLE_SECOPS_INVENTORY_CENSUS.byHttpMethod).toStrictEqual({
      DELETE: 9,
      GET: 39,
      PATCH: 12,
      POST: 32,
      PUT: 0,
    });
    expect(GOOGLE_SECOPS_INVENTORY_CENSUS.byDisposition).toStrictEqual({ entity: 39, excluded: 53, "probe-only": 0 });
    expect(GOOGLE_SECOPS_INVENTORY_CENSUS.byExclusionReason).toStrictEqual({ mutating: 48, query: 5 });
  });

  it("splits the 39 reads 21 under chronicle.readonly and 18 under cloud-platform only", () => {
    expect(GOOGLE_SECOPS_INVENTORY_CENSUS.entitiesByScopeClass).toStrictEqual({
      "chronicle-readonly": 21,
      "cloud-platform-only": 18,
      other: 0,
    });
    const platformOnly = ENTITIES.filter(
      (row) => googleSecopsScopeClass({ scopes: row.scopes }) === "cloud-platform-only",
    );
    expect([...new Set(platformOnly.map((row) => row.service))].toSorted()).toStrictEqual([
      "google.cloud.chronicle.v1.DataAccessControlService",
      "google.cloud.chronicle.v1.EntityService",
      "google.cloud.chronicle.v1.InstanceService",
      "google.cloud.chronicle.v1.ReferenceListService",
      "google.cloud.chronicle.v1.RuleService",
      "google.longrunning.Operations",
    ]);
    expect(platformOnly.every((row) => row.scopes.length === 1 && row.scopes[0] === CLOUD_PLATFORM_SCOPE)).toBe(true);
  });

  it("names the five POST reads it still never calls", () => {
    expect(
      GOOGLE_SECOPS_SURFACES.filter((row) => row.exclusionReason === "query")
        .map((row) => row.id)
        .toSorted(),
    ).toStrictEqual([
      "google.cloud.chronicle.v1.DataTableService.BulkGetDataTableRows",
      "google.cloud.chronicle.v1.FindingsRefinementService.ComputeAllFindingsRefinementActivities",
      "google.cloud.chronicle.v1.FindingsRefinementService.ComputeFindingsRefinementActivity",
      "google.cloud.chronicle.v1.ReferenceListService.VerifyReferenceList",
      "google.cloud.chronicle.v1.RuleService.VerifyRuleText",
    ]);
  });

  it("records that the readonly scope is granted to writes too, so the scope never decides a disposition", () => {
    const readonlyWrites = GOOGLE_SECOPS_SURFACES.filter(
      (row) => row.exclusionReason === "mutating" && row.scopes.includes(CHRONICLE_READONLY_SCOPE),
    );
    expect(readonlyWrites.length).toBe(30);
    expect(readonlyWrites.map((row) => row.id)).toContain("google.cloud.chronicle.v1.FeedsService.GenerateSecret");
  });

  it("derives every stored disposition from the rules, not from the file", () => {
    for (const row of GOOGLE_SECOPS_SURFACES) {
      const verdict = unwrap(googleSecopsDispositionFor({ httpMethod: row.httpMethod, id: row.id, rpc: row.rpc }));
      expect(verdict).toStrictEqual({
        disposition: row.disposition,
        dispositionBecause: row.dispositionBecause,
        exclusionReason: row.exclusionReason,
      });
    }
  });

  it("names an exclusion reason on every excluded row and on no other, and gives every row a scope", () => {
    for (const row of GOOGLE_SECOPS_SURFACES) {
      expect(row.exclusionReason === null).toBe(row.disposition !== "excluded");
      expect(row.scopes.length).toBeGreaterThan(0);
      expect(row.id).toBe(`${row.service}.${row.rpc}`);
    }
  });

  it("binds every row under the instance's resource name", () => {
    const outside = GOOGLE_SECOPS_SURFACES.filter(
      (row) => !/^\/v1\/\{[a-z_.]+=projects\/\*\/locations\/\*\/instances\/\*[}/]/u.test(row.pathTemplate),
    );
    expect(outside).toStrictEqual([]);
  });
});

describe("the pin", () => {
  it("addresses every file at the one pinned commit, under its own name", () => {
    expect(GOOGLE_SECOPS_PINS.length).toBe(16);
    for (const pin of GOOGLE_SECOPS_PINS) {
      expect(pin.url).toBe(
        `https://raw.githubusercontent.com/googleapis/googleapis/${GOOGLE_SECOPS_PROTO_COMMIT}/google/cloud/chronicle/v1/${pin.id}`,
      );
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/u);
      // A bare file name, so `--spec-dir` joins it inside the spec directory and never outside it.
      expect(pin.id).toMatch(/^[a-z0-9_]+\.(?:proto|yaml)$/u);
    }
    expect(new Set(GOOGLE_SECOPS_PINS.map((pin) => pin.id)).size).toBe(GOOGLE_SECOPS_PINS.length);
  });

  it("declares exactly the published rows plus the unpublished services' rpcs", () => {
    const declared = GOOGLE_SECOPS_PINS.reduce((sum, pin) => sum + pin.declared, 0);
    const unpublished = GOOGLE_SECOPS_UNPUBLISHED_SERVICES.reduce((sum, service) => sum + service.rpcs, 0);
    expect(unpublished).toBe(7);
    expect(declared).toBe(GOOGLE_SECOPS_SURFACES.length + unpublished);
  });

  it("keeps the three services chronicle_v1.yaml does not publish out of the rows", () => {
    const services = new Set(GOOGLE_SECOPS_SURFACES.map((row) => row.service));
    expect(GOOGLE_SECOPS_UNPUBLISHED_SERVICES.map((entry) => entry.service)).toStrictEqual([
      "google.cloud.chronicle.v1.BigQueryExportService",
      "google.cloud.chronicle.v1.DashboardChartService",
      "google.cloud.chronicle.v1.DashboardQueryService",
    ]);
    expect(GOOGLE_SECOPS_UNPUBLISHED_SERVICES.filter((entry) => services.has(entry.service))).toStrictEqual([]);
  });
});
