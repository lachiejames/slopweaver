/**
 * What the atlas declares about itself, checked against what it can actually do.
 *
 * The assertion that matters most is the surface-name one. `kit/contract.ts` documents `AtlasSource.surface`
 * as naming a declared surface, so a stored observation whose channel the descriptor does not declare points
 * at a surface the catalogue has never heard of — a mismatch an adversarial review found in the Datadog
 * descriptor's first draft, where a test over `acquisition` values passed straight through it.
 */
import { describe, expect, it } from "vitest";

import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";
import { NIGHTFALL_ATLAS_DESCRIPTOR } from "../../../../atlas/nightfall/descriptor.js";
import { NIGHTFALL_ATLAS_CHANNELS, NIGHTFALL_ATLAS_KINDS } from "../../../../atlas/nightfall/model.js";

describe("the Nightfall atlas descriptor", () => {
  it("declares exactly the channels the model stores, in the same order", () => {
    expect(NIGHTFALL_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toStrictEqual([
      ...NIGHTFALL_ATLAS_CHANNELS,
    ]);
  });

  it("declares exactly the kinds the model publishes", () => {
    expect([...NIGHTFALL_ATLAS_DESCRIPTOR.kinds].toSorted()).toStrictEqual([...NIGHTFALL_ATLAS_KINDS].toSorted());
  });

  it("claims filled only for the surface that needs no credential", () => {
    const filled = NIGHTFALL_ATLAS_DESCRIPTOR.surfaces.filter((surface) => surface.status === "filled");
    expect(filled.map((surface) => surface.name)).toStrictEqual(["published-api"]);
    expect(filled[0]!.acquisition).toBe("compiled");
  });

  it("says the mandatory browser surface is declared and unfilled, rather than staying silent about it", () => {
    expect(hasFilledBrowserSurface({ descriptor: NIGHTFALL_ATLAS_DESCRIPTOR })).toBe(false);
    const unfilled = unfilledSurfaces({ descriptor: NIGHTFALL_ATLAS_DESCRIPTOR });
    expect(unfilled.map((surface) => surface.name)).toStrictEqual(["workflow-api", "console"]);
    for (const surface of unfilled) {
      expect(surface.unfilledBecause).not.toBe(null);
    }
  });

  it("names what would fill each unfilled surface, in acts rather than in wishes", () => {
    const [workflow, browser] = unfilledSurfaces({ descriptor: NIGHTFALL_ATLAS_DESCRIPTOR });
    expect(workflow!.unfilledBecause).toContain("nightfall-api-key");
    expect(browser!.unfilledBecause).toContain("app.nightfall.ai");
  });

  it("says what it does NOT hold, including the disposition that is not an exclusion", () => {
    expect(NIGHTFALL_ATLAS_DESCRIPTOR.excludes.length).toBe(5);
    expect(NIGHTFALL_ATLAS_DESCRIPTOR.excludes.some((entry) => entry.because.includes("a row per detection"))).toBe(
      true,
    );
    expect(NIGHTFALL_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas nightfall sync");
  });
});
