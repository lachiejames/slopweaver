/**
 * The generated response registry — `src/atlas/datadog/responseRegistry.ts` — declares every admitted JSON
 * operation exactly once, builds every boundary at import, and admits or refuses as its census declared.
 */
import { describe, expect, it } from "vitest";

import { DATADOG_API_ADMITTED } from "../../../../atlas/datadog/apiAcquisition.js";
import { DATADOG_RESPONSE_BOUNDARIES_1 } from "../../../../atlas/datadog/generated/responseBoundaries1.js";
import { DATADOG_RESPONSE_BOUNDARIES_2 } from "../../../../atlas/datadog/generated/responseBoundaries2.js";
import { DATADOG_RESPONSE_BOUNDARIES_3 } from "../../../../atlas/datadog/generated/responseBoundaries3.js";
import { DATADOG_RESPONSE_BOUNDARIES_4 } from "../../../../atlas/datadog/generated/responseBoundaries4.js";
import {
  DATADOG_RESPONSE_CENSUS_TAKEN_AT,
  DATADOG_RESPONSE_CUTS,
  DATADOG_RESPONSE_FILE_OPERATIONS,
  DATADOG_RESPONSE_SPEC_LAG,
  DATADOG_RESPONSE_UNMEASURED,
} from "../../../../atlas/datadog/generated/responseInventory.js";
import { DATADOG_RESPONSE_BOUNDARIES } from "../../../../atlas/datadog/responseRegistry.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** Admit one body through a named operation's boundary. */
function admit({
  surface,
  text,
}: {
  surface: string;
  text: string;
}): ReturnType<NonNullable<ReturnType<typeof DATADOG_RESPONSE_BOUNDARIES.get>>["admit"]> {
  return DATADOG_RESPONSE_BOUNDARIES.get(surface)!.admit({ path: "/api/test", status: 200, text });
}

describe("DATADOG_RESPONSE_BOUNDARIES", () => {
  it("declares every admitted operation once, the file operations excepted", () => {
    expect(DATADOG_API_ADMITTED.length).toBeGreaterThan(0);
    const declared = [...DATADOG_RESPONSE_BOUNDARIES.keys(), ...DATADOG_RESPONSE_FILE_OPERATIONS.map((f) => f.surface)];
    expect(declared.toSorted()).toEqual(DATADOG_API_ADMITTED.map((row) => row.name).toSorted());
  });

  it("loses no batch's boundary to a duplicate, which the map would otherwise overwrite silently", () => {
    const batches = [
      DATADOG_RESPONSE_BOUNDARIES_1,
      DATADOG_RESPONSE_BOUNDARIES_2,
      DATADOG_RESPONSE_BOUNDARIES_3,
      DATADOG_RESPONSE_BOUNDARIES_4,
    ];
    expect(batches.filter((batch) => batch.length === 0)).toEqual([]);
    expect(batches.flat().length).toBe(DATADOG_RESPONSE_BOUNDARIES.size);
  });

  it("keys each boundary by the operation it names", () => {
    const misfiled = [...DATADOG_RESPONSE_BOUNDARIES].filter(([surface, boundary]) => surface !== boundary.surface);
    expect(misfiled).toEqual([]);
  });

  it("marks exactly the inventory's unmeasured operations as declaring the specification's names only", () => {
    expect(DATADOG_RESPONSE_UNMEASURED.length).toBeGreaterThan(0);
    const namesOnly = [...DATADOG_RESPONSE_BOUNDARIES.values()]
      .filter((boundary) => boundary.source === "spec-names-only")
      .map((boundary) => boundary.surface);
    expect(namesOnly.toSorted()).toEqual([...DATADOG_RESPONSE_UNMEASURED].toSorted());
  });

  it("lists spec lag only for operations that have a boundary", () => {
    expect(DATADOG_RESPONSE_SPEC_LAG.length).toBeGreaterThan(0);
    const orphaned = DATADOG_RESPONSE_SPEC_LAG.filter((row) => !DATADOG_RESPONSE_BOUNDARIES.has(row.surface));
    expect(orphaned).toEqual([]);
  });

  it("lists every cut on a named field of an operation that has a boundary, never on a root", () => {
    expect(DATADOG_RESPONSE_CUTS.length).toBeGreaterThan(0);
    const orphaned = DATADOG_RESPONSE_CUTS.filter((cut) => !DATADOG_RESPONSE_BOUNDARIES.has(cut.surface));
    expect(orphaned).toEqual([]);
    expect(DATADOG_RESPONSE_CUTS.filter((cut) => cut.path === "")).toEqual([]);
  });

  it("records the census instant as the ISO timestamp the census itself wrote", () => {
    expect(new Date(DATADOG_RESPONSE_CENSUS_TAKEN_AT).toISOString()).toBe(DATADOG_RESPONSE_CENSUS_TAKEN_AT);
  });

  it("admits a measured operation's answer and refuses an undeclared key or a changed kind as drift", () => {
    const surface = "v2-case-management-list-user-case-project-favorites";
    const text = JSON.stringify({ data: [{ id: "a", type: "favorite" }] });
    expect(unwrap(admit({ surface, text }))).toEqual({ data: [{ id: "a", type: "favorite" }] });
    const extra = JSON.stringify({ data: [{ extra: 1, id: "a", type: "favorite" }] });
    expect(unwrapErr(admit({ surface, text: extra })).code).toBe("BODY_SHAPE_CHANGED");
    const kind = JSON.stringify({ data: [{ id: 1, type: "favorite" }] });
    expect(unwrapErr(admit({ surface, text: kind })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("admits a names-only operation's declared fields unread and refuses a name the specification lacks", () => {
    const surface = "v1-ipranges-get-ipranges";
    expect(unwrap(admit({ surface, text: "{}" }))).toEqual({});
    expect(unwrapErr(admit({ surface, text: '{"undeclared":1}' })).code).toBe("BODY_SHAPE_CHANGED");
  });
});
