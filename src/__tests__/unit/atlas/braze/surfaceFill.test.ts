import { describe, expect, it } from "vitest";

import { BRAZE_KINDS, type BrazeAtlasManifest, initialBrazeManifest } from "../../../../atlas/braze/model.js";
import {
  applicablePublishedKinds,
  brazeDescriptorFor,
  brazePublishedFill,
} from "../../../../atlas/braze/surfaceFill.js";

/** A manifest whose named kinds carry a recorded success. */
function manifestWith({ succeeded }: { succeeded: readonly string[] }): BrazeAtlasManifest {
  const base = initialBrazeManifest({ updatedAt: "2026-09-05T00:00:00.000Z" });
  const kinds = { ...base.kinds };
  for (const kind of BRAZE_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: 1,
      lastAttempt: null,
      lastSuccessAt: succeeded.includes(kind) ? "2026-09-05T00:00:00.000Z" : null,
    };
  }
  return { ...base, kinds };
}

describe("applicablePublishedKinds", () => {
  it("excludes the page kind, which only a browser walk can fill", () => {
    expect(applicablePublishedKinds().includes("page")).toBe(false);
    expect(applicablePublishedKinds().length).toBe(BRAZE_KINDS.length - 1);
  });
});

describe("brazePublishedFill", () => {
  it("is unfilled when nothing has been published", () => {
    const fill = brazePublishedFill({ manifest: null });
    expect(fill.filled).toBe(false);
    expect(fill.succeeded).toBe(0);
  });

  it("needs EVERY applicable kind, not most of them", () => {
    const all = applicablePublishedKinds();
    const fill = brazePublishedFill({ manifest: manifestWith({ succeeded: all.slice(1) }) });
    expect(fill.filled).toBe(false);
    expect(fill.outstanding).toEqual([all[0]]);
  });

  it("is filled when every applicable kind succeeded, page excluded", () => {
    const fill = brazePublishedFill({ manifest: manifestWith({ succeeded: applicablePublishedKinds() }) });
    expect(fill.filled).toBe(true);
    expect(fill.outstanding).toEqual([]);
  });
});

describe("brazeDescriptorFor", () => {
  it("reports both compiled surfaces unfilled on an install that has never synced", () => {
    const descriptor = brazeDescriptorFor({ manifest: null });
    const compiled = descriptor.surfaces.filter((surface) => surface.acquisition === "compiled");
    expect(compiled.length).toBe(2);
    expect(compiled.every((surface) => surface.status === "declared-unfilled")).toBe(true);
  });

  it("flips both compiled surfaces to filled once the store earns it", () => {
    const descriptor = brazeDescriptorFor({ manifest: manifestWith({ succeeded: applicablePublishedKinds() }) });
    const compiled = descriptor.surfaces.filter((surface) => surface.acquisition === "compiled");
    expect(compiled.every((surface) => surface.status === "filled")).toBe(true);
    expect(compiled.every((surface) => surface.unfilledBecause === null)).toBe(true);
  });

  it("never flips the two credential-blocked surfaces, whatever the store says", () => {
    const descriptor = brazeDescriptorFor({ manifest: manifestWith({ succeeded: applicablePublishedKinds() }) });
    const blocked = descriptor.surfaces.filter((surface) => surface.acquisition !== "compiled");
    expect(blocked.length).toBe(2);
    expect(blocked.every((surface) => surface.status === "declared-unfilled")).toBe(true);
  });
});
