/**
 * What the atlas declares about itself, checked against what it can actually do.
 *
 * The surface-name assertion matters most: `kit/contract.ts` documents `AtlasSource.surface` as naming a
 * DECLARED surface, so a stored observation whose channel the descriptor does not declare points at a
 * surface the catalogue has never heard of.
 */
import { describe, expect, it } from "vitest";

import { CANVA_ATLAS_DESCRIPTOR } from "../../../../atlas/canva/descriptor.js";
import { CANVA_ATLAS_CHANNELS, CANVA_ATLAS_KINDS } from "../../../../atlas/canva/model.js";
import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

describe("the Canva atlas descriptor", () => {
  it("declares exactly the channels the model stores, in the same order", () => {
    expect(CANVA_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toStrictEqual([...CANVA_ATLAS_CHANNELS]);
  });

  it("declares exactly the kinds the model publishes", () => {
    expect([...CANVA_ATLAS_DESCRIPTOR.kinds].toSorted()).toStrictEqual([...CANVA_ATLAS_KINDS].toSorted());
  });

  it("claims filled only for the surface that needs no credential", () => {
    const filled = CANVA_ATLAS_DESCRIPTOR.surfaces.filter((surface) => surface.status === "filled");
    expect(filled.map((surface) => surface.name)).toStrictEqual(["published-api"]);
    expect(filled[0]!.acquisition).toBe("compiled");
  });

  it("says the mandatory browser surface is declared and unfilled, rather than staying silent about it", () => {
    expect(hasFilledBrowserSurface({ descriptor: CANVA_ATLAS_DESCRIPTOR })).toBe(false);
    const unfilled = unfilledSurfaces({ descriptor: CANVA_ATLAS_DESCRIPTOR });
    expect(unfilled.map((surface) => surface.name)).toStrictEqual(["connect-api", "web-app"]);
  });

  it("names what would fill each unfilled surface, and does NOT ask for a sign-in that has already happened", () => {
    const [connect, browser] = unfilledSurfaces({ descriptor: CANVA_ATLAS_DESCRIPTOR });
    expect(connect!.unfilledBecause).toContain("canva-access-token");
    expect(browser!.unfilledBecause).toContain("slopweaver browser cookies --origin https://www.canva.com");
    expect(browser!.unfilledBecause).toContain("blocked on nothing external");
  });

  it("says what it does NOT hold, and names the resync command a catalogue advertises", () => {
    expect(CANVA_ATLAS_DESCRIPTOR.excludes.length).toBe(5);
    expect(
      CANVA_ATLAS_DESCRIPTOR.excludes.some((entry) => entry.because.includes("every mutation on every surface")),
    ).toBe(true);
    expect(CANVA_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas canva sync");
  });

  it("states the entitlement ceiling in its visibility scope, because no scope list carries it", () => {
    expect(CANVA_ATLAS_DESCRIPTOR.visibilityScope).toContain("two different ceilings");
  });
});
