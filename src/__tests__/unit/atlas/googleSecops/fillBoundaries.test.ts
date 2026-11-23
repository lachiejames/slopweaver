/**
 * Unit: every list's strict boundary accepts the empty page proto3 JSON sends for an empty instance, and
 * refuses a top-level field it was not built for by name, so a changed response fails loudly.
 */
import { describe, expect, it } from "vitest";

import {
  LIST_ALL_FINDINGS_REFINEMENT_DEPLOYMENTS,
  LIST_DATA_TABLES,
  LIST_FEATURED_DASHBOARDS,
  LIST_FEEDS,
  LIST_FINDINGS_REFINEMENTS,
  LIST_NATIVE_DASHBOARDS,
} from "../../../../atlas/googleSecops/fill/boundaries.js";
import { unwrapErr } from "../../../../lib/result.js";

const BOUNDARIES = [
  LIST_DATA_TABLES,
  LIST_NATIVE_DASHBOARDS,
  LIST_FEATURED_DASHBOARDS,
  LIST_FEEDS,
  LIST_FINDINGS_REFINEMENTS,
  LIST_ALL_FINDINGS_REFINEMENT_DEPLOYMENTS,
] as const;

describe("the six SecOps list boundaries", () => {
  it("accept an empty page", () => {
    expect(BOUNDARIES.map((boundary) => boundary.parse({ value: {} }).isOk())).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("refuse an undeclared top-level field, naming it", () => {
    const codes = BOUNDARIES.map((boundary) => unwrapErr(boundary.parse({ value: { totalSize: 3 } })));
    expect(codes.map((error) => error.code)).toStrictEqual(Array.from({ length: 6 }, () => "BOUNDARY_SHAPE_CHANGED"));
    expect(codes.filter((error) => !error.message.includes("totalSize"))).toStrictEqual([]);
  });

  it("refuse a page token that is not a string", () => {
    expect(unwrapErr(LIST_FEEDS.parse({ value: { nextPageToken: 7 } })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});
