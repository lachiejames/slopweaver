import { describe, expect, it } from "vitest";

import type { BrazeDocsOperationRow } from "../../../../atlas/braze/docsCatalogue.js";
import { brazeReaderFloorFailure } from "../../../../atlas/braze/readerFloor.js";

/** One well-formed row, varied per test rather than restated. */
function row({
  index,
  parameters,
  fields,
}: {
  index: number;
  parameters: number;
  fields: number;
}): BrazeDocsOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: "configuration",
    dispositionRuleId: "reachable-configuration",
    kind: "export",
    lastModified: "2026-09-05T00:00:00+00:00",
    method: "GET",
    parameters: Array.from({ length: parameters }, (_unused, at) => ({
      name: `p${String(at)}`,
      required: false,
      type: "String",
    })),
    pathDefect: null,
    pathShape: `/thing/${String(index)}`,
    providerId: `GET /thing/${String(index)}`,
    rateLimit: null,
    responseFields: Array.from({ length: fields }, (_unused, at) => `f${String(at)}`),
    title: `Thing ${String(index)}`,
    url: `https://www.braze.com/docs/api/endpoints/export/get_thing_${String(index)}`,
  };
}

/** A healthy run: 120 pages, most with parameters and response fields. */
function healthy(): readonly BrazeDocsOperationRow[] {
  return Array.from({ length: 120 }, (_unused, index) => row({ fields: 1, index, parameters: 1 }));
}

describe("brazeReaderFloorFailure", () => {
  it("passes a healthy run", () => {
    expect(brazeReaderFloorFailure({ collectionRequests: 99, rows: healthy(), servedOperationPages: 120 })).toBe(null);
  });

  it("passes the shape: one more page declared than served, every served page read", () => {
    // 147 declared, 146 served: the caller passes the SERVED count, and a declared page Braze redirects off
    // the operation tree owes no row.
    const served = Array.from({ length: 146 }, (_unused, index) => row({ fields: 1, index, parameters: 1 }));
    expect(brazeReaderFloorFailure({ collectionRequests: 99, rows: served, servedOperationPages: 146 })).toBe(null);
  });

  it("fails when Braze stops serving enough operation pages", () => {
    const failure = brazeReaderFloorFailure({
      collectionRequests: 99,
      rows: healthy().slice(0, 10),
      servedOperationPages: 10,
    });
    expect(failure?.join(" ")).toContain("Braze served 10 operation page(s), below the floor");
  });

  it("fails when a served page did not yield an operation", () => {
    const failure = brazeReaderFloorFailure({ collectionRequests: 99, rows: healthy(), servedOperationPages: 121 });
    expect(failure?.join(" ")).toContain(
      "121 operation page(s) were served and 120 were read — every served page must yield an operation",
    );
  });

  it("fails when the parameter-table extraction stops matching", () => {
    const rows = healthy().map((held, index) => ({ ...held, parameters: index < 5 ? held.parameters : [] }));
    const failure = brazeReaderFloorFailure({ collectionRequests: 99, rows, servedOperationPages: 120 });
    expect(failure?.join(" ")).toContain("request-parameter table");
  });

  it("fails when the response-field extraction stops matching", () => {
    const rows = healthy().map((held, index) => ({ ...held, responseFields: index < 5 ? held.responseFields : [] }));
    const failure = brazeReaderFloorFailure({ collectionRequests: 99, rows, servedOperationPages: 120 });
    expect(failure?.join(" ")).toContain("response field names");
  });

  it("fails when the collection stops declaring enough requests", () => {
    const failure = brazeReaderFloorFailure({ collectionRequests: 3, rows: healthy(), servedOperationPages: 120 });
    expect(failure?.join(" ")).toContain("the collection declared 3 request(s)");
  });

  it("names every floor that broke rather than only the first", () => {
    const failure = brazeReaderFloorFailure({ collectionRequests: 3, rows: [], servedOperationPages: 10 });
    expect(failure?.length).toBeGreaterThan(3);
  });

  it("says these are floors on the reader rather than on Braze's numbers", () => {
    const failure = brazeReaderFloorFailure({ collectionRequests: 3, rows: healthy(), servedOperationPages: 120 });
    expect(failure?.at(-1)).toContain("floors on the READER");
  });
});
