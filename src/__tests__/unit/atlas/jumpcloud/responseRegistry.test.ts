/**
 * The generated response registry — `src/atlas/jumpcloud/responseRegistry.ts` — covers every surface the sync pages,
 * exactly once, and an unmeasured surface refuses the first record it is sent.
 */
import { describe, expect, it } from "vitest";

import { JUMPCLOUD_FILE_RESPONSES } from "../../../../atlas/jumpcloud/fileResponses.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_1 } from "../../../../atlas/jumpcloud/generated/responseBoundaries1.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_2 } from "../../../../atlas/jumpcloud/generated/responseBoundaries2.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_3 } from "../../../../atlas/jumpcloud/generated/responseBoundaries3.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_4 } from "../../../../atlas/jumpcloud/generated/responseBoundaries4.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_5 } from "../../../../atlas/jumpcloud/generated/responseBoundaries5.js";
import { JUMPCLOUD_RESPONSE_BOUNDARIES_6 } from "../../../../atlas/jumpcloud/generated/responseBoundaries6.js";
import { jumpcloudPagedSurfaceNames } from "../../../../atlas/jumpcloud/pagedSurfaces.js";
import { JUMPCLOUD_RESPONSE_REGISTRY } from "../../../../atlas/jumpcloud/responseRegistry.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const NO_HEADERS = {};

describe("JUMPCLOUD_RESPONSE_REGISTRY", () => {
  it("declares every paged surface once, the two file surfaces excepted", () => {
    const paged = jumpcloudPagedSurfaceNames();
    expect(paged.length).toBeGreaterThan(0);
    const declared = [...JUMPCLOUD_RESPONSE_REGISTRY.keys(), ...Object.keys(JUMPCLOUD_FILE_RESPONSES)];
    expect(declared.toSorted()).toEqual([...paged].toSorted());
  });

  it("loses no batch's boundary to a duplicate, which the map would otherwise overwrite silently", () => {
    const batches = [
      JUMPCLOUD_RESPONSE_BOUNDARIES_1,
      JUMPCLOUD_RESPONSE_BOUNDARIES_2,
      JUMPCLOUD_RESPONSE_BOUNDARIES_3,
      JUMPCLOUD_RESPONSE_BOUNDARIES_4,
      JUMPCLOUD_RESPONSE_BOUNDARIES_5,
      JUMPCLOUD_RESPONSE_BOUNDARIES_6,
    ];
    expect(batches.filter((batch) => batch.length === 0)).toEqual([]);
    expect(batches.flat().length).toBe(JUMPCLOUD_RESPONSE_REGISTRY.size);
  });

  it("keys each boundary by the surface it names", () => {
    const misfiled = [...JUMPCLOUD_RESPONSE_REGISTRY].filter(([surface, boundary]) => surface !== boundary.surface);
    expect(misfiled).toEqual([]);
  });

  it("admits an empty page on a surface measured only empty, and refuses its first record as drift", () => {
    const boundary = JUMPCLOUD_RESPONSE_REGISTRY.get("v2-iplists-list")!;
    expect(unwrap(boundary.admit({ headers: NO_HEADERS, text: "[]" })).records).toEqual([]);
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: '[{"id":"a"}]' })).code).toBe("BODY_SHAPE_CHANGED");
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "[{}]" })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("refuses even an empty object on an object surface no answer measured", () => {
    const boundary = JUMPCLOUD_RESPONSE_REGISTRY.get("v1-organizations-get")!;
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "{}" })).code).toBe("BODY_SHAPE_CHANGED");
  });

  it("refuses any body on a surface whose document declares a binary file", () => {
    const boundary = JUMPCLOUD_RESPONSE_REGISTRY.get("v2-logos-get")!;
    expect(unwrapErr(boundary.admit({ headers: NO_HEADERS, text: "\u0089PNG" })).code).toBe("BODY_SHAPE_CHANGED");
  });
});
