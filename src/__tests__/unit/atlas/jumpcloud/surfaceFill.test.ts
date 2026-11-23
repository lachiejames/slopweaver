import { describe, expect, it } from "vitest";

import { JUMPCLOUD_ATLAS_DESCRIPTOR } from "../../../../atlas/jumpcloud/descriptor.js";
import { initialJumpcloudManifest, type JumpcloudManifest } from "../../../../atlas/jumpcloud/entities.js";
import {
  applicableApiKinds,
  type JumpcloudConsoleEvidence,
  jumpcloudApiFill,
  jumpcloudConsoleFill,
  jumpcloudDescriptorFor,
} from "../../../../atlas/jumpcloud/surfaceFill.js";

const AT = "2026-09-04T10:00:00.000Z";

/** A console store no walk has ever published into. */
const NEVER_WALKED: JumpcloudConsoleEvidence = { manifest: null, pageFile: null, unreadableBecause: null };

/** A manifest where every applicable kind records a success. */
function fullySynced(): JumpcloudManifest {
  const base = initialJumpcloudManifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const kind of applicableApiKinds()) {
    kinds[kind] = {
      digest: "d",
      entityCount: 1,
      lastAttempt: { at: AT, outcome: "ok", reasons: [] },
      lastSuccessAt: AT,
    };
  }
  return { ...base, kinds };
}

describe("jumpcloudApiFill", () => {
  it("is unfilled when nothing has been published at all", () => {
    const fill = jumpcloudApiFill({ manifest: null });
    expect(fill.filled).toBe(false);
    expect(fill.succeeded).toBe(0);
  });

  it("is unfilled while ONE applicable kind still carries no success — not 'most', not 'at least one'", () => {
    const manifest = fullySynced();
    const kinds = {
      ...manifest.kinds,
      systems: { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null },
    };
    const fill = jumpcloudApiFill({ manifest: { ...manifest, kinds } });
    expect(fill.filled).toBe(false);
    expect(fill.outstanding).toEqual(["systems"]);
  });

  it("is filled once every applicable kind is accounted for by a recorded success", () => {
    const fill = jumpcloudApiFill({ manifest: fullySynced() });
    expect(fill.filled).toBe(true);
    expect(fill.applicable).toBe(applicableApiKinds().length);
  });

  it("counts a kind stamped as a permission boundary or an absent product, since both are the atlas working", () => {
    const manifest = fullySynced();
    const never = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
    const kinds = {
      ...manifest.kinds,
      gcep: { ...never, productAbsent: { at: AT, detail: "v2-gcep-configuration: answered 404" } },
      providers: { ...never, permissionBlocked: { at: AT, detail: "403", unblockedBy: "a provider-admin role" } },
    };
    const fill = jumpcloudApiFill({ manifest: { ...manifest, kinds } });
    expect(fill.outstanding).toEqual([]);
    expect(fill.filled).toBe(true);
  });

  it("still counts a kind that failed with neither stamp as outstanding", () => {
    const manifest = fullySynced();
    const kinds = {
      ...manifest.kinds,
      applemdms: {
        digest: null,
        entityCount: 190,
        lastAttempt: { at: AT, outcome: "failed" as const, reasons: ["v2-applemdms-depkeyget: HTTP 406"] },
        lastSuccessAt: null,
      },
    };
    const fill = jumpcloudApiFill({ manifest: { ...manifest, kinds } });
    expect(fill.outstanding).toEqual(["applemdms"]);
  });

  it("leaves the two shape-indexed families out of the denominator rather than out of the atlas", () => {
    expect(applicableApiKinds().includes("events")).toBe(false);
    expect(applicableApiKinds().includes("commandresults")).toBe(false);
    expect(JUMPCLOUD_ATLAS_DESCRIPTOR.kinds.includes("events")).toBe(true);
  });
});

describe("jumpcloudDescriptorFor", () => {
  it("never lets the browser surface flip on the strength of an API sync", () => {
    const descriptor = jumpcloudDescriptorFor({ console: NEVER_WALKED, manifest: fullySynced() });
    const browser = descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;
    expect(browser.status).toBe("declared-unfilled");
  });

  it("flips the API surface from the store rather than from the source literal", () => {
    expect(JUMPCLOUD_ATLAS_DESCRIPTOR.surfaces.find((s) => s.acquisition === "api")!.status).toBe("declared-unfilled");
    const derived = jumpcloudDescriptorFor({ console: NEVER_WALKED, manifest: fullySynced() });
    expect(derived.surfaces.find((surface) => surface.acquisition === "api")!.status).toBe("filled");
  });

  it("names what is still outstanding, so an unfilled surface is chaseable", () => {
    const descriptor = jumpcloudDescriptorFor({ console: NEVER_WALKED, manifest: null });
    const api = descriptor.surfaces.find((surface) => surface.acquisition === "api")!;
    expect(api.unfilledBecause).toContain("slopweaver atlas jumpcloud sync");
  });
});

describe("jumpcloudConsoleFill", () => {
  it("is unfilled, with every declared page outstanding, when no walk has been recorded", () => {
    const fill = jumpcloudConsoleFill({ evidence: NEVER_WALKED });
    expect(fill.filled).toBe(false);
    expect(fill.outstanding).toHaveLength(fill.declared);
    expect(fill.walkedAt).toBe(null);
  });
});

describe("jumpcloudDescriptorFor — the console surface", () => {
  it("tells a never-walked install to run the walk", () => {
    const descriptor = jumpcloudDescriptorFor({ console: NEVER_WALKED, manifest: null });
    const browser = descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;
    expect(browser.unfilledBecause).toBe(
      "no console walk has been recorded on this install. Run: slopweaver atlas jumpcloud walk",
    );
  });

  it("says the console store could not be read, rather than calling it unwalked", () => {
    const descriptor = jumpcloudDescriptorFor({
      console: { manifest: null, pageFile: null, unreadableBecause: "manifest.json is not valid JSON" },
      manifest: null,
    });
    const browser = descriptor.surfaces.find((surface) => surface.acquisition === "driven-browser")!;
    expect(browser.unfilledBecause).toBe("the console generation could not be read: manifest.json is not valid JSON");
  });
});
