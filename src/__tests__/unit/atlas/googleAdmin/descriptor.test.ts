/**
 * What the atlas declares about itself, checked against what it can actually do.
 *
 * The assertion that matters most is the surface-name one. `kit/contract.ts` documents
 * `AtlasSource.surface` as naming a declared surface, so a stored observation whose channel the descriptor
 * does not declare points at a surface the catalogue has never heard of.
 */
import { describe, expect, it } from "vitest";

import { GOOGLE_ADMIN_ATLAS_DESCRIPTOR } from "../../../../atlas/googleAdmin/descriptor.js";
import { GOOGLE_ADMIN_ATLAS_CHANNELS, GOOGLE_ADMIN_ATLAS_KINDS } from "../../../../atlas/googleAdmin/model.js";
import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

describe("the Google Admin atlas descriptor", () => {
  it("declares exactly the channels the model stores, in the same order", () => {
    expect(GOOGLE_ADMIN_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toStrictEqual([
      ...GOOGLE_ADMIN_ATLAS_CHANNELS,
    ]);
  });

  it("declares exactly the kinds the model publishes", () => {
    expect([...GOOGLE_ADMIN_ATLAS_DESCRIPTOR.kinds].toSorted()).toStrictEqual([...GOOGLE_ADMIN_ATLAS_KINDS].toSorted());
  });

  it("claims filled for the compiled surface and for the browser one a real walk filled", () => {
    const filled = GOOGLE_ADMIN_ATLAS_DESCRIPTOR.surfaces.filter((surface) => surface.status === "filled");
    expect(filled.map((surface) => surface.name)).toStrictEqual(["discovery", "admin-console"]);
    expect(filled[0]!.acquisition).toBe("compiled");
  });

  it("counts as a two-surface atlas, because the mandatory browser half is filled rather than declared", () => {
    expect(hasFilledBrowserSurface({ descriptor: GOOGLE_ADMIN_ATLAS_DESCRIPTOR })).toBe(true);
  });

  it("leaves only the live API surface unfilled, and names the act that would fill it", () => {
    const unfilled = unfilledSurfaces({ descriptor: GOOGLE_ADMIN_ATLAS_DESCRIPTOR });
    expect(unfilled.map((surface) => surface.name)).toStrictEqual(["admin-api"]);
    expect(unfilled[0]!.unfilledBecause).toContain("slopweaver atlas google-admin connect --status");
  });

  it("says what it does NOT hold, including the disposition that is not an exclusion", () => {
    expect(GOOGLE_ADMIN_ATLAS_DESCRIPTOR.excludes.length).toBe(10);
    expect(
      GOOGLE_ADMIN_ATLAS_DESCRIPTOR.excludes.some((entry) => entry.because.includes("a row per audit event")),
    ).toBe(true);
    expect(
      GOOGLE_ADMIN_ATLAS_DESCRIPTOR.excludes.some((entry) =>
        entry.because.includes("the identifier in any console route"),
      ),
    ).toBe(true);
    expect(GOOGLE_ADMIN_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas google-admin sync");
  });
});
