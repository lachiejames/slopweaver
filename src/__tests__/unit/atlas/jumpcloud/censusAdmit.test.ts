/**
 * The census admitter — `src/atlas/jumpcloud/censusAdmit.ts` — walks past a drifted record the production admitter
 * refuses, in the carrier the surface declares, and still refuses a changed carrier.
 */
import { describe, expect, it } from "vitest";

import { admitJumpcloudCensusPage } from "../../../../atlas/jumpcloud/censusAdmit.js";
import { admitJumpcloudPage } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NO_HEADERS = {};

describe("admitJumpcloudCensusPage", () => {
  it("admits a wrapped page carrying a field no boundary declares, which production refuses", () => {
    const text = '{"results":[{"neverDeclared":"x"}],"totalCount":7}';
    expect(unwrapErr(admitJumpcloudPage({ headers: NO_HEADERS, surface: "v1-systems-list", text })).code).toBe(
      "BODY_SHAPE_CHANGED",
    );
    const page = unwrap(admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v1-systems-list", text }));
    expect(page).toEqual({ records: [{ neverDeclared: "x" }], shape: "wrapped-results", totalCount: 7 });
  });

  it("takes a bare array's total from the header", () => {
    const page = unwrap(
      admitJumpcloudCensusPage({ headers: { "x-total-count": "3" }, surface: "v2-iplists-list", text: '[{"id":"a"}]' }),
    );
    expect(page).toEqual({ records: [{ id: "a" }], shape: "bare-array", totalCount: 3 });
  });

  it("reads a single-object surface as one record", () => {
    const page = unwrap(admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v1-organizations-get", text: "{}" }));
    expect(page.records).toEqual([{}]);
    expect(page.shape).toBe("single-object");
  });

  it("reads an empty body as no records", () => {
    const page = unwrap(admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v2-iplists-list", text: "  " }));
    expect(page.records).toEqual([]);
    expect(page.shape).toBe("empty");
  });

  it("refuses an answer in a carrier other than the declared one", () => {
    const refused = unwrapErr(
      admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v1-systems-list", text: '[{"id":"a"}]' }),
    );
    expect(refused.code).toBe("UNEXPECTED_SHAPE");
    expect(refused.message).toContain("declares a wrapped-results carrier and answered no results array");
  });

  it("refuses a body that is not JSON", () => {
    const refused = unwrapErr(
      admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v2-iplists-list", text: "<html>" }),
    );
    expect(refused.message).toContain("the response body is not JSON — 6 byte(s)");
  });

  it("refuses a surface no boundary declares", () => {
    const refused = unwrapErr(admitJumpcloudCensusPage({ headers: NO_HEADERS, surface: "v9-nowhere", text: "[]" }));
    expect(refused.code).toBe("UNEXPECTED_SHAPE");
    expect(refused.message).toContain("no response boundary is declared for this surface");
  });
});
