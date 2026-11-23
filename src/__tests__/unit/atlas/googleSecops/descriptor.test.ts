/**
 * Unit: the Google SecOps descriptor's one surface carries the pinned inventory's GET census as its
 * denominator, and claims as reached exactly the lists the fill calls.
 */
import { describe, expect, it } from "vitest";

import { GOOGLE_SECOPS_ATLAS_DESCRIPTOR } from "../../../../atlas/googleSecops/descriptor.js";
import { GOOGLE_SECOPS_FILL_CALLS } from "../../../../atlas/googleSecops/fill/plan.js";
import { GOOGLE_SECOPS_INVENTORY_CENSUS } from "../../../../atlas/googleSecops/generated/protoLock.js";
import { GOOGLE_SECOPS_SURFACES } from "../../../../atlas/googleSecops/generated/surfaces.js";
import { atlasDescriptorSchema } from "../../../../atlas/kit/contract.js";

describe("GOOGLE_SECOPS_ATLAS_DESCRIPTOR", () => {
  it("parses against the kit contract", () => {
    expect(atlasDescriptorSchema.safeParse(GOOGLE_SECOPS_ATLAS_DESCRIPTOR).success).toBe(true);
  });

  it("declares exactly one surface, the v1 API", () => {
    expect(GOOGLE_SECOPS_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toStrictEqual(["chronicle-api-v1"]);
  });

  it("divides by the pinned inventory's GET count, which is also its entity-row count", () => {
    const surface = GOOGLE_SECOPS_ATLAS_DESCRIPTOR.surfaces[0]!;
    const gets = GOOGLE_SECOPS_SURFACES.filter((row) => row.httpMethod === "GET").length;
    expect(gets).toBe(39);
    expect(GOOGLE_SECOPS_INVENTORY_CENSUS.byHttpMethod.GET).toBe(gets);
    expect(surface.denominator).toMatchObject({ exists: gets, known: true, reached: 6 });
  });

  it("counts as reached the lists the fill calls, and no more", () => {
    expect(GOOGLE_SECOPS_FILL_CALLS.length).toBe(6);
    expect(GOOGLE_SECOPS_ATLAS_DESCRIPTOR.surfaces[0]!.status).toBe("filled");
    expect(GOOGLE_SECOPS_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas google-secops fill");
  });

  it("refuses every write", () => {
    expect(GOOGLE_SECOPS_ATLAS_DESCRIPTOR.writePolicy).toBe("refuse-every-write");
  });
});
