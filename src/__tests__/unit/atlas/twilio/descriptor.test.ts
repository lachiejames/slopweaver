import { describe, expect, it } from "vitest";

import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";
import { TWILIO_ATLAS_DESCRIPTOR } from "../../../../atlas/twilio/descriptor.js";
import { initialTwilioManifest, type TwilioAtlasManifest } from "../../../../atlas/twilio/model.js";
import { twilioConsoleFilled, twilioDescriptorFor, twilioSpecFill } from "../../../../atlas/twilio/surfaceFill.js";

const AT = "2026-09-05T00:00:00.000Z";

/** A manifest with the named kinds carrying a recorded success. */
function manifestWith({ succeeded }: { succeeded: readonly ("api" | "method" | "page")[] }): TwilioAtlasManifest {
  const base = initialTwilioManifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const kind of succeeded) {
    kinds[kind] = { ...kinds[kind], lastSuccessAt: AT };
  }
  return { ...base, kinds };
}

describe("what the Twilio atlas declares about itself", () => {
  // The per-platform test, and it is not close: nothing else here holds a phone number.
  it("declares the entity kinds rather than marking them held elsewhere", () => {
    expect([...TWILIO_ATLAS_DESCRIPTOR.kinds]).toEqual(["account", "api", "method", "page", "resource"]);
  });

  it("declares both surfaces the ruling makes mandatory, plus the credentialled one", () => {
    expect(TWILIO_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toEqual([
      "spec-declared",
      "account-api",
      "console",
    ]);
    expect(TWILIO_ATLAS_DESCRIPTOR.surfaces.some((surface) => surface.acquisition === "driven-browser")).toBe(true);
  });

  it("states the voluminous families as a disposition rather than an exclusion", () => {
    const bound = TWILIO_ATLAS_DESCRIPTOR.excludes.find((entry) => entry.because.includes("a row per record"))!;

    expect(bound.ground).toBe("shape-index");
    expect(bound.because).toContain("DISPOSITION rather than an exclusion");
    expect(bound.because).toContain("still mapped");
  });

  // The one thing a reader of this atlas must not misunderstand.
  it("says plainly that it cannot answer whether one particular message landed", () => {
    expect(
      TWILIO_ATLAS_DESCRIPTOR.excludes.some((entry) => entry.because.includes("whether one particular message landed")),
    ).toBe(true);
  });

  it("names the credential ceiling in the credentials' own terms", () => {
    expect(TWILIO_ATLAS_DESCRIPTOR.visibilityScope).toContain("needs no credential");
    expect(TWILIO_ATLAS_DESCRIPTOR.visibilityScope).toContain("Account SID");
  });

  it("brings every surface current with one command", () => {
    expect(TWILIO_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas twilio sync");
  });
});

describe("deriving a surface's fill from this install's own store", () => {
  // A descriptor's status is a literal, so left alone it would read `filled` on an install that has never
  // synced. Three sibling atlases shipped exactly that.
  it("reads unfilled on a store that has never been published", () => {
    const descriptor = twilioDescriptorFor({ manifest: null });

    expect(descriptor.surfaces.find((surface) => surface.name === "spec-declared")!.status).toBe("declared-unfilled");
    expect(unfilledSurfaces({ descriptor }).length).toBe(3);
  });

  // Not "at least one" — inheriting the kit's existential predicate would make `filled` mean "something
  // worked once".
  it("requires BOTH compiled kinds, not one of them", () => {
    const half = twilioSpecFill({ manifest: manifestWith({ succeeded: ["api"] }) });

    expect(half.filled).toBe(false);
    expect(half.succeeded).toBe(1);
    expect([...half.outstanding]).toEqual(["method"]);
  });

  it("flips the definition surface to filled once both compiled kinds have succeeded", () => {
    const descriptor = twilioDescriptorFor({ manifest: manifestWith({ succeeded: ["api", "method"] }) });
    const surface = descriptor.surfaces.find((row) => row.name === "spec-declared")!;

    expect(surface.status).toBe("filled");
    expect(surface.unfilledBecause).toBe(null);
  });

  // A signed-out walk RUNS and writes rows; none of them is a page this atlas holds.
  it("keeps the console surface unfilled until a page has actually been reached", () => {
    expect(twilioConsoleFilled({ manifest: manifestWith({ succeeded: ["api", "method"] }) })).toBe(false);
    expect(
      hasFilledBrowserSurface({
        descriptor: twilioDescriptorFor({ manifest: manifestWith({ succeeded: ["api", "method"] }) }),
      }),
    ).toBe(false);
  });

  it("flips the console surface to filled once the page kind records a success", () => {
    const descriptor = twilioDescriptorFor({ manifest: manifestWith({ succeeded: ["api", "method", "page"] }) });

    expect(hasFilledBrowserSurface({ descriptor })).toBe(true);
    expect(descriptor.surfaces.find((surface) => surface.name === "console")!.unfilledBecause).toBe(null);
  });

  it("names what is still outstanding rather than only that something is", () => {
    const descriptor = twilioDescriptorFor({ manifest: manifestWith({ succeeded: [] }) });

    expect(descriptor.surfaces.find((surface) => surface.name === "spec-declared")!.unfilledBecause).toContain(
      "still outstanding: api, method",
    );
  });
});
