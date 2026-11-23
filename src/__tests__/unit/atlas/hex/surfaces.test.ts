import { describe, expect, it } from "vitest";

import { HEX_PROBE_CENSUS, hexMountedNouns, hexProbeEvidenceFor } from "../../../../atlas/hex/apiProbe.js";
import { HEX_CLIENT_SURFACE } from "../../../../atlas/hex/generated/clientSurface.js";
import { HEX_SPEC_PINS } from "../../../../atlas/hex/generated/specLock.js";
import { verifyAndCompile } from "../../../../atlas/hex/specFetch.js";
import { HEX_FIELD_DEPTH, hexMethodProviderId, readHexSpecSurface } from "../../../../atlas/hex/specSurface.js";
import { unwrap } from "../../../../lib/result.js";

import { HEX_FIXTURE_DOCUMENT, HEX_FIXTURE_PIN } from "./fixture.js";

/** The fixture, compiled once per assertion group. */
function compiled(): ReturnType<typeof readHexSpecSurface> {
  return readHexSpecSurface({ document: JSON.parse(HEX_FIXTURE_DOCUMENT), specId: "hex-public-api" });
}

describe("compiling the published document", () => {
  it("reads every method on every path, keyed byte-exactly", () => {
    const surface = unwrap(compiled());

    expect(surface.operations.map((operation) => hexMethodProviderId(operation))).toEqual([
      "GET /v1/cells/{cellId}/output",
      "GET /v1/projects",
      "GET /v1/projects/{projectId}/runs",
      "PATCH /v1/semantic-(projects|models)/{semanticProjectId}",
      "POST /v1/projects",
    ]);
  });

  // Hex writes one path key as a regular expression, which OpenAPI defines as a literal path. It is kept
  // verbatim because the provider id IS the key: rewriting it would make the row uncitable against the
  // document a reader opens.
  it("keeps the regular-expression path key exactly as the document writes it", () => {
    const surface = unwrap(compiled());

    expect(
      surface.operations.some((operation) => operation.path === "/v1/semantic-(projects|models)/{semanticProjectId}"),
    ).toBe(true);
  });

  it("collects a request body's own properties alongside the declared parameters", () => {
    const surface = unwrap(compiled());
    const created = surface.operations.find((operation) => operation.operationId === "CreateProject")!;

    expect(created.parameters).toEqual(["title"]);
  });

  it("follows a $ref through an array hop without spending a depth step", () => {
    const surface = unwrap(compiled());
    const listed = surface.operations.find((operation) => operation.operationId === "ListProjects")!;

    expect(listed.responseFields).toEqual([
      "values",
      "values[].id",
      "values[].owner",
      "values[].owner.email",
      "values[].owner.id",
      "values[].title",
    ]);
    expect(HEX_FIELD_DEPTH).toBe(2);
  });

  it("carries the document's own security requirement onto every operation", () => {
    const surface = unwrap(compiled());

    expect(surface.securitySchemes).toEqual(["bearerAuth"]);
    expect(surface.hosts).toEqual(["https://app.hex.tech/api"]);
  });

  it("lets a path item's own server override the document's, and only on that path", () => {
    const document = JSON.parse(HEX_FIXTURE_DOCUMENT) as { paths: Record<string, Record<string, unknown>> };
    document.paths["/v1/projects"]!["servers"] = [{ url: "https://eu.hex.tech/api" }];
    const surface = unwrap(readHexSpecSurface({ document, specId: "hex-public-api" }));

    expect(surface.operations.filter((operation) => operation.path === "/v1/projects").map((o) => o.host)).toEqual([
      "https://eu.hex.tech/api",
      "https://eu.hex.tech/api",
    ]);
    expect(surface.operations.find((operation) => operation.path === "/v1/projects/{projectId}/runs")!.host).toBe(
      "https://app.hex.tech/api",
    );
  });

  it("refuses a document with no paths rather than reporting an empty surface", () => {
    const refused = readHexSpecSurface({ document: { openapi: "3.0.3" }, specId: "hex-public-api" });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()[0]).toContain("declares no `paths` object");
  });
});

describe("verifying the pinned document before compiling it", () => {
  // A release moves the bytes at an unversioned address, so refusing on a digest would make the atlas
  // unbuildable the day Hex ships. The movement is recorded instead.
  it("compiles a document whose bytes have moved and reports the drift rather than refusing", () => {
    const verified = unwrap(verifyAndCompile({ pin: HEX_FIXTURE_PIN, text: HEX_FIXTURE_DOCUMENT }));

    expect(verified.drift!.expectedSha256).toBe(HEX_FIXTURE_PIN.sha256);
    expect(verified.drift!.actualByteLength).toBe(HEX_FIXTURE_PIN.byteLength);
    expect(verified.surface.operations.length).toBe(5);
  });

  it("reports an unparsable body as its own failure kind", () => {
    const refused = verifyAndCompile({ pin: HEX_FIXTURE_PIN, text: "not json" });

    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("SPEC_UNPARSABLE");
  });
});

describe("the committed measurements", () => {
  it("pins one document, because Hex publishes one", () => {
    expect(HEX_SPEC_PINS.length).toBe(1);
    expect(HEX_SPEC_PINS[0]!.url).toBe("https://static.hex.site/openapi.json");
    expect(HEX_SPEC_PINS[0]!.securitySchemes).toEqual(["bearerAuth"]);
  });

  it("classifies an unauthenticated answer by status, with no third state for a live router", () => {
    expect(hexProbeEvidenceFor({ status: 401 })).toBe("mounted-401");
    expect(hexProbeEvidenceFor({ status: 404 })).toBe("absent-404");
    expect(hexProbeEvidenceFor({ status: 200 })).toBe("undiscriminating");
  });

  it("found a mounted noun the published document declares no path under", () => {
    expect(hexMountedNouns()).toContain("suggestions");
    expect(HEX_PROBE_CENSUS.filter((row) => row.evidence === "absent-404").length).toBeGreaterThan(0);
  });

  // The whole finding: the document declares 52 REST operations and not one GraphQL operation, while the
  // client ships a named GraphQL API of its own.
  it("compiled a client GraphQL census the published document knows nothing about", () => {
    expect(HEX_CLIENT_SURFACE.graphqlOperations.length).toBeGreaterThan(0);
    expect(HEX_CLIENT_SURFACE.graphqlOperations.some((operation) => operation.name === "OrgDetails")).toBe(true);
    expect(HEX_FIXTURE_DOCUMENT.includes("graphql")).toBe(false);
  });
});
