import { describe, expect, it } from "vitest";
import { z } from "zod";

import { vantaPageEnvelopeSchema } from "../../../../atlas/vanta/apiSchemas.js";
import { VANTA_CENSUS_FAMILY_LIST } from "../../../../atlas/vanta/census.js";
import { VANTA_CHILD_SURFACE_LIST } from "../../../../atlas/vanta/childCensus.js";
import { VANTA_CLIENT_BOUNDARIES } from "../../../../atlas/vanta/client.js";
import { vantaPagedBoundary, vantaUnpagedBoundary } from "../../../../atlas/vanta/pageBoundary.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const ROW = z.strictObject({ id: z.string() });
const TERMINATOR = { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null };
const PAGE_INFO = { endCursor: "c1", hasNextPage: true, hasPreviousPage: false, startCursor: null };

describe("vantaPagedBoundary", () => {
  const boundary = vantaPagedBoundary({
    endpoint: "GET /v1/things",
    pageSchema: vantaPageEnvelopeSchema({ dataSchema: ROW }),
  });

  it("reads a page as its rows and the provider's own cursor", () => {
    const text = JSON.stringify({ results: { data: [{ id: "a" }], pageInfo: PAGE_INFO, totalCount: 3 } });
    expect(unwrap(boundary.readPage({ text }))).toEqual({ items: [{ id: "a" }], pageInfo: PAGE_INFO });
  });

  it("refuses a renamed field by name, leading with the endpoint", () => {
    const text = JSON.stringify({ results: { data: [{ idd: "a" }], pageInfo: PAGE_INFO } });
    expect(unwrapErr(boundary.readPage({ text })).message).toBe(
      'GET /v1/things answered a shape this version does not read — refused, not guessed: field "results.data[0].id" renamed to "results.data[0].idd"?',
    );
  });

  it("refuses at definition a row schema that is not strict", () => {
    expect(() =>
      vantaPagedBoundary({
        endpoint: "GET /v1/loose",
        pageSchema: vantaPageEnvelopeSchema({ dataSchema: z.looseObject({ id: z.string() }) }),
      }),
    ).toThrow("defineBoundary(GET /v1/loose): every object must be z.strictObject");
  });
});

describe("vantaUnpagedBoundary", () => {
  it("reads each unpaged shape the document declares as one page ending in the terminator", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const read = ({ shape, body }: { shape: "bare-array" | "results-array" | "results-data"; body: unknown }) =>
      unwrap(
        vantaUnpagedBoundary({ dataSchema: ROW, endpoint: "GET /v1/things", shape }).readPage({
          text: JSON.stringify(body),
        }),
      );
    expect(read({ body: rows, shape: "bare-array" })).toEqual({ items: rows, pageInfo: TERMINATOR });
    expect(read({ body: { results: rows }, shape: "results-array" })).toEqual({ items: rows, pageInfo: TERMINATOR });
    expect(read({ body: { results: { data: rows } }, shape: "results-data" })).toEqual({
      items: rows,
      pageInfo: TERMINATOR,
    });
  });

  it("refuses a bare-array endpoint that starts answering in an envelope", () => {
    const boundary = vantaUnpagedBoundary({ dataSchema: ROW, endpoint: "GET /v1/things", shape: "bare-array" });
    expect(unwrapErr(boundary.readPage({ text: JSON.stringify({ results: [] }) })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});

// Every endpoint label is written beside the path it names, so a guard holds the two together.
describe("the declared read boundaries", () => {
  it("names every census family's endpoint by its own path", () => {
    expect(VANTA_CENSUS_FAMILY_LIST.length).toBeGreaterThan(0);
    expect(
      VANTA_CENSUS_FAMILY_LIST.filter((family) => family.pageBoundary.endpoint !== `GET ${family.path}`).map(
        (family) => family.surface,
      ),
    ).toEqual([]);
  });

  it("names every child surface's endpoint by its own path template", () => {
    expect(VANTA_CHILD_SURFACE_LIST.length).toBeGreaterThan(0);
    expect(
      VANTA_CHILD_SURFACE_LIST.filter((child) => child.pageBoundary.endpoint !== `GET ${child.specPath}`).map(
        (child) => child.surface,
      ),
    ).toEqual([]);
  });

  it("reads deactivated controls as the library row the document declares, frameworks and reason included", () => {
    const row = {
      creationDate: null,
      customFields: [],
      deactivationReason: "not applicable",
      description: "d",
      domains: [],
      externalId: null,
      frameworks: [{ displayName: "ISO 27001", id: "f1", sections: ["A.5"], shorthandName: "ISO" }],
      id: "c1",
      implementationDetails: "MFA is required",
      modificationDate: null,
      name: "n",
      owner: null,
      source: "Vanta",
    };
    const text = JSON.stringify({ results: { data: [row], pageInfo: TERMINATOR } });
    expect(unwrap(VANTA_CLIENT_BOUNDARIES.controlsDeactivated.readPage({ text }))).toEqual({
      items: [row],
      pageInfo: TERMINATOR,
    });
  });

  it("reads a scanned container image's asset tags as the key-value pairs the document declares", () => {
    const scanner = {
      assetTags: [{ key: "env", value: "prod" }],
      biosUuid: null,
      fqdns: null,
      hostnames: null,
      imageDigest: "sha256:abc",
      imagePushedAtDate: "2026-10-01T00:00:00.000Z",
      imageTags: ["latest"],
      integrationId: "i1",
      ipv4s: null,
      ipv6s: null,
      macAddresses: null,
      operatingSystems: null,
      parentAccountOrOrganization: null,
      resourceId: "r1",
      targetId: null,
    };
    const row = {
      assetType: "CONTAINER_IMAGE",
      hasBeenScanned: true,
      id: "a1",
      imageScanTag: null,
      name: "n",
      scanners: [scanner],
    };
    const family = VANTA_CENSUS_FAMILY_LIST.find((entry) => entry.surface === "vulnerable-assets-list")!;
    const text = JSON.stringify({ results: { data: [row], pageInfo: TERMINATOR } });
    expect(unwrap(family.pageBoundary.readPage({ text }))).toEqual({ items: [row], pageInfo: TERMINATOR });
  });

  it("declares the client's own reads once each, by method and path template", () => {
    expect(Object.values(VANTA_CLIENT_BOUNDARIES).map((boundary) => boundary.endpoint)).toEqual([
      "GET /v1/controls/{controlId}",
      "GET /v1/controls/{controlId}/tests",
      "GET /v1/controls",
      "GET /v1/controls/deactivated-controls",
      "GET /v1/documents",
      "GET /v1/event-logs",
      "GET /v1/frameworks",
      "GET /v1/knowledge-base/resources",
      "GET /v1/policies",
      "GET /v1/risk-scenarios",
      "GET /v1/tests/{testId}/entities",
      "GET /v1/vendors",
      "GET /v1/vulnerabilities",
      "GET /v1/vulnerabilities/{vulnerabilityId}",
    ]);
  });
});
