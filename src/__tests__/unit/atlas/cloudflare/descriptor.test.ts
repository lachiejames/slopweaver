import { describe, expect, it } from "vitest";

import { CLOUDFLARE_ATLAS_DESCRIPTOR } from "../../../../atlas/cloudflare/descriptor.js";
import { CLOUDFLARE_EXCLUDED_SURFACES } from "../../../../atlas/cloudflare/inventory.js";
import { CLOUDFLARE_KINDS } from "../../../../atlas/cloudflare/model.js";
import { atlasDescriptorSchema, hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";

describe("CLOUDFLARE_ATLAS_DESCRIPTOR", () => {
  it("satisfies the kit's own descriptor schema", () => {
    const parsed = atlasDescriptorSchema.safeParse(CLOUDFLARE_ATLAS_DESCRIPTOR);
    expect(parsed.success).toBe(true);
  });

  it("declares one platform row, never one per surface", () => {
    expect(CLOUDFLARE_ATLAS_DESCRIPTOR.platform).toBe("cloudflare");
    expect(CLOUDFLARE_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver cloudflare sync");
  });

  it("quotes the inventory's exclusion list rather than restating it", () => {
    expect(CLOUDFLARE_ATLAS_DESCRIPTOR.excludes).toEqual([...CLOUDFLARE_EXCLUDED_SURFACES]);
  });

  it("lists every kind the atlas tracks", () => {
    expect(CLOUDFLARE_ATLAS_DESCRIPTOR.kinds).toEqual([...CLOUDFLARE_KINDS]);
  });

  it("declares the REST API surface filled and authoritative", () => {
    const rest = CLOUDFLARE_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "rest-api")!;
    expect(rest.acquisition).toBe("api");
    expect(rest.role).toBe("authoritative");
    expect(rest.status).toBe("filled");
    expect(rest.unfilledBecause).toBe(null);
  });

  it("says out loud that the browser surface has never run", () => {
    expect(hasFilledBrowserSurface({ descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR })).toBe(false);
    const unfilled = unfilledSurfaces({ descriptor: CLOUDFLARE_ATLAS_DESCRIPTOR });
    expect(unfilled.length).toBe(1);
    expect(unfilled[0]!.name).toBe("dashboard");
  });

  it("records the no-deep-link finding on the surface that would fix it", () => {
    const browser = CLOUDFLARE_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "dashboard")!;
    expect(browser.unfilledBecause).toContain("deep link is unverified");
    expect(browser.unfilledBecause).toContain("REST API returns no link");
  });

  it("blames the missing WALK, never a missing mechanism — a missing mechanism is a false reason", () => {
    const browser = CLOUDFLARE_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "dashboard")!;
    expect(browser.unfilledBecause).toContain("retired every dedicated Playwright profile");
    expect(browser.unfilledBecause).toContain("docs/browser-route.md");
    // The exact sentence this row replaced. It said the mechanism did not exist; the extension relay into
    // the owner's own Chrome ships and `crowdstrike walk` uses it, so a reader told this would fix the wrong thing.
    expect(browser.unfilledBecause).not.toContain("no browser driving ships");
  });

  it("names the three facts no API reader can ever reach, so the gap is a size rather than a mystery", () => {
    const browser = CLOUDFLARE_ATLAS_DESCRIPTOR.surfaces.find((surface) => surface.name === "dashboard")!;
    expect(browser.unfilledBecause).toContain("access/seats answers 405");
    expect(browser.unfilledBecause).toContain("Browser Isolation usage");
  });
});
