import { describe, expect, it } from "vitest";

import { collectionPathFor, vantaEndpointVerdict } from "../../../../atlas/vanta/endpointDisposition.js";
import { VANTA_GET_ENDPOINTS } from "../../../../atlas/vanta/generated/getEndpoints.js";
import { VANTA_DISPOSITION_CENSUS, VANTA_SPEC_CENSUS } from "../../../../atlas/vanta/generated/specLock.js";
import { VANTA_MANAGE_ENDPOINTS, VANTA_SYNCED_SPEC_PATHS } from "../../../../atlas/vanta/inventory.js";

describe("collectionPathFor", () => {
  it("finds the collection a detail path reads one member of", () => {
    expect(collectionPathFor({ path: "/people/{personId}" })).toBe("/people");
  });

  it("returns null for a collection path", () => {
    expect(collectionPathFor({ path: "/people" })).toBe(null);
  });

  it("returns null for a sub-collection, which is not a detail read", () => {
    expect(collectionPathFor({ path: "/vendors/{vendorId}/findings" })).toBe(null);
  });

  it("returns null for a single-segment parameter path with no parent", () => {
    expect(collectionPathFor({ path: "/{id}" })).toBe(null);
  });
});

describe("vantaEndpointVerdict", () => {
  const syncedPaths = new Set(["/people", "/policies"]);
  const detailAddedFields = new Map<string, readonly string[]>();

  it("calls a path the sync walks synced", () => {
    expect(vantaEndpointVerdict({ detailAddedFields, path: "/policies", syncedPaths }).disposition).toBe("synced");
  });

  it("calls a detail read of a walked collection covered-by-list, naming the collection", () => {
    const verdict = vantaEndpointVerdict({ detailAddedFields, path: "/people/{personId}", syncedPaths });
    expect(verdict.disposition).toBe("covered-by-list");
    expect(verdict.because).toContain("/people");
  });

  it("calls a measured entitlement refusal what it is, before any list check", () => {
    const verdict = vantaEndpointVerdict({ detailAddedFields, path: "/contracts", syncedPaths });
    expect(verdict.disposition).toBe("entitlement-refused");
    expect(verdict.because).toContain("HTTP 403");
  });

  it("calls a sub-collection measured at 403 an entitlement refusal, not a detail read of its parent", () => {
    const verdict = vantaEndpointVerdict({ detailAddedFields, path: "/vendors/{vendorId}/findings", syncedPaths });
    expect(verdict.disposition).toBe("entitlement-refused");
    expect(verdict.because).toContain("HTTP 403");
  });

  it("calls everything else not-fetched", () => {
    expect(
      vantaEndpointVerdict({ detailAddedFields, path: "/trust-centers/{slugId}/faqs", syncedPaths }).disposition,
    ).toBe("not-fetched");
  });

  it("does not call a detail read of an UNwalked collection covered-by-list", () => {
    expect(vantaEndpointVerdict({ detailAddedFields, path: "/groups/{groupId}", syncedPaths }).disposition).toBe(
      "not-fetched",
    );
  });

  it("refuses covered-by-list when the detail response declares a field the collection's rows do not", () => {
    const verdict = vantaEndpointVerdict({
      detailAddedFields: new Map([["/people/{personId}", ["note", "subscribers"]]]),
      path: "/people/{personId}",
      syncedPaths,
    });
    expect(verdict.disposition).toBe("not-fetched");
    expect(verdict.because).toContain("note, subscribers");
  });

  it("still calls a synced path synced even when its own detail adds fields", () => {
    const verdict = vantaEndpointVerdict({
      detailAddedFields: new Map([["/policies", ["note"]]]),
      path: "/policies",
      syncedPaths,
    });
    expect(verdict.disposition).toBe("synced");
  });
});

describe("the committed denominator", () => {
  it("holds one row per documented GET operation", () => {
    expect(VANTA_GET_ENDPOINTS).toHaveLength(VANTA_SPEC_CENSUS.getOperations);
  });

  it("matches the per-disposition census the generator refuses to move on its own", () => {
    const counted = {
      coveredByList: VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "covered-by-list").length,
      entitlementRefused: VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "entitlement-refused").length,
      notFetched: VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "not-fetched").length,
      synced: VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "synced").length,
    };
    expect(counted).toEqual({
      coveredByList: VANTA_DISPOSITION_CENSUS.coveredByList,
      entitlementRefused: VANTA_DISPOSITION_CENSUS.entitlementRefused,
      notFetched: VANTA_DISPOSITION_CENSUS.notFetched,
      synced: VANTA_DISPOSITION_CENSUS.synced,
    });
  });

  it("carries a distinct operation id on every row", () => {
    expect(new Set(VANTA_GET_ENDPOINTS.map((row) => row.operationId)).size).toBe(VANTA_GET_ENDPOINTS.length);
  });

  it("holds every entitlement-refused row's own measured status, so a reason nobody measured cannot sit there", () => {
    const refused = VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "entitlement-refused").map(
      (row) => row.path,
    );
    expect(refused.toSorted()).toEqual(["/contracts", "/contracts/{contractId}", "/vendors/{vendorId}/findings"]);
  });

  it("holds the knowledge-base resources endpoint as synced — the row this whole denominator was built to find", () => {
    const row = VANTA_GET_ENDPOINTS.find((candidate) => candidate.path === "/knowledge-base/resources");
    expect(row!.disposition).toBe("synced");
    expect(row!.operationId).toBe("ListKnowledgeBaseResources");
  });

  it("holds the two detail reads MEASURED to add fields as not-fetched rather than forgiven", () => {
    const documents = VANTA_GET_ENDPOINTS.find((row) => row.path === "/documents/{documentId}");
    const frameworks = VANTA_GET_ENDPOINTS.find((row) => row.path === "/frameworks/{frameworkId}");
    expect(documents!.disposition).toBe("not-fetched");
    expect(documents!.because).toContain("subscribers");
    expect(frameworks!.disposition).toBe("not-fetched");
    expect(frameworks!.because).toContain("requirementCategories");
  });
});

describe("the numerator cannot drift from the endpoints the client assembles", () => {
  it("has at least one entry in VANTA_SYNCED_SPEC_PATHS, so the guards below are not vacuously green", () => {
    expect(VANTA_SYNCED_SPEC_PATHS.length).toBeGreaterThan(0);
  });

  it("names every literal Manage API endpoint path, with its /v1 prefix removed", () => {
    const declared = new Set(VANTA_SYNCED_SPEC_PATHS);
    const missing = Object.values(VANTA_MANAGE_ENDPOINTS)
      .map((endpoint) => endpoint.path.replace(/^\/v1/, ""))
      .filter((path) => !declared.has(path))
      .toSorted();
    expect(missing).toEqual([]);
  });

  it("names only paths the published document actually declares", () => {
    const documented = new Set(VANTA_GET_ENDPOINTS.map((row) => row.path));
    expect(VANTA_SYNCED_SPEC_PATHS.filter((path) => !documented.has(path))).toEqual([]);
  });
});
