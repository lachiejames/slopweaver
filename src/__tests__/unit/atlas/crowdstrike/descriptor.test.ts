import { describe, expect, it } from "vitest";

import { CROWDSTRIKE_ATLAS_DESCRIPTOR } from "../../../../atlas/crowdstrike/descriptor.js";
import { CROWDSTRIKE_KINDS } from "../../../../atlas/crowdstrike/model.js";
import { atlasDescriptorSchema, hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

describe("CROWDSTRIKE_ATLAS_DESCRIPTOR", () => {
  it("satisfies the kit's strict descriptor contract", () => {
    expect(atlasDescriptorSchema.safeParse(CROWDSTRIKE_ATLAS_DESCRIPTOR).success).toBe(true);
  });

  it("declares one platform and exactly two surfaces", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.platform).toBe("crowdstrike");
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toEqual([
      "falcon-api",
      "falcon-console",
    ]);
  });

  it("declares every kind the model declares, and no other", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.kinds).toEqual([...CROWDSTRIKE_KINDS]);
  });

  // The bar the owner set is that both surfaces are mandatory and the browser half covers the WHOLE
  // console. `slopweaver crowdstrike walk` fills it from the console's own published sitemap, so a
  // regression that quietly stopped filling it would be invisible without this.
  it("declares BOTH surfaces filled, leaving nothing declared-but-unpopulated", () => {
    expect(hasFilledBrowserSurface({ descriptor: CROWDSTRIKE_ATLAS_DESCRIPTOR })).toBe(true);
    expect(unfilledSurfaces({ descriptor: CROWDSTRIKE_ATLAS_DESCRIPTOR })).toEqual([]);
  });

  it("declares its exclusions rather than leaving them to be inferred", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.excludes.length).toBe(5);
    const writes = CROWDSTRIKE_ATLAS_DESCRIPTOR.excludes.filter((entry) =>
      entry.because.includes("every write operation"),
    );
    expect(writes.length).toBe(1);
  });

  it("names the resync command the verb surface actually offers", () => {
    expect(CROWDSTRIKE_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver crowdstrike sync");
  });
});
